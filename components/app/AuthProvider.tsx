"use client";

import type { User } from "firebase/auth";
import { onAuthStateChanged } from "firebase/auth";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {callFunction} from "@/lib/api/client";
import {
  getFirebaseAuth,
  isFirebaseConfigured,
  missingFirebaseConfig,
} from "@/lib/firebase/client";
import type {
  MyBootcampsResponse,
  ResolvedAccount,
  StreakSummary,
} from "@/lib/types/account";
import type {EducatorWorkspace} from "@/lib/types/educator";

interface AuthState {
  user: User | null;
  loading: boolean;
  configured: boolean;
  missingConfig: string[];
  account: ResolvedAccount | null;
  bootcamps: MyBootcampsResponse | null;
  appDataLoading: boolean;
  appDataError: string;
  educatorWorkspace: EducatorWorkspace | null;
  refreshEducatorWorkspace: () => Promise<EducatorWorkspace | null>;
  refreshAccount: () => Promise<ResolvedAccount | null>;
  updateBootcamps: (next: MyBootcampsResponse) => void;
  updateStreak: (bootcamp: string, streak: StreakSummary) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export default function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const configured = isFirebaseConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(configured);
  const [account, setAccount] = useState<ResolvedAccount | null>(null);
  const [bootcamps, setBootcamps] = useState<MyBootcampsResponse | null>(null);
  const [appDataLoading, setAppDataLoading] = useState(false);
  const [appDataError, setAppDataError] = useState("");
  const [educatorWorkspace, setEducatorWorkspace] =
    useState<EducatorWorkspace | null>(null);

  useEffect(() => {
    if (!configured) return;
    return onAuthStateChanged(getFirebaseAuth(), (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
  }, [configured]);

  useEffect(() => {
    if (!user) {
      setAccount(null);
      setBootcamps(null);
      setEducatorWorkspace(null);
      setAppDataLoading(false);
      setAppDataError("");
      return;
    }

    const accountKey = `di.account.${user.uid}`;
    const bootcampsKey = `di.bootcamps.${user.uid}`;
    const educatorKey = `di.educatorWorkspace.${user.uid}`;
    let cachedAccount: ResolvedAccount | null = null;
    let cachedBootcamps: MyBootcampsResponse | null = null;
    let cachedEducator: EducatorWorkspace | null = null;

    try {
      cachedAccount = JSON.parse(sessionStorage.getItem(accountKey) || "null");
      cachedBootcamps = JSON.parse(
        sessionStorage.getItem(bootcampsKey) || "null",
      );
      cachedEducator = JSON.parse(
        sessionStorage.getItem(educatorKey) || "null",
      );
    } catch {
      sessionStorage.removeItem(accountKey);
      sessionStorage.removeItem(bootcampsKey);
      sessionStorage.removeItem(educatorKey);
    }

    if (cachedAccount) setAccount(cachedAccount);
    if (cachedBootcamps) setBootcamps(cachedBootcamps);
    if (cachedEducator) setEducatorWorkspace(cachedEducator);
    setAppDataLoading(!cachedAccount ||
      (!cachedBootcamps && !cachedEducator));
    setAppDataError("");

    let cancelled = false;
    const controller = new AbortController();
    callFunction<ResolvedAccount>(
        user,
        "resolveSignInAccountHttps",
        {includeStats: false},
        {retryTransient: true},
      )
      .then(async (nextAccount) => {
        if (cancelled) return;
        setAccount(nextAccount);
        sessionStorage.setItem(accountKey, JSON.stringify(nextAccount));

        // Educators use the same sign-in identity but do not belong in the
        // student bootcamp bootstrap endpoint.
        if (nextAccount.role !== "student") {
          setBootcamps(null);
          sessionStorage.removeItem(bootcampsKey);
          if (nextAccount.approvalStatus === "approved" && nextAccount.emailVerified) {
            try {
              const workspace = await callFunction<EducatorWorkspace>(
                user,
                "getEducatorWorkspaceHttps",
                {},
                {retryTransient: true, signal: controller.signal},
              );
              if (cancelled) return;
              setEducatorWorkspace(workspace);
              sessionStorage.setItem(educatorKey, JSON.stringify(workspace));
            } catch (reason) {
              if (!cancelled) {
                setEducatorWorkspace(null);
                sessionStorage.removeItem(educatorKey);
              }
              throw reason;
            }
          } else {
            setEducatorWorkspace(null);
            sessionStorage.removeItem(educatorKey);
          }
          return;
        }

        setEducatorWorkspace(null);
        sessionStorage.removeItem(educatorKey);

        const nextBootcamps = await callFunction<MyBootcampsResponse>(
          user,
          "getMyBootcampsHttps",
          {},
          {retryTransient: true, signal: controller.signal},
        );
        if (cancelled) return;
        setBootcamps(nextBootcamps);
        sessionStorage.setItem(bootcampsKey, JSON.stringify(nextBootcamps));
      })
      .catch((reason) => {
        if (!cancelled && (reason as Error).name !== "AbortError") {
          setAppDataError((reason as Error).message);
        }
      })
      .finally(() => {
        if (!cancelled) setAppDataLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [user]);

  const refreshEducatorWorkspace = useCallback(async () => {
    if (!user) return null;
    const key = `di.educatorWorkspace.${user.uid}`;
    try {
      const next = await callFunction<EducatorWorkspace>(
        user,
        "getEducatorWorkspaceHttps",
        {},
        {retryTransient: true},
      );
      setEducatorWorkspace(next);
      sessionStorage.setItem(key, JSON.stringify(next));
      return next;
    } catch (reason) {
      setEducatorWorkspace(null);
      sessionStorage.removeItem(key);
      throw reason;
    }
  }, [user]);

  const refreshAccount = useCallback(async () => {
    if (!user) return null;
    await user.reload();
    await user.getIdToken(true);
    const next = await callFunction<ResolvedAccount>(
      user, "resolveSignInAccountHttps", {includeStats: false},
      {retryTransient: true},
    );
    setAccount(next);
    sessionStorage.setItem(`di.account.${user.uid}`, JSON.stringify(next));
    return next;
  }, [user]);

  const updateBootcamps = useCallback((next: MyBootcampsResponse) => {
    setBootcamps(next);
    if (user) {
      sessionStorage.setItem(`di.bootcamps.${user.uid}`, JSON.stringify(next));
    }
  }, [user]);

  const updateStreak = useCallback((bootcamp: string, streak: StreakSummary) => {
    setBootcamps((current) => {
      if (!current) return current;
      const next = {
        ...current,
        streaks: {...(current.streaks || {}), [bootcamp]: streak},
      };
      if (user) {
        sessionStorage.setItem(
          `di.bootcamps.${user.uid}`,
          JSON.stringify(next),
        );
      }
      return next;
    });
  }, [user]);

  const value = useMemo(
    () => ({
      user,
      loading,
      configured,
      missingConfig: missingFirebaseConfig,
      account,
      bootcamps,
      appDataLoading,
      appDataError,
      educatorWorkspace,
      refreshEducatorWorkspace,
      refreshAccount,
      updateBootcamps,
      updateStreak,
    }),
    [
      account,
      appDataError,
      appDataLoading,
      bootcamps,
      configured,
      educatorWorkspace,
      loading,
      refreshEducatorWorkspace,
      refreshAccount,
      updateBootcamps,
      updateStreak,
      user,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
