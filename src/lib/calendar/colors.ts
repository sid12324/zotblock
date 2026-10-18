import type { CSSProperties } from "react";
import type { CalendarDisplayEvent } from "@/lib/calendar/events";

type BlockColor = { background: string; color: string; stripe: string };

const palette: BlockColor[] = [
  { background: "#2f6fed", color: "#ffffff", stripe: "rgba(255,255,255,.45)" },
  { background: "#1c2b4a", color: "#ffffff", stripe: "rgba(255,255,255,.45)" },
  { background: "#0f8f86", color: "#ffffff", stripe: "rgba(255,255,255,.45)" },
  { background: "#d97706", color: "#ffffff", stripe: "rgba(255,255,255,.42)" },
  { background: "#7c5cbf", color: "#ffffff", stripe: "rgba(255,255,255,.45)" },
  { background: "#c4536a", color: "#ffffff", stripe: "rgba(255,255,255,.45)" },
  { background: "#8eb7ee", color: "#17325c", stripe: "rgba(23,50,92,.28)" },
  { background: "#c47b2b", color: "#ffffff", stripe: "rgba(255,255,255,.42)" },
];

const toneColors: Record<NonNullable<CalendarDisplayEvent["tone"]> | "due", BlockColor> = {
  study: palette[0],
  class: palette[1],
  life: { background: "#8eb7ee", color: "#17325c", stripe: "rgba(23,50,92,.28)" },
  build: { background: "#f0b429", color: "#3d2e08", stripe: "rgba(61,46,8,.28)" },
  due: { background: "#fff6df", color: "#8a5a10", stripe: "transparent" },
};

/** Same course keeps one color. A dropped block keeps its Study, Class, Life, or Build color. */
export function colorKey(event: Pick<CalendarDisplayEvent, "id" | "kind" | "courseName" | "courseCode" | "title">) {
  if (event.id.startsWith("drop:") || event.kind === "due") return null;
  const course = `${event.courseCode} ${event.courseName}`.replace(/\s+/g, " ").trim().toLowerCase();
  if (course) return `course:${course}`;
  if (event.kind === "class" || event.kind === "study") {
    const title = event.title.replace(/^study:\s*/i, "").trim().toLowerCase();
    return title ? `name:${title}` : null;
  }
  return null;
}

function paintStyle(color: BlockColor): CSSProperties {
  return { "--block": color.background, "--block-ink": color.color, "--stripe": color.stripe } as CSSProperties;
}

export function paintLookup(events: CalendarDisplayEvent[]) {
  const keys = [...new Set(events.map(colorKey).filter((key): key is string => Boolean(key)))].sort();
  const assigned = new Map(keys.map((key, index) => [key, palette[index % palette.length]]));
  return (event: CalendarDisplayEvent): CSSProperties => {
    const key = colorKey(event);
    const color = (key && assigned.get(key)) || toneColors[event.tone || (event.kind === "due" ? "due" : event.kind === "class" ? "class" : "study")];
    return paintStyle(color);
  };
}
