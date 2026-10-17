import type { Metadata } from "next";
import { PlanProvider } from "@/components/plan-provider";
import { FocusTimerProvider } from "@/components/focus-timer-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZotBlock — Make time to learn",
  description: "Connect your classes, inbox, and calendar. Turn what’s coming up into a study plan.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><PlanProvider><FocusTimerProvider>{children}</FocusTimerProvider></PlanProvider></body>
    </html>
  );
}
