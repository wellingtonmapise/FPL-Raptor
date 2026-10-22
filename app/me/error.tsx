"use client";

import Link from "next/link";

export default function TeamError({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="page-title">Your team</h1>
      <section className="surface mt-6 max-w-lg p-5">
        <h2 className="section-title">Your team couldn’t load</h2>
        <p className="mt-2 text-sm text-muted">Try again in a moment, or check your linked team in Account.</p>
        <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={retry} className="button-primary">Try again</button><Link href="/account" className="button-secondary">Account</Link></div>
      </section>
    </main>
  );
}
