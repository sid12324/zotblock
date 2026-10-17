import { z } from "zod";
import type { OnboardingAnswers, StudyPreferences } from "./types";

const clockTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Choose a valid time.");
export const onboardingAnswersSchema = z.object({
  name: z.string().max(120).refine(value => value.trim().length > 0, "Enter your name."),
  major: z.string().max(200).refine(value => value.trim().length > 0, "Enter your major."),
  wake: clockTime,
  sleep: clockTime,
  studyHours: z.string().max(20).refine(value => /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()) && Number(value) >= 0 && Number(value) <= 24, "Choose daily study hours between 0 and 24."),
  breakMinutes: z.enum(["5", "10", "15", "20", "30", "45", "60"]),
  breakFrequency: z.enum(["Every 25 minutes", "Every 30 minutes", "Every 45 minutes", "Every 60 minutes", "Every 90 minutes", "Whenever I need one"]),
  focusPeriod: z.enum(["Morning", "Afternoon", "Evening", "Night"]),
  focusTime: clockTime,
  deadlineDays: z.number().int().min(0).max(30),
}).refine(value => value.wake !== value.sleep, "Choose different wake and sleep times.");

export const defaultOnboardingAnswers: OnboardingAnswers = {
  name: "", major: "", wake: "08:00", sleep: "23:00", studyHours: "",
  breakMinutes: "15", breakFrequency: "Every 60 minutes",
  focusPeriod: "Afternoon", focusTime: "14:00", deadlineDays: 3,
};

export function defaultStudyPreferences(timeZone = "America/Los_Angeles"): StudyPreferences {
  return { timeZone, days: 7, dayStart: 9, dayEnd: 21, blockMinutes: 50 };
}

function minutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

/** Raw answers stay in the plan; normalized numbers are derived from them on every request. */
export function preferencesFromOnboarding(answers: OnboardingAnswers, base: StudyPreferences = defaultStudyPreferences()): StudyPreferences {
  const parsed = onboardingAnswersSchema.parse(answers);
  const breakEveryMinutes = parsed.breakFrequency === "Whenever I need one" ? null : Number(parsed.breakFrequency.match(/\d+/)![0]);
  return {
    ...base, dayStart: 0, dayEnd: 24,
    blockMinutes: breakEveryMinutes ?? base.blockMinutes,
    onboardingAnswers: parsed,
    routine: {
      wakeMinutes: minutes(parsed.wake), sleepMinutes: minutes(parsed.sleep),
      dailyStudyMinutes: Math.floor(Number(parsed.studyHours) * 60),
      breakMinutes: Number(parsed.breakMinutes), breakEveryMinutes,
      focusPeriod: parsed.focusPeriod, focusMinutes: minutes(parsed.focusTime),
      deadlineLeadDays: parsed.deadlineDays,
    },
  };
}

const corePreferencesSchema = z.object({
  timeZone: z.string().max(100).refine(value => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
  }, "Choose a valid IANA timezone."),
  days: z.number().int().min(1).max(14),
  dayStart: z.number().int().min(0).max(23),
  dayEnd: z.number().int().min(1).max(24),
  blockMinutes: z.number().int().min(25).max(120),
  onboardingAnswers: onboardingAnswersSchema.optional(),
}).refine(value => value.dayStart < value.dayEnd, "Study end time must be after start time.");

// Client-supplied routine values are stripped, then regenerated from validated answers.
export const studyPreferencesSchema = corePreferencesSchema.transform((value): StudyPreferences =>
  value.onboardingAnswers ? preferencesFromOnboarding(value.onboardingAnswers, value) : value,
);
