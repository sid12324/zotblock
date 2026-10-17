import type { SourceData, StudyPreferences, StudyTask } from "@/lib/types";
import { localDateTime } from "./time";

export function demoData(preferences: StudyPreferences, now: string): { sources: SourceData; tasks: StudyTask[] } {
  const at = (day: number, hour: number) => localDateTime(now, preferences.timeZone, day, hour);
  const assignments = [
    { id: "assignment-101", title: "Problem set 04: Linear algebra", course: "MATH 18", dueAt: at(2, 23), description: "Work through matrix transformations, eigenvectors, and the practice problems. Estimated 100 minutes.", url: "https://example.instructure.com/courses/18/assignments/101" },
    { id: "assignment-102", title: "Research paper outline", course: "WRITING 60", dueAt: at(4, 17), description: "Prepare a thesis, an annotated outline, and three references. Estimated 150 minutes.", url: "https://example.instructure.com/courses/60/assignments/102" },
  ];
  const emails = [{ id: "email-201", subject: "CS 161 — quiz on Friday", from: "Professor Chen <chen@example.edu>", receivedAt: now, body: `Please review sorting algorithms and asymptotic complexity before the quiz at ${at(3, 12)}. Plan for 100 minutes of review.`, url: "https://mail.google.com/mail/u/0/#inbox/demo201" }];
  const sources: SourceData = { assignments, emails, calendarEvents: [
    { id: "event-301", summary: "Linear algebra lecture", start: at(1, 10), end: at(1, 11) },
    { id: "event-302", summary: "CS 161 lab", start: at(1, 14), end: at(1, 16) },
    { id: "event-303", summary: "Writing seminar", start: at(2, 11), end: at(2, 12) },
  ] };
  const tasks: StudyTask[] = [
    ...assignments.map((assignment, index): StudyTask => ({ id: assignment.id, source: "canvas", sourceId: assignment.id, title: assignment.title, course: assignment.course, dueAt: assignment.dueAt, estimatedMinutes: index === 0 ? 100 : 150, priority: index === 0 ? "high" : "medium", url: assignment.url })),
    { id: "email-201", source: "gmail", sourceId: "email-201", title: "Sorting algorithms quiz", course: "CS 161", dueAt: at(3, 12), estimatedMinutes: 100, priority: "high", url: emails[0].url },
  ];
  return { sources, tasks };
}
