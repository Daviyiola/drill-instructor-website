import type {DrillInstructorProfile} from "./account";

export interface EducatorWorkspace {
  ok: true;
  educator: {
    educatorId: string;
    firstName: string;
    lastName: string;
    email: string;
    avatarNumber: number;
    approvalStatus: "approved";
  };
  school: {
    schoolId: string;
    name: string;
    country: string;
    state: string;
    timezone?: string;
  };
  caller: {adminAccess: boolean; superAdmin: boolean};
  bootcamps: string[];
  subjectsByBootcamp: Record<string, string[]>;
  access: {
    studentsAll: boolean;
    groupsAll: boolean;
    studentIds: string[];
    groupIds: string[];
  };
  plan: EducatorPlan;
  generatedAt: string;
}

export interface EducatorPlan {
  status: string;
  startAt: string;
  endAt: string;
  educatorSeatLimit: number;
  educatorSeatsUsed: number;
  bootcamps: Record<string, {
    enabled: boolean;
    startAt: string;
    endAt: string;
  }>;
}

export interface EducatorStudent {
  id: string;
  firstName: string;
  lastName: string;
  totalPoints: number;
  platoonName: string;
  battalionName: string;
  corpsName: string;
  currentRank: string;
  avaterNumber: number;
}

export interface EducatorGroup {
  id: string;
  rawGroupId?: string;
  scope: "admin" | "educator";
  ownerEducatorId?: string;
  name: string;
  description: string;
  memberIds: string[];
  memberCount: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface EducatorRosterResponse {
  ok: true;
  educatorId: string;
  school: EducatorWorkspace["school"];
  bootcamp: string;
  access: {
    adminAccess: boolean;
    superAdmin: boolean;
    studentsAll: boolean;
    platoonsAll: boolean;
  };
  students: EducatorStudent[];
  groups: EducatorGroup[];
  syncedAt: string;
}

export interface EducatorDrillRow {
  drillId: string;
  bootcamp: string;
  title: string;
  instructions?: string;
  status: "draft" | "published" | "closed";
  dueAt?: string;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string;
  subjectCount?: number;
  questionCount?: number;
  totalQuestions?: number;
  subjects?: string[];
  blueprintSummary?: {subjectCount: number; subjectsText: string; questionCount: number};
  assignedCount?: number;
  startedCount?: number;
  submittedCount?: number;
  lateCount?: number;
  averageAccuracy?: number;
  averageTimeSec?: number;
  isPastDue?: boolean;
  isFullySubmitted?: boolean;
  archived?: boolean;
  [key: string]: unknown;
}

export interface EducatorDrillsResponse {
  ok: true;
  caller: {
    educatorId: string;
    educatorName: string;
    adminAccess: boolean;
    superAdmin: boolean;
  };
  school: EducatorWorkspace["school"];
  bootcamp: string;
  scope: "own" | "school";
  drills: EducatorDrillRow[];
  syncedAt: string;
}

export interface StudentAssignment {
  type: "educator_drill";
  drillId: string;
  schoolId: string;
  bootcamp: string;
  title: string;
  instructions: string;
  createdByEducatorId: string;
  createdByName: string;
  assignedAt: string;
  dueAt: string;
  status: "assigned" | "started" | "submitted" | "late";
  startedAt: string;
  submittedAt: string;
  sessionId: string;
  attemptId: string;
  questionCount: number;
  totalTimeMin: number;
  subjects: string[];
}

export interface StudentAssignmentsResponse {
  ok: true;
  studentId: string;
  bootcamp: string;
  assignments: StudentAssignment[];
  syncedAt: string;
}

export interface AdminEducator {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  status: "pending" | "approved" | "rejected";
  adminAccess: boolean;
  superAdmin: boolean;
  createdAt: string;
  approvedAt: string;
  studentCount: number;
  access: {
    bootcamps?: Record<string, boolean>;
    subjectsByBootcamp?: Record<string, Record<string, boolean>>;
    groups?: Record<string, boolean>;
    students?: Record<string, boolean>;
    platoons?: Record<string, boolean>;
  };
}

export interface SchoolAdminSnapshot {
  ok: true;
  caller: {educatorId: string; adminAccess: boolean; superAdmin: boolean};
  school: EducatorWorkspace["school"];
  plan: EducatorPlan;
  subjectCatalogByBootcamp: Record<string, string[]>;
  educators: AdminEducator[];
  students: EducatorStudent[];
  schoolGroups: EducatorGroup[];
  policies: {
    educatorRegistrationOpen: boolean;
    studentEnrollmentOpen: boolean;
  };
  activeBootcamp: string;
  syncedAt: string;
}

export interface AdminAuditLog {
  id: string;
  actorEducatorId: string;
  targetEducatorId: string;
  action: string;
  createdAt: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface EducatorProfileResponse {
  ok: true;
  profile: DrillInstructorProfile;
}
