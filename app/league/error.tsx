"use client";

export default function LeagueError({ retry }: { retry: () => void }) {
  return <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6"><h1 className="page-title">League</h1><section className="surface mt-5 max-w-lg p-5"><h2 className="section-title">Your league couldn’t load</h2><p className="mt-2 text-sm text-muted">Try again to load the latest standings and followed leagues.</p><button type="button" className="button-primary mt-4" onClick={retry}>Try again</button></section></main>;
}
