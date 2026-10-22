import Link from "next/link";
import NavTabs from "@/components/NavTabs";

// Static on purpose (no session lookup), so public pages stay cached.
export default function SiteHeader() {
  return (
    <>
      <a href="#main-content" className="sr-only z-50 rounded-lg bg-surface p-3 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">Skip to content</a>
      <header className="border-b border-line bg-surface pt-[env(safe-area-inset-top)]">
        <nav aria-label="Main navigation" className="mx-auto flex min-h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="flex min-h-11 shrink-0 items-center gap-2.5 font-semibold tracking-tight">
            <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-surface">R</span>
            <span>FPL Raptor</span>
          </Link>
          <NavTabs variant="top" />
          <Link href="/account" className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-medium text-muted hover:bg-surface-muted">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden>
              <circle cx="12" cy="8" r="3.5" />
              <path d="M5 21v-2a7 7 0 0 1 14 0v2" />
            </svg>
            <span>Account</span>
          </Link>
        </nav>
      </header>
      <NavTabs variant="bottom" />
    </>
  );
}
