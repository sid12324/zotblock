export type ProviderId = "gmail" | "canvas" | "google-calendar";

export type IntegrationStatus = {
  id: ProviderId;
  connected: boolean;
  configured: boolean;
  account?: string;
  connectionMethod?: "oauth" | "personal-token";
  issue?: { message: string; code?: string; actionUrl?: string };
};

export type IntegrationResponse = {
  integrations: IntegrationStatus[];
  modelConfigured: boolean;
};

export type OnboardingAnswers = {
  name: string;
  major: string;
  wake: string;
  sleep: string;
  studyHours: string;
  breakMinutes: "5" | "10" | "15" | "20" | "30" | "45" | "60";
  breakFrequency: "Every 25 minutes" | "Every 30 minutes" | "Every 45 minutes" | "Every 60 minutes" | "Every 90 minutes" | "Whenever I need one";
  focusPeriod: "Morning" | "Afternoon" | "Evening" | "Night";
  focusTime: string;
  deadlineDays: number;
};

export type StudyPreferences = {
  timeZone: string;
  days: number;
  dayStart: number;
  dayEnd: number;
  blockMinutes: number;
  onboardingAnswers?: OnboardingAnswers;
  routine?: {
    wakeMinutes: number;
    sleepMinutes: number;
    dailyStudyMinutes: number;
    breakMinutes: number;
    breakEveryMinutes: number | null;
    focusPeriod: OnboardingAnswers["focusPeriod"];
    focusMinutes: number;
    deadlineLeadDays: number;
  };
};

export type AssignmentDetails = {
  pointsPossible?: number;
  submissionTypes?: string[];
  allowedExtensions?: string[];
  instructionsHtml?: string;
  attachments?: { title: string; url: string }[];
  unlockAt?: string | null;
  lockAt?: string | null;
  timeLimitMinutes?: number;
  questionCount?: number;
  allowedAttempts?: number;
  lockedForUser?: boolean;
  lockExplanation?: string;
  gradingType?: string;
};

export type AssignmentDetailField = Exclude<keyof AssignmentDetails, "attachments" | "instructionsHtml">;
export type AssignmentEdits = {
  description?: string;
  details?: Partial<Record<AssignmentDetailField, string>>;
};
export type AssignmentEditsMap = Record<string, AssignmentEdits>;

export type Assignment = {
  id: string;
  title: string;
  course: string;
  dueAt: string;
  url: string | null;
  description: string;
  details?: AssignmentDetails;
  userEdits?: AssignmentEdits;
};

export type AcademicEmail = {
  id: string;
  subject: string;
  from: string;
  receivedAt: string;
  body: string;
  url: string;
};

export type CalendarEvent = {
  id: string;
  summary: string;
  start: string;
  end: string;
  allDay?: boolean;
};

export type SourceData = {
  assignments: Assignment[];
  emails: AcademicEmail[];
  calendarEvents: CalendarEvent[];
  collectionWarnings?: string[];
};

export type StudyTask = {
  id: string;
  source: "gmail" | "canvas";
  sourceId: string;
  title: string;
  course: string;
  dueAt: string;
  estimatedMinutes: number;
  priority: "high" | "medium" | "low";
  url: string | null;
};

export type StudyBlock = {
  id: string;
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  source: { provider: "gmail" | "canvas"; id: string; title: string; dueAt: string; url: string | null };
  priority: StudyTask["priority"];
};

export type StudyPlan = {
  schemaVersion: "1.0";
  generatedAt: string;
  mode: "live" | "demo";
  timeZone: string;
  preferences?: StudyPreferences;
  window: { start: string; end: string };
  orchestration: { framework: "langchain"; model: string | null };
  studyBlocks: StudyBlock[];
  unscheduledTasks: { task: StudyTask; remainingMinutes: number; reason: string }[];
  sourceData: SourceData;
  warnings: string[];
};
