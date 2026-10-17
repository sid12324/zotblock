"use client";

import { FocusExperience } from "@/components/focus/focus-experience";
import { useFocusTimer } from "@/components/focus-timer-provider";
import { useStudyPreferences } from "@/components/preferences-provider";
import "./focus.css";

export default function FocusPage() {
  const { preferences } = useStudyPreferences();
  const timer = useFocusTimer(preferences.timeZone);
  return <FocusExperience timer={timer} timeZone={preferences.timeZone}/>;
}
