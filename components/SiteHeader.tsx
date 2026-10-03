import Link from "next/link";

// Static on purpose (no session lookup), so public pages stay cached.
export default function SiteHeader() {
  const link =
    "rounded-lg px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950";
  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <nav className="mx-auto flex w-full max-w-xl items-center justify-between px-4 py-3">
        <Link href="/" className="font-bold tracking-tight">
          FPL Raptor
        </Link>
        <div className="flex items-center gap-1">
          <Link href="/me" className={link}>
            My gameweek
          </Link>
          <Link href="/league" className={link}>
            League
          </Link>
        </div>
      </nav>
    </header>
  );
}
