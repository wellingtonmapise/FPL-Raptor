"use client";

import "@fontsource/luckiest-guy/400.css";
import { useRef, useState, useTransition } from "react";
import { react } from "@/app/league/[id]/actions";
import Raptor from "@/components/recap/Raptor";
import Sticker from "@/components/recap/Sticker";
import { applyReaction, REACTION_EMOJI, REACTIONS, SAD_KINDS, type Reaction, type Recap, type RecapCard, type Tally } from "@/lib/recap";

// The weekly recap as a swipeable stack of comic cards: a cover with the
// headline, then one card per award (Top Dog, Bench Warmer, ...), each with
// the manager's raptor, a sticker, the stat and the AI's one-line roast.
// Everyone in the league can react to each card.

const INK = "#1B1B1E";
const COMIC = { fontFamily: "'Luckiest Guy', system-ui, sans-serif" };
const STYLE: Record<string, { bg: string; light?: boolean }> = {
  top: { bg: "#FFD23F" },
  rocket: { bg: "#4CC9F0" },
  captain_hero: { bg: "#9EF01A" },
  lone: { bg: "#F15BB5", light: true },
  chip: { bg: "#9B5DE5", light: true },
  bench: { bg: "#FF8FAB" },
  captain_fail: { bg: "#FF6B6B" },
  hit: { bg: "#FF9F1C" },
  freefall: { bg: "#ADB5BD" },
  spoon: { bg: "#E9C46A" },
};
const DOTS = (light: boolean) => ({
  backgroundImage: `radial-gradient(${light ? "rgba(255,255,255,0.18)" : "rgba(27,27,30,0.13)"} 1.3px, transparent 1.6px)`,
  backgroundSize: "11px 11px",
});

function ComicTitle({ children, size = "text-[34px]" }: { children: React.ReactNode; size?: string }) {
  return (
    <h3
      className={`${size} leading-[0.95] tracking-wide text-white`}
      style={{ ...COMIC, WebkitTextStroke: `2px ${INK}`, paintOrder: "stroke fill", textShadow: `3px 3px 0 ${INK}` }}
    >
      {children}
    </h3>
  );
}

function Panel({ bg, light = false, children, label }: { bg: string; light?: boolean; children: React.ReactNode; label: string }) {
  return (
    <article
      aria-label={label}
      className="relative flex aspect-[4/5] flex-col overflow-hidden rounded-3xl border-[3px] p-5"
      style={{ backgroundColor: bg, borderColor: INK, boxShadow: `5px 6px 0 ${INK}`, ...DOTS(light) }}
    >
      {children}
    </article>
  );
}

function Bubble({ who, children }: { who?: string; children: React.ReactNode }) {
  return (
    <div className="relative mt-auto rounded-2xl border-[3px] bg-white px-3.5 py-2.5 text-[15px] leading-snug text-zinc-900" style={{ borderColor: INK }}>
      <span
        className="absolute -top-[13px] left-10 h-5 w-5 rotate-45 border-t-[3px] border-l-[3px] bg-white"
        style={{ borderColor: INK }}
        aria-hidden
      />
      {who && <span className="font-extrabold">{who} </span>}
      {children}
    </div>
  );
}

function AwardCard({ card }: { card: RecapCard }) {
  const style = STYLE[card.kind] ?? { bg: "#FFD23F" };
  return (
    <Panel bg={style.bg} light={style.light} label={`${card.title}: ${card.manager}, ${card.stat}`}>
      <div className="pr-24">
        <ComicTitle>{card.title}</ComicTitle>
      </div>
      <div className="absolute top-4 right-3 rotate-[8deg]">
        <Sticker kind={card.kind} className="h-24 w-24" />
      </div>
      <span
        className="mt-3 self-start rounded-full border-[3px] bg-white px-3 py-1 text-sm font-extrabold text-zinc-900 tabular-nums"
        style={{ borderColor: INK }}
      >
        {card.stat}
      </span>
      <div className="flex flex-1 items-end gap-2">
        <Raptor seed={card.team_id ?? card.manager.length * 7919} mood={SAD_KINDS.has(card.kind) ? "sad" : "smug"} className="-mb-2 h-32 w-32 shrink-0" />
        <span className={`mb-4 text-2xl ${style.light ? "text-white" : "text-zinc-900"}`} style={COMIC}>
          {card.manager}
        </span>
      </div>
      <Bubble>{card.caption || card.stat}</Bubble>
    </Panel>
  );
}

function Cover({ recap, leagueName }: { recap: Recap; leagueName: string }) {
  const cast = (recap.cards ?? []).filter((c, i, all) => all.findIndex((x) => x.manager === c.manager) === i).slice(0, 4);
  return (
    <Panel bg="#1B1B1E" light label={`GW${recap.gameweek_id} recap: ${recap.title}`}>
      <p className="flex justify-between text-sm font-semibold text-white/70">
        <span>{leagueName}</span>
        <span aria-hidden>Swipe →</span>
      </p>
      <h3 className="mt-1 text-[52px] leading-[0.9] text-[#FFD23F]" style={{ ...COMIC, textShadow: "4px 4px 0 #E63946" }}>
        GW{recap.gameweek_id}
        <br />
        Recap
      </h3>
      <div className="mt-4">
        <Bubble>{recap.title}</Bubble>
      </div>
      <div className="mt-auto -mb-6 flex justify-center">
        {cast.map((c, i) => (
          <Raptor key={c.id} seed={c.team_id ?? i} className={`h-24 w-24 ${i % 2 ? "-mt-3" : ""}`} />
        ))}
      </div>

    </Panel>
  );
}

function Reactions({
  cardId,
  tally,
  onReact,
}: {
  cardId: string;
  tally: Tally;
  onReact: (cardId: string, emoji: Reaction | null) => void;
}) {
  const mine = tally.mine[cardId];
  return (
    <div className="mt-3 flex justify-center gap-2" role="group" aria-label="React">
      {REACTIONS.map((r) => {
        const count = tally.counts[cardId]?.[r] ?? 0;
        const on = mine === r;
        return (
          <button
            key={r}
            type="button"
            aria-pressed={on}
            aria-label={`${r}${count ? `, ${count}` : ""}`}
            onClick={() => onReact(cardId, on ? null : r)}
            className={`flex min-w-12 items-center justify-center gap-1 rounded-full border-2 px-2.5 py-1 text-base transition-transform active:scale-90 ${
              on ? "border-zinc-900 bg-[#FFD23F] text-zinc-900 dark:border-[#FFD23F]" : "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
            }`}
          >
            <span aria-hidden>{REACTION_EMOJI[r]}</span>
            {count > 0 && <span className="text-xs font-bold tabular-nums">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export default function RecapStory({
  recap,
  leagueId,
  leagueName,
  reactions,
}: {
  recap: Recap;
  leagueId: number;
  leagueName: string;
  reactions: Tally | null; // null: reactions aren't available to you here
}) {
  const cards = recap.cards ?? [];
  const slides: { id: string; node: React.ReactNode }[] = [
    { id: "cover", node: <Cover recap={recap} leagueName={leagueName} /> },
    ...cards.map((c) => ({ id: c.id, node: <AwardCard card={c} /> })),
  ];
  const scroller = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [tally, setTally] = useState<Tally | null>(reactions);
  const [, startReacting] = useTransition();

  const go = (i: number) => {
    const el = scroller.current;
    const target = el?.children[Math.max(0, Math.min(slides.length - 1, i))] as HTMLElement | undefined;
    if (el && target) el.scrollTo({ left: target.offsetLeft - el.offsetLeft - 16, behavior: "smooth" });
  };
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const width = (el.children[0] as HTMLElement | undefined)?.offsetWidth ?? 1;
    setIndex(Math.round(el.scrollLeft / (width + 12)));
  };
  const onReact = (cardId: string, emoji: Reaction | null) => {
    if (!tally) return;
    const before = tally;
    setTally(applyReaction(tally, cardId, emoji));
    startReacting(async () => {
      const res = await react({ leagueId, gameweekId: recap.gameweek_id, cardId, emoji });
      if (!res.ok) setTally(before);
    });
  };

  return (
    <section id="recap" className="scroll-mt-4" aria-label={`Gameweek ${recap.gameweek_id} recap`}>
      <div
        ref={scroller}
        onScroll={onScroll}
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pt-1 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((s) => (
          <div key={s.id} className="w-[86%] max-w-[400px] shrink-0 snap-center">
            {s.node}
            {tally && s.id !== "cover" && <Reactions cardId={s.id} tally={tally} onReact={onReact} />}
          </div>
        ))}
      </div>
      <div className="mt-1 flex items-center justify-between">
        <button
          type="button"
          onClick={() => go(index - 1)}
          disabled={index === 0}
          className="rounded-full px-3 py-1 text-sm font-semibold text-zinc-600 disabled:opacity-30 dark:text-zinc-300"
          aria-label="Previous card"
        >
          ← Back
        </button>
        <div className="flex gap-1.5" aria-hidden>
          {slides.map((s, i) => (
            <span key={s.id} className={`h-2 rounded-full transition-all ${i === index ? "w-5 bg-zinc-900 dark:bg-white" : "w-2 bg-zinc-300 dark:bg-zinc-700"}`} />
          ))}
        </div>
        <button
          type="button"
          onClick={() => go(index + 1)}
          disabled={index >= slides.length - 1}
          className="rounded-full px-3 py-1 text-sm font-semibold text-zinc-600 disabled:opacity-30 dark:text-zinc-300"
          aria-label="Next card"
        >
          Next →
        </button>
      </div>
      <details className="group mt-3 rounded-2xl border border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <summary className="cursor-pointer list-none font-semibold">
          Read the full roast <span className="text-zinc-400 group-open:hidden">+</span>
          <span className="hidden text-zinc-400 group-open:inline">−</span>
        </summary>
        <div className="mt-2 space-y-3 text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300">
          {recap.body
            .split(/\n\s*\n/)
            .filter((p) => p.trim())
            .map((p, i) => (
              <p key={i}>{p.trim()}</p>
            ))}
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          Awards come from the numbers; the jokes are written by AI ({recap.model}). It only knows the stats, so don&apos;t take it
          personally.
        </p>
      </details>
    </section>
  );
}
