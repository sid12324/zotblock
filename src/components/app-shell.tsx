import { SiteHeader, type SiteHeaderPage } from "@/components/site-header";

export function AppShell({ active, children }: { active: SiteHeaderPage; children: React.ReactNode }) {
  return (
    <div className="app-frame">
      <SiteHeader active={active}/>
      <div className="app-shell">
        {children}
        <footer className="site-footer"><span>A little structure. A lot more focus.</span><span>Made for your next study session <span className="footer-star">✳</span></span></footer>
      </div>
    </div>
  );
}
