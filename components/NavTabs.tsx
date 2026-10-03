"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The app's sections: links in the header on wide screens, a tab bar along
// the bottom on phones (where thumbs are).
const TABS = [
  { href: "/me", label: "Team", icon: "M8 3 4 6l2 4 2-1v12h8V9l2 1 2-4-4-3c-.5 1.5-2 2.5-4 2.5S8.5 4.5 8 3z" },
  { href: "/live", label: "Live", icon: "M3 12h4l3-8 4 16 3-8h4" },
  { href: "/planner", label: "Planner", icon: "M4 7h14l-4-4M20 17H6l4 4" },
  { href: "/league", label: "League", icon: "M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4m8-4h3a3 3 0 0 1-3 4m-4 3v4m-3 4h6m-5-4h4v4h-4z" },
];

export default function NavTabs({ variant }: { variant: "top" | "bottom" }) {
  const pathname = usePathname() ?? "/";
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  if (variant === "top") {
    return (
      <div className="hidden items-center gap-1 sm:flex">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active(t.href) ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-emerald-50 dark:hover:bg-emerald-950 ${
              active(t.href) ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "text-emerald-700 dark:text-emerald-400"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>
    );
  }

  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden dark:border-zinc-800 dark:bg-zinc-950/95"
    >
      <ul className="mx-auto flex max-w-xl">
        {TABS.map((t) => (
          <li key={t.href} className="flex-1">
            <Link
              href={t.href}
              aria-current={active(t.href) ? "page" : undefined}
              className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
                active(t.href) ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-500 dark:text-zinc-400"
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={t.icon} />
              </svg>
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
