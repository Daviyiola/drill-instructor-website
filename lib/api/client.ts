"use client";

import type { User } from "firebase/auth";

const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const inFlightAccountResolutions = new Map<string, Promise<unknown>>();

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function functionUrl(name: string) {
  const explicitBase =
    process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_BASE_URL?.replace(/\/+$/, "");
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const region = process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION;
  const base =
    explicitBase ||
    (projectId && region
      ? `https://${region}-${projectId}.cloudfunctions.net`
      : "");

  if (!base) throw new Error("FUNCTIONS_BASE_URL_NOT_CONFIGURED");
  return `${base}/${name}`;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function performFunctionCall<ResponseBody, RequestBody = object>(
  user: User,
  name: string,
  body: RequestBody,
  options: { retryTransient?: boolean; signal?: AbortSignal } = {},
): Promise<ResponseBody> {
  // Gen 2 can briefly reject a request while a cold instance is starting.
  // That platform-level 429 has no CORS headers, so browsers surface it as a
  // misleading "CORS" TypeError. Retrying idempotent API calls here makes the
  // client resilient without asking every individual page to reimplement it.
  // Callers opt in for read operations. We must not automatically replay a
  // mutation whose first request might have reached the server.
  const attempts = options.retryTransient ? 4 : 1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response: Response;
    try {
      const token = await user.getIdToken(attempt > 0);
      response = await fetch(functionUrl(name), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: options.signal,
      });
    } catch (reason) {
      if ((reason as Error).name === "AbortError") throw reason;
      if (attempt + 1 < attempts) {
        await delay(600 * 2 ** attempt);
        continue;
      }
      throw new ApiError(
        "The service is starting up. Please try again.",
        503,
      );
    }

    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };

    if (response.ok) return payload as ResponseBody;

    if (
      attempt + 1 < attempts && TRANSIENT_STATUSES.has(response.status)
    ) {
      await delay(600 * 2 ** attempt);
      continue;
    }

    throw new ApiError(
      payload.message || payload.error || "The request could not be completed.",
      response.status,
      payload.error,
    );
  }

  throw new ApiError("The request could not be completed.", 500);
}

export function callFunction<ResponseBody, RequestBody = object>(
  user: User,
  name: string,
  body: RequestBody,
  options: { retryTransient?: boolean; signal?: AbortSignal } = {},
): Promise<ResponseBody> {
  // Every authenticated page needs the same account shell. In development,
  // React intentionally mounts effects twice, and pages used to issue a
  // second resolve request alongside AuthProvider. Share that safe read so
  // it cannot exhaust a cold function's small instance pool.
  const canShareAccountResolution =
    name === "resolveSignInAccountHttps" && !options.signal;
  if (!canShareAccountResolution) {
    return performFunctionCall(user, name, body, options);
  }

  const includeStats = Boolean(
    (body as {includeStats?: unknown}).includeStats,
  );
  // `preferredRole` is only a legacy hint; it must not create a second
  // otherwise-identical account lookup. A stats-bearing request remains
  // separate because it has a genuinely different response shape.
  const requestKey = `${user.uid}:${includeStats ? "with-stats" : "basic"}`;
  const existing = inFlightAccountResolutions.get(requestKey);
  if (existing) return existing as Promise<ResponseBody>;

  const request = performFunctionCall<ResponseBody, RequestBody>(
    user,
    name,
    body,
    options,
  ).finally(() => inFlightAccountResolutions.delete(requestKey));
  inFlightAccountResolutions.set(requestKey, request);
  return request;
}
