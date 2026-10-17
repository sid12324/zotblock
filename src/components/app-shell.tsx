import Link from "next/link";
import { BrandMark } from "@/components/icons";

export function AppShell({ active, children }: { active: "integrations" | "output" | "onboarding" | "calendar"; children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <header className="site-header">
        <Link href="/" className="brand" aria-label="ZotBlock home"><BrandMark className="brand-mark"/><span>ZotBlock<span className="brand-period">.</span></span></Link>
        <nav className="main-nav" aria-label="Main navigation">
          <Link href="/onboarding" className={active === "onboarding" ? "nav-link active" : "nav-link"} aria-current={active === "onboarding" ? "page" : undefined}>Preferences</Link>
          <Link href="/integrations" className={active === "integrations" ? "nav-link active" : "nav-link"} aria-current={active === "integrations" ? "page" : undefined}>Integrations</Link>
          <Link href="/calendar" className={active === "calendar" ? "nav-link active" : "nav-link"} aria-current={active === "calendar" ? "page" : undefined}>Calendar</Link>
          <Link href="/output" className={active === "output" ? "nav-link active" : "nav-link"} aria-current={active === "output" ? "page" : undefined}>JSON output</Link>
        </nav>
        <span className="header-note"><span/>A clearer head starts here</span>
      </header>
      {children}
      <footer className="site-footer"><span>A little structure. A lot more focus.</span><span>Made for your next study session <span className="footer-star">✳</span></span></footer>
    </div>
  );
}
