import Link from "next/link";
import NavTabs from "@/components/NavTabs";

// Static on purpose (no session lookup), so public pages stay cached.
export default function SiteHeader() {
  return (
    <>
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <nav className="mx-auto flex w-full max-w-xl items-center justify-between px-4 py-3">
          <Link href="/" className="font-bold tracking-tight">
            FPL Raptor
          </Link>
          <NavTabs variant="top" />
        </nav>
      </header>
      <NavTabs variant="bottom" />
    </>
  );
}
