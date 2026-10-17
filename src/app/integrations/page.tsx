"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ArrowRight, CalendarIcon, CanvasIcon, CheckIcon, GmailIcon, SparklesIcon } from "@/components/icons";
import { usePlan } from "@/components/plan-provider";
import { startGeneration, useGeneration } from "@/components/generation-provider";
import { GenerationProgress } from "@/components/generation-progress";
import { useStudyPreferences } from "@/components/preferences-provider";
import type { IntegrationResponse, IntegrationStatus, ProviderId } from "@/lib/types";
import "@/components/generation-progress.css";

const CONNECTORS = [
  { id: "gmail" as const, name: "Gmail", description: "Catch the deadlines hiding in your inbox.", detail: "Course emails & upcoming deadlines", icon: GmailIcon },
  { id: "canvas" as const, name: "Canvas", description: "Bring your assignments and due dates together.", detail: "Courses, assignments & due dates", icon: CanvasIcon },
  { id: "google-calendar" as const, name: "Google Calendar", description: "Find study time around your primary calendar.", detail: "Events & available study time", icon: CalendarIcon },
];
const providerNames: Record<string, string> = { gmail: "Gmail", canvas: "Canvas", "google-calendar": "Google Calendar", google: "Google" };
const subscribeToBrowser = () => () => {};
const getServerQuery = () => "";
const getBrowserQuery = () => window.location.search;

async function fetchIntegrations(signal?: AbortSignal): Promise<IntegrationResponse> {
  const response = await fetch("/api/integrations", { signal, cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "We couldn’t load your connections.");
  return result as IntegrationResponse;
}

export default function IntegrationsPage() {
  const router = useRouter();
  const { plan } = usePlan();
  const generation = useGeneration();
  const { preferences, completed, ready: preferencesReady, storageNotice, savePreferences } = useStudyPreferences();
  const [data, setData] = useState<IntegrationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [oauthDismissed, setOauthDismissed] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [canvasDomain, setCanvasDomain] = useState("");
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [connectingCanvas, setConnectingCanvas] = useState(false);
  const [disconnecting, setDisconnecting] = useState<ProviderId | null>(null);
  const generating = generation.running ? generation.mode : null;
  const [generationError, setGenerationError] = useState<string | null>(null);
  const queryString = useSyncExternalStore(subscribeToBrowser, getBrowserQuery, getServerQuery);
  const query = new URLSearchParams(queryString);
  const oauthError = query.get("error");
  const oauthConnected = query.get("connected");
  const oauthNotice = oauthError ? { kind: "error", message: oauthError } : oauthConnected ? { kind: "success", message: `${providerNames[oauthConnected] || "Your account"} is connected. You’re one step closer to your study plan.` } : null;
  const visibleNotice = notice || (!oauthDismissed ? oauthNotice : null);

  const loadIntegrations = useCallback((signal?: AbortSignal) => {
    return fetchIntegrations(signal).then((result) => {
      if (signal?.aborted) return;
      setData(result);
      setLoadError(null);
      return result;
    }).catch((error: unknown) => {
      if (error instanceof Error && error.name === "AbortError") return;
      setLoadError(error instanceof Error ? error.message : "We couldn’t load your connections.");
      return null;
    }).finally(() => {
      if (!signal?.aborted) setLoading(false);
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadIntegrations(controller.signal);
    return () => controller.abort();
  }, [loadIntegrations]);

  const integrations = data?.integrations || [];
  const isConnected = (id: ProviderId) => integrations.some((integration) => integration.id === id && integration.connected);
  const sourcesConnected = isConnected("canvas") || isConnected("gmail");
  const connectedIssues = integrations.filter((integration) => integration.connected && integration.issue);
  const canGenerate = preferencesReady && completed && !loading && !loadError && !!data?.modelConfigured && isConnected("google-calendar") && sourcesConnected && connectedIssues.length === 0;
  const connectedCount = integrations.filter((integration) => integration.connected).length;

  async function disconnect(id: ProviderId) {
    setDisconnecting(id);
    setNotice(null);
    setOauthDismissed(true);
    try {
      const response = await fetch(`/api/integrations/${id}/disconnect`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "We couldn’t disconnect this account.");
      setLoading(true);
      await loadIntegrations();
      setNotice({ kind: "success", message: `${providerNames[id]} has been disconnected.` });
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "We couldn’t disconnect this account." });
    } finally { setDisconnecting(null); }
  }

  async function connectPersonalCanvas() {
    setConnectingCanvas(true);
    setCanvasOpen(false);
    setNotice(null);
    setOauthDismissed(true);
    try {
      const response = await fetch("/api/integrations/canvas/connect", { method: "POST" });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "We couldn’t connect Canvas. Please try again.");
      setLoading(true);
      const updated = await loadIntegrations();
      if (!updated) return;
      if (!updated.integrations.some((integration) => integration.id === "canvas" && integration.connected)) {
        throw new Error("Canvas wasn’t connected. Please try again.");
      }
      setNotice({ kind: "success", message: "Canvas is connected. Your assignments are ready to plan around." });
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "We couldn’t connect Canvas. Please try again." });
    } finally {
      setConnectingCanvas(false);
    }
  }

  function showSetupNotice(id: ProviderId) {
    setNotice({
      kind: "error",
      message: id === "canvas"
        ? "To connect Canvas, set CANVAS_ACCESS_TOKEN and CANVAS_BASE_URL for personal access, or CANVAS_CLIENT_ID and CANVAS_CLIENT_SECRET for OAuth. Both options need a SESSION_SECRET (32+ characters) in .env.local. Restart the app after setup."
        : "To connect Google, set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and a SESSION_SECRET (32+ characters) in .env.local, then restart the app.",
    });
    window.scrollTo({ top: 180, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  function connectCanvas(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCanvasError(null);
    try {
      const input = canvasDomain.trim();
      const url = new URL(input.includes("://") ? input : `https://${input}`);
      if (url.protocol !== "https:" || !url.hostname.includes(".") || url.username || url.password || url.port || (url.pathname !== "/" && url.pathname !== "")) {
        throw new Error("Enter your school’s Canvas hostname, such as school.instructure.com.");
      }
      const authorizationUrl = new URL("/api/auth/canvas", window.location.origin);
      authorizationUrl.searchParams.set("domain", url.hostname);
      window.location.assign(authorizationUrl.href);
    } catch (error) {
      setCanvasError(error instanceof Error && error.message.startsWith("Enter") ? error.message : "Enter a valid Canvas hostname, such as school.instructure.com.");
    }
  }

  function generate(mode: "live" | "demo") {
    if (!preferencesReady || !completed) { router.push("/onboarding"); return; }
    setGenerationError(null);
    try {
      startGeneration(mode, preferences, plan);
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "We couldn’t generate your study blocks. Please try again.");
    }
  }

  return (
    <AppShell active="integrations">
      <main className="main-content">
        <section className="page-heading">
          <div className="eyebrow"><span className="eyebrow-line"/>YOUR TIME, A LITTLE MORE INTENTIONAL</div>
          <h1>Good study days<br/>start with a <span>clear plan.</span></h1>
          <p>Connect the places your school life lives. We’ll turn your<br className="desktop-break"/> deadlines and free time into study blocks that fit.</p>
        </section>

        {visibleNotice && <div className={`notice ${visibleNotice.kind}`} role={visibleNotice.kind === "error" ? "alert" : "status"}><span>{visibleNotice.message}</span><button type="button" aria-label="Dismiss notification" onClick={() => { setNotice(null); setOauthDismissed(true); }}>×</button></div>}

        <section className="connections-section" aria-labelledby="connections-heading">
          <div className="section-heading"><h2 id="connections-heading">Your connections</h2><span className="connection-count">{loading ? "Checking connections…" : `${connectedCount} of 3 connected`}</span></div>
          {loadError && <div className="notice error" role="alert"><span>{loadError}</span><button type="button" className="text-button" onClick={() => { setLoading(true); void loadIntegrations(); }}>Try again</button></div>}
          <div className="connector-list" aria-busy={loading}>
            {CONNECTORS.map(({ id, name, description, detail, icon: Icon }) => {
              const status: IntegrationStatus | undefined = integrations.find((integration) => integration.id === id);
              const configured = status?.configured ?? false;
              const connected = status?.connected ?? false;
              const issue = status?.issue;
              const canReconnect = id !== "canvas" && (issue?.code === "AUTH_REQUIRED" || issue?.code === "INSUFFICIENT_SCOPE");
              const personalCanvas = id === "canvas" && status?.connectionMethod === "personal-token";
              let action: React.ReactNode;
              if (connected) {
                action = <div className="connector-actions">{canReconnect && <a href={`/api/auth/google?provider=${id}`} className="button button-connect reconnect-button">Reconnect</a>}<button type="button" className="button button-subtle disconnect-button" onClick={() => void disconnect(id)} disabled={!!disconnecting || !!generating || connectingCanvas}>{disconnecting === id ? "Disconnecting…" : "Disconnect"}</button></div>;
              } else if (id === "canvas" && connectingCanvas) {
                action = <button type="button" className="button button-connect" disabled><span className="spinner"/>Connecting…</button>;
              } else if (loading) {
                action = <span className="loading-connection"><span className="spinner"/>Checking</span>;
              } else if (loadError) {
                action = <span className="setup-badge">Unavailable</span>;
              } else if (!configured) {
                action = <button type="button" className="button button-connect" onClick={() => showSetupNotice(id)}>Connect <span aria-hidden="true">+</span></button>;
              } else if (personalCanvas) {
                action = <button type="button" className="button button-connect" onClick={() => void connectPersonalCanvas()} disabled={!!disconnecting || !!generating}>Connect <span aria-hidden="true">+</span></button>;
              } else if (id === "canvas") {
                action = <button type="button" className="button button-connect" onClick={() => setCanvasOpen(!canvasOpen)} aria-expanded={canvasOpen} aria-controls="canvas-form" disabled={!!disconnecting || !!generating}>Connect <span aria-hidden="true">+</span></button>;
              } else {
                action = <a href={`/api/auth/google?provider=${id}`} className="button button-connect">Connect <span aria-hidden="true">+</span></a>;
              }
              return <div className={`connector ${connected ? "is-connected" : ""}`} key={id}>
                <div className="connector-main">
                  <div className="connector-icon"><Icon/></div>
                  <div className="connector-copy"><div className="connector-title"><h3>{name}</h3>{issue ? <span className="connection-issue-badge">Needs attention</span> : connected && <span className="connected-badge"><CheckIcon/>Connected</span>}</div><p>{connected && status?.account ? status.account : description}</p><span className="connector-detail">{detail}</span></div>
                  <div className="connector-action">
                    {action}
                  </div>
                </div>
                {issue && <div className="connector-issue" role="alert"><p>{issue.message}</p><div className="connector-issue-actions">{issue.code === "API_DISABLED" && issue.actionUrl && <a href={issue.actionUrl} target="_blank" rel="noopener noreferrer">Open Google Cloud setup <ArrowRight/></a>}<button type="button" onClick={() => { setLoading(true); void loadIntegrations(); }} disabled={loading || !!generating}>{loading ? "Checking…" : "Check again"}</button></div></div>}
                {id === "canvas" && canvasOpen && !connected && !personalCanvas && <form id="canvas-form" className="canvas-form" onSubmit={connectCanvas}><label htmlFor="canvas-domain">Your school’s Canvas address</label><div className="canvas-form-fields"><input id="canvas-domain" type="text" placeholder="school.instructure.com" value={canvasDomain} onChange={(event) => setCanvasDomain(event.target.value)} autoComplete="url" autoCapitalize="none" spellCheck={false} required aria-describedby={canvasError ? "canvas-error" : "canvas-help"}/><button type="submit" className="button button-primary">Continue <ArrowRight/></button></div>{canvasError ? <p id="canvas-error" className="field-error" role="alert">{canvasError}</p> : <p id="canvas-help">Use the address you normally visit to sign in to Canvas.</p>}</form>}
              </div>;
            })}
          </div>
          <p className="permission-note"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3.5" y="7" width="9" height="7" rx="2" stroke="currentColor"/><path d="M5.5 7V4.5a2.5 2.5 0 0 1 5 0V7" stroke="currentColor"/><circle cx="8" cy="10.5" r=".8" fill="currentColor"/></svg>You control your connections. Disconnect anytime.</p>
        </section>

        <section className="generate-section" aria-labelledby="generate-heading">
          <div className="generate-top"><div className="generate-icon"><SparklesIcon/></div><div className="generate-copy"><h2 id="generate-heading">A plan that works around you.</h2><p>Turn upcoming work into focused blocks, around the time you already have booked.</p></div></div>
          <div className="study-profile">
            {preferencesReady && completed && preferences.onboardingAnswers ? <><div className="study-profile-heading"><strong>{preferences.onboardingAnswers.name}’s study preferences</strong><Link href="/onboarding">Edit answers <ArrowRight/></Link></div><p>{preferences.onboardingAnswers.studyHours} hours per day · {preferences.onboardingAnswers.breakMinutes}-minute breaks · Peak focus: {preferences.onboardingAnswers.focusPeriod.toLowerCase()}</p><p>Awake {preferences.onboardingAnswers.wake}–{preferences.onboardingAnswers.sleep} · Start assignments {preferences.onboardingAnswers.deadlineDays} days ahead</p></> : <p>{preferencesReady ? <Link href="/onboarding">Answer the six onboarding questions to personalize your study plan <ArrowRight/></Link> : "Loading your study preferences…"}</p>}
            <label className="planning-horizon">Plan ahead<select disabled={!!generating || !preferencesReady || !completed} value={preferences.days} onChange={(event) => savePreferences({ ...preferences, days: Number(event.target.value) })}><option value={3}>3 days</option><option value={7}>7 days</option><option value={14}>14 days</option></select></label>
            <p className="timezone-note">All times in {preferences.timeZone.replaceAll("_", " ")}</p>
            {storageNotice && <p role="status">{storageNotice}</p>}
          </div>
          {generationError && <div className="notice error" role="alert">{generationError}</div>}
          {generation.mode && <GenerationProgress/>}
          <div className="generation-actions"><button type="button" className="button button-primary generate-button" onClick={() => void generate("live")} disabled={!canGenerate || !!generating || !!disconnecting || connectingCanvas}>Generate study blocks <ArrowRight/></button><button type="button" className="button button-sample" onClick={() => void generate("demo")} disabled={!!generating || !preferencesReady || !completed}>Try sample data <ArrowRight/></button></div>
          {!loading && !canGenerate && <p className="generation-requirement">{!completed ? "Complete your study preferences above to generate a personalized plan." : connectedIssues.length > 0 ? "Resolve the connection issue above, then check the connection again." : !isConnected("google-calendar") || !sourcesConnected ? "Connect Google Calendar and at least one source—Gmail or Canvas—to generate your plan." : loadError ? "Check your connections again to generate your plan." : "Add OPENAI_API_KEY to .env.local to generate a plan from your connections."}</p>}
          <div className="output-note"><span className="json-symbol">{`{ }`}</span><span>Your study blocks appear on your ZotBlock calendar. The complete JSON is available in JSON output.</span></div>
        </section>
      </main>
    </AppShell>
  );
}
