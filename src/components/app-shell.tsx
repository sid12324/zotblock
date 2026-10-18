import { SiteHeader, type SiteHeaderPage } from "@/components/site-header";

export function AppShell({ active, children, backdrop = false }: { active: SiteHeaderPage; children: React.ReactNode; backdrop?: boolean }) {
  return (
    <div className={backdrop ? "app-frame pref-backdrop" : "app-frame"}>
      <SiteHeader active={active}/>
      <div className="app-shell">
        {children}
        <footer className="site-footer"><span>A little structure. A lot more focus.</span><span>Made for your next study session <span className="footer-star">✳</span></span></footer>
      </div>
    </div>
  );
}
