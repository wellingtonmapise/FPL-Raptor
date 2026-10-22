export default function LiveLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8" role="status" aria-label="Loading live scores">
      <span className="sr-only">Loading live scores…</span>
      <div aria-hidden className="space-y-5 motion-safe:animate-pulse">
        <div className="h-8 w-40 rounded bg-surface-muted" />
        <div className="surface h-40" />
        <div className="h-12 rounded-xl bg-surface-muted" />
        <div className="grid gap-6 lg:grid-cols-[1.45fr_1fr]"><div className="surface h-[480px]" /><div className="surface h-64" /></div>
      </div>
    </main>
  );
}
