export default function TeamLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8" role="status" aria-label="Loading your team">
      <span className="sr-only">Loading your team…</span>
      <div aria-hidden className="space-y-6 motion-safe:animate-pulse">
        <div className="space-y-3"><div className="h-3 w-24 rounded bg-surface-muted" /><div className="h-7 w-56 rounded bg-surface-muted" /><div className="h-4 w-40 rounded bg-surface-muted" /></div>
        <div className="surface h-32" />
        <div className="grid gap-6 lg:grid-cols-[1.45fr_1fr]"><div className="surface h-[480px]" /><div className="surface h-72" /></div>
      </div>
    </main>
  );
}
