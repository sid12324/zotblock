"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useStudyPreferences } from "@/components/preferences-provider";
import { usePlan } from "@/components/plan-provider";

export default function HomePage() {
  const router = useRouter();
  const { ready: preferencesReady, completed } = useStudyPreferences();
  const { ready: planReady, plan } = usePlan();

  useEffect(() => {
    if (!preferencesReady || !planReady) return;
    const query = new URLSearchParams(window.location.search);
    if (query.has("connected") || query.has("error")) {
      router.replace(`/integrations?${query.toString()}`);
      return;
    }
    router.replace(!completed ? "/onboarding" : plan ? "/calendar" : "/integrations");
  }, [preferencesReady, planReady, completed, plan, router]);

  return <main className="home-loading"><strong>ZotBlock.</strong><p role="status">Opening your study workspace…</p><Link href="/onboarding">Set up study preferences</Link></main>;
}
