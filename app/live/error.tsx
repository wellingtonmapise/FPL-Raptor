"use client";

export default function LiveError({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="page-title">Live</h1>
      <section className="surface mt-6 max-w-lg p-5">
        <h2 className="section-title">Live scores couldn’t load</h2>
        <p className="mt-2 text-sm text-muted">Your team is still linked. Try again in a moment.</p>
        <button type="button" onClick={retry} className="button-primary mt-4">Try again</button>
      </section>
    </main>
  );
}
