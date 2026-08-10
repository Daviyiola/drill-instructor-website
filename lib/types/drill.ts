export interface DrillCatalogSubject {
  name: string;
  modules: string[];
  practiceYears: number[];
  availablePracticeYears: number[];
  questionCount: number;
}

export interface DrillCatalog {
  ok: true;
  bootcamp: string;
  datasetVersion: string;
  subjects: DrillCatalogSubject[];
  licensed: boolean;
  freePracticeYears: number[];
}

export interface DrillSubjectConfig {
  subject: string;
  questionCount: number;
  timeLimitMin: number;
  modules: string[];
  practiceYears: number[];
}

export interface DrillQuestion {
  id: string;
  sourceId: string;
  subject: string;
  module: string;
  practiceYear: number;
  prompt: string;
  passage: string;
  imageSources: string[];
  options: string[];
}

export interface DrillBookmark extends DrillQuestion {
  bootcamp: string;
  datasetVersion: string;
  sourceSessionId: string;
  updatedAt: number;
  correctIndex?: number;
  explanation?: string;
  answerAvailable?: boolean;
  groups?: string[];
}

export interface DrillHistoryRow {
  sessionId: string;
  bootcamp: string;
  takenAt: string;
  updatedAt?: string;
  attempted: number;
  correct: number | null;
  duration_sec: number;
  points: number | null;
  total_questions: number;
  source?: "solo" | "challenge" | "assignment";
  sourceId?: string;
  scoreStatus?: "pending" | "released";
  correctionsStatus?: "pending" | "released";
}

export interface AnalyticsOverview {
  accuracy: number | null;
  attempts: number;
  gradedAttempts: number;
  activeTimeSec: number;
  averageTimeSec: number | null;
  sessions: number;
  points: number;
  activeDays: number;
  subjectCount: number;
  moduleCount: number;
  practiceTestCount: number;
}

export interface AnalyticsBreakdown {
  subject: string;
  module?: string;
  totalQuestions: number;
  attempted: number;
  correct: number;
  wrong: number;
  unanswered: number;
  activeTimeSec: number;
  allocatedTimeSec: number;
  accuracy: number | null;
  averageTimeSec: number | null;
  sampleSize: number;
}

export interface StudentAnalytics {
  ok: true;
  bootcamp: string;
  overview: AnalyticsOverview;
  trend: Array<{
    startAt: string;
    label: string;
    accuracy: number | null;
    attempts: number;
    activeTimeSec: number;
    averageTimeSec: number | null;
    sessions: number;
    points: number;
  }>;
  subjects: AnalyticsBreakdown[];
  modules: AnalyticsBreakdown[];
  focusAreas: Array<{
    subject: string;
    module: string;
    accuracy: number | null;
    sampleSize: number;
    drillConfig: {
      bootcamp: string;
      subject: string;
      modules: string[];
      questionCount: number;
    };
  }>;
  subjectFocusAreas: StudentAnalytics["focusAreas"];
  moduleFocusAreas: StudentAnalytics["focusAreas"];
  readiness: {
    status: "insufficient_data" | "estimated";
    score: number | null;
    band?: string;
    confidence: number;
    contributingAttempts: number;
    requiredAttempts: number;
    includedSubjects: string[];
    formulaVersion: string;
    pillars: null | {
      performance: number;
      consistency: number;
      coverage: number;
    };
  };
  activity: {
    current: number;
    best: number;
    days: Array<{day: string; sessions: number}>;
  };
  excludedPendingScores: number;
  metricVersion: string;
  generatedAt: string;
}

export interface DrillSession {
  sessionId: string;
  status: "active" | "submitted";
  mode?: "practice" | "challenge" | "assignment";
  challengeId?: string;
  assignmentId?: string;
  bootcamp: string;
  datasetVersion: string;
  createdAt: number;
  updatedAt: number;
  config: DrillSubjectConfig[];
  questions: DrillQuestion[];
  answers: Record<string, number>;
  bookmarks: Record<string, boolean>;
  flags: Record<string, boolean>;
  questionTimes: Record<string, number>;
  timers: Record<string, number>;
  currentQuestionId: string;
}

export type ChallengeStage = "incoming" | "accepted" | "completed";

export interface StudentChallengeRow {
  challengeId: string;
  role: "sender" | "recipient";
  status: string;
  stage: ChallengeStage;
  bootcamp: string;
  datasetVersion: string;
  subjectCount: number;
  questionCount: number;
  totalTimeMin: number;
  senderCustomId: string;
  senderDisplay: string;
  senderAvatarNumber: number;
  senderCurrentRank: string;
  createdAt: string;
  expiresAt: string;
  completedAt: string;
  sessionId: string;
}

export interface StudentChallengeSubject {
  subject: string;
  numQ: number;
  timeLimitMin: number;
  questionIds: string[];
  filters: Record<string, unknown>;
}

export interface StudentChallengeResult {
  customId: string;
  displayName: string;
  avatarNumber: number;
  currentRank: string;
  attempted: number;
  correct: number;
  totalQ: number;
  wrong: number;
  unanswered: number;
  scorePct: number;
  usedSec: number;
  averageTimeSec: number;
  points: number;
  subjects: DrillBreakdown[];
  modules: DrillBreakdown[];
  finishedAt: string;
}

export interface StudentChallengeParticipant {
  customId: string;
  displayName: string;
  avatarNumber: number;
  currentRank: string;
  role: "creator" | "recipient";
  status: string;
  completed: boolean;
  completedAt: string;
  reinviteCount: number;
}

export interface StudentChallengeDetail {
  challengeId: string;
  bootcamp: string;
  datasetVersion: string;
  subjects: StudentChallengeSubject[];
  createdAt: string;
  expiresAt: string;
  status: string;
  reveal: boolean;
  role: "sender" | "recipient";
  participantStatus: string;
  senderDisplay: string;
  senderAvatarNumber: number;
  sessionId: string;
  participantCount: number;
  participants: StudentChallengeParticipant[];
  results: StudentChallengeResult[];
}

export interface DrillAnswerResult extends DrillQuestion {
  position: number;
  selectedIndex: number | null;
  correctIndex: number;
  isCorrect: boolean;
  timeSpentSec: number;
  explanation: string;
}

export interface DrillBreakdown {
  subject: string;
  module?: string;
  totalQ: number;
  attempted: number;
  correct: number;
  wrong: number;
  unanswered: number;
  scorePct: number;
  usedSec: number;
  averageTimeSec: number;
  timeLimitSec?: number;
  remainingSec?: number;
}

export interface DrillResult {
  sessionId: string;
  mode?: "solo" | "challenge" | "assignment";
  bootcamp: string;
  datasetVersion: string;
  takenAt: string;
  createdAt: string;
  summary: {
    totalQ: number;
    attempted: number;
    correct: number;
    wrong: number;
    unanswered: number;
    points: number;
    scorePct: number;
    usedSec: number;
  };
  subjects: DrillBreakdown[];
  modules: DrillBreakdown[];
  answers: DrillAnswerResult[];
}

export interface DrillCredit {
  creditMode: "paid" | "free";
  deltaPoints: number;
  reason: string;
  totalPoints: number;
}
