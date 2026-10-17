"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ArrowRight } from "@/components/icons";
import { usePlan } from "@/components/plan-provider";

export default function OutputPage() {
  const { plan, ready, storageNotice } = usePlan();
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outputRef = useRef<HTMLPreElement>(null);
  const json = plan ? JSON.stringify(plan, null, 2) : "";

  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current); }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(json);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
      const selection = window.getSelection();
      if (selection && outputRef.current) {
        const range = document.createRange();
        range.selectNodeContents(outputRef.current);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopyStatus("idle"), 4000);
  }

  function download() {
    const url = URL.createObjectURL(new Blob([json + "\n"], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `zotblock-${plan?.mode || "plan"}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <AppShell active="output"><main className="main-content output-content"><Link href="/integrations" className="back-link"><ArrowRight/>Back to integrations</Link><div className="output-heading"><div><h1>JSON output</h1><p>Your latest generated study blocks and source data.</p></div>{plan && <span className={`plan-mode ${plan.mode === "demo" ? "sample" : "live"}`}><span/>{plan.mode === "demo" ? "Sample data" : "Your connected data"}</span>}</div>
    {storageNotice && <p className="notice info" role="status">{storageNotice}</p>}
    {!ready ? <div className="empty-output" role="status"><span className="spinner"/>Loading your plan…</div> : plan ? <><section className="json-panel" aria-labelledby="json-heading"><div className="json-toolbar"><div className="json-filename"><span className="json-file-icon">{`{ }`}</span><h2 id="json-heading">study-plan.json</h2><span className="file-type">JSON</span></div><div className="json-actions"><button type="button" className="button button-subtle" onClick={() => void copy()}><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.4"/><path d="M12 7V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h3" stroke="currentColor" strokeWidth="1.4"/></svg>{copyStatus === "copied" ? "Copied!" : "Copy JSON"}</button><button type="button" className="button button-subtle" onClick={download}><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 3v9m-3-3 3 3 3-3M3 13v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>Download</button></div></div><pre className="json-output" ref={outputRef} tabIndex={0} aria-label="Study plan JSON"><code>{json}</code></pre></section><p className="copy-feedback" role="status">{copyStatus === "copied" ? "JSON copied to clipboard." : copyStatus === "error" ? "Clipboard access is unavailable. The JSON is selected; use your keyboard to copy it." : ""}</p><p className="json-footnote">{plan.mode === "demo" ? "This plan uses sample assignments, emails, and calendar events." : "Generated from your connected sources."} No events have been added to your calendar.</p></> : <div className="empty-output"><span className="empty-json">{`{ }`}</span><h2>No plan generated yet.</h2><p>Connect your accounts or try the sample data to create your first study plan.</p><Link href="/integrations" className="button button-primary">Go to integrations <ArrowRight/></Link></div>}
  </main></AppShell>;
}
