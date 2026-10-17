import Link from "next/link";

const links = [
  { href: "/onboarding", id: "onboarding", label: "Preferences" },
  { href: "/integrations", id: "integrations", label: "Integrations" },
  { href: "/calendar", id: "calendar", label: "Calendar" },
  { href: "/output", id: "output", label: "JSON" },
] as const;

export type SiteHeaderPage = (typeof links)[number]["id"];

export function SiteHeader({ active }: { active: SiteHeaderPage }) {
  return (
    <header className="zb-header">
      <Link href="/" className="zb-brand" aria-label="ZotBlock home">
        <img src="/zotblock-mark.png" alt="" className="zb-logo" />
        <span className="zb-wordmark">ZotBlock</span>
      </Link>
      <nav className="zb-nav" aria-label="App navigation">
        {links.map(link => (
          <Link key={link.id} href={link.href} className={active === link.id ? "zb-nav-link is-active" : "zb-nav-link"} aria-current={active === link.id ? "page" : undefined}>{link.label}</Link>
        ))}
      </nav>
      <p className="zb-note">Your semester starts here</p>
    </header>
  );
}
