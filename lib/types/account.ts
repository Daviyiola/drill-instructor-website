export type AccountRole = "student" | "educator";

export interface DrillInstructorProfile {
  firstName?: string;
  lastName?: string;
  email?: string;
  avatarNumber?: number;
  avaterNumber?: number;
  currentRank?: string;
  points?: number;
  totalPoints?: number;
  platoonName?: string;
  battalionName?: string;
  corpsName?: string;
  profilePermissions?: boolean;
  platoonPermissions?: boolean;
  [key: string]: unknown;
}

export interface ResolvedAccount {
  ok: true;
  role: AccountRole;
  customUserId: string;
  profile: DrillInstructorProfile;
  route: string;
  emailVerified: boolean;
  approvalStatus?: string;
  schoolName?: string;
  entitlements?: Record<string, {
    hasActiveLicense: boolean;
    plan: string;
    activationDate: string;
    expirationDate: string;
    source: string;
  }>;
}

export interface BootcampSummary {
  id: string;
  name?: string;
  description?: string;
  [key: string]: unknown;
}

export interface StreakSummary {
  current: number;
  best: number;
  lastPracticeDay: string;
  timezone: string;
  timezoneOffsetMinutes: number;
  metricVersion: string;
}

export interface MyBootcampsResponse {
  ok: true;
  role: AccountRole;
  initialized: boolean;
  visibleBootcamps: string[];
  availableBootcamps: Array<string | BootcampSummary>;
  entitledBootcamps: string[];
  streaks?: Record<string, StreakSummary>;
  account?: ResolvedAccount;
}
