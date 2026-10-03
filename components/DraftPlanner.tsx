"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { deleteDraft, saveDraft, type SavedDraft } from "@/app/planner/actions";
import Pitch from "@/components/Pitch";
import { usePlayerSheet } from "@/components/PlayerSheet";
import Sheet from "@/components/Sheet";
import Shirt from "@/components/Shirt";
import {
  canSwap,
  CHIP_LABELS,
  cleanMoves,
  replacements,
  simulate,
  type Chip,
  type DraftBase,
  type DraftPlayer,
  type DraftWeek,
  type Move,
} from "@/lib/draft";
import { formatPrice } from "@/lib/fpl";
import { fixtureCaption, type PitchPlayer } from "@/lib/pitch";

export type TeamFixtures = Record<number, Record<number, { opponent: string; home: boolean; difficulty: number | null }[]>>;

type Props = {
  base: DraftBase;
  players: DraftPlayer[];
  fixtures: TeamFixtures; // club id -> gameweek -> matches
  botMoves: Move[] | null;
  drafts: SavedDraft[] | null; // null: saving isn't available
};

const CHIP_ORDER: Chip[] = ["wildcard", "freehit", "bboost", "3xc"];
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}`;

function Button({
  onClick,
  children,
  disabled = false,
  primary = false,
}: {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap disabled:opacity-40 ${
        primary
          ? "bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-600"
          : "bg-zinc-100 text-zinc-800 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
      }`}
    >
      {children}
    </button>
  );
}

function SheetAction({ onClick, children, note }: { onClick: () => void; children: React.ReactNode; note?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900"
    >
      <span className="font-medium">{children}</span>
      {note && <span className="text-sm text-zinc-500">{note}</span>}
    </button>
  );
}

export default function DraftPlanner({ base, players, fixtures, botMoves, drafts: savedDrafts }: Props) {
  const lookup = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const { open: openCard } = usePlayerSheet();
  const storageKey = `raptor-draft-gw${base.gameweeks[0]}`;

  const [moves, setMoves] = useState<Move[]>([]);
  const [draft, setDraft] = useState<{ id: string | null; name: string } | null>(null);
  const [weekIndex, setWeekIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [replacing, setReplacing] = useState<number | null>(null);
  const [swapFrom, setSwapFrom] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [showDrafts, setShowDrafts] = useState(false);
  const [drafts, setDrafts] = useState(savedDrafts);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  // Unsaved work survives a refresh on this device.
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
      if (saved) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring once after hydration
        setMoves(cleanMoves(saved.moves));
        setDraft(saved.draft ?? null);
      }
    } catch {
      // Nothing saved, or storage is blocked.
    }
  }, [storageKey]);
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ moves, draft }));
    } catch {
      // Not kept on this device, which is fine.
    }
  }, [moves, draft, storageKey]);

  const result = useMemo(() => simulate(base, lookup, moves), [base, lookup, moves]);
  const keep = useMemo(() => simulate(base, lookup, []), [base, lookup]);
  const bot = useMemo(() => (botMoves ? simulate(base, lookup, botMoves) : null), [base, lookup, botMoves]);
  const week: DraftWeek = result.weeks[weekIndex] ?? result.weeks[0];
  const gw = week.gameweek;
  const original = new Set(base.squad);
  const range = `GW${base.gameweeks[0]}-${base.gameweeks[base.gameweeks.length - 1]}`;

  const add = (move: Move) => {
    setMoves((m) => [...m, move]);
    setNotice(null);
  };
  const undo = () => setMoves((m) => m.slice(0, -1));

  const isStarter = (id: number) => week.xi.includes(id);
  const swapCandidate = (id: number) =>
    swapFrom !== null &&
    id !== swapFrom &&
    (isStarter(swapFrom) ? week.bench.includes(id) && canSwap(week, lookup, swapFrom, id) : isStarter(id) && canSwap(week, lookup, id, swapFrom));

  const slot = (id: number): PitchPlayer => {
    const p = lookup.get(id);
    const fx = fixtureCaption((p ? fixtures[p.team]?.[gw] : undefined) ?? []);
    const out = p && (["i", "s", "u", "n"].includes(p.status) || p.chance === 0);
    const doubtful = p && !out && (p.status === "d" || (p.chance != null && p.chance < 100));
    return {
      id,
      name: p?.name ?? `#${id}`,
      position: p?.position ?? 3,
      club: p?.club ?? "?",
      caption: fx.caption,
      tone: fx.tone,
      number: (p?.xp[weekIndex] ?? 0).toFixed(1),
      badge: id === week.captain ? (week.chip === "3xc" ? "TC" : "C") : id === week.vice ? "V" : null,
      alert: out ? "out" : doubtful ? "doubtful" : null,
      ring: swapFrom !== null ? (swapCandidate(id) || id === swapFrom ? "pick" : null) : original.has(id) ? null : "in",
      dim: swapFrom !== null && id !== swapFrom && !swapCandidate(id),
    };
  };

  const onSelect = (id: number) => {
    if (swapFrom === null) return setSelected(id);
    if (id === swapFrom) return setSwapFrom(null);
    if (!swapCandidate(id)) return setNotice("That swap would break the formation. Pick a highlighted player.");
    const [starter, benched] = isStarter(swapFrom) ? [swapFrom, id] : [id, swapFrom];
    add({ kind: "swap", gw, bench: starter, start: benched });
    setSwapFrom(null);
  };

  // Chips you could play this week (each copy once in the draft).
  const chipChoices = CHIP_ORDER.filter((c) => base.chipsLeft.some((x) => x.chip === c && x.from <= gw && gw <= x.expires)).map((c) => {
    const copies = base.chipsLeft.filter((x) => x.chip === c).length;
    const elsewhere = result.weeks.filter((w) => w.chip === c && w.gameweek !== gw).map((w) => w.gameweek);
    return { chip: c, usedIn: elsewhere.length >= copies ? elsewhere[0] : null };
  });

  const save = (asNew: boolean) =>
    startSaving(async () => {
      const name = draft && !asNew ? draft.name : `Draft ${(drafts?.length ?? 0) + 1}`;
      const res = await saveDraft({ id: asNew ? null : (draft?.id ?? null), name, fromGameweek: base.gameweeks[0], moves });
      if (!res.ok) return setNotice(res.error);
      setDraft({ id: res.draft.id, name: res.draft.name });
      setDrafts((list) => [res.draft, ...(list ?? []).filter((d) => d.id !== res.draft.id)]);
      setNotice(`Saved as ${res.draft.name}.`);
    });

  const selectedPlayer = selected !== null ? lookup.get(selected) : null;
  const replacingPlayer = replacing !== null ? lookup.get(replacing) : null;
  const options = replacing !== null ? replacements(result, weekIndex, replacing, players, query).slice(0, 60) : [];
  const budget = replacingPlayer ? week.bankAfter + (week.sell[replacingPlayer.id] ?? replacingPlayer.price) : 0;

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-semibold">{draft?.name ?? "Your draft"}</h2>
          <span className="text-xs text-zinc-500">{range}</span>
        </div>
        <div className="mt-1 flex items-end justify-between gap-3">
          <div className="text-3xl font-bold tabular-nums">
            {result.total.toFixed(1)}
            <span className="ml-1 text-base font-medium text-zinc-500">xP</span>
          </div>
          <dl className="text-right text-sm tabular-nums">
            <div>
              <dt className="inline text-zinc-500">vs keeping your team </dt>
              <dd className={`inline font-semibold ${result.total - keep.total >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}>
                {signed(result.total - keep.total)}
              </dd>
            </div>
            {bot && (
              <div>
                <dt className="inline text-zinc-500">vs the bot&apos;s plan </dt>
                <dd className="inline font-semibold">{signed(result.total - bot.total)}</dd>
              </div>
            )}
          </dl>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={undo} disabled={moves.length === 0}>
            Undo
          </Button>
          <Button onClick={() => (setMoves([]), setDraft(null))} disabled={moves.length === 0 && !draft}>
            Start over
          </Button>
          {botMoves && (
            <Button
              onClick={() => {
                setMoves(botMoves);
                setDraft(null);
                setNotice("Loaded the bot's plan. Change anything you like.");
              }}
            >
              Use the bot&apos;s plan
            </Button>
          )}
          {drafts && (
            <Button onClick={() => setShowDrafts(true)} primary>
              {saving ? "Saving…" : "Drafts"}
            </Button>
          )}
        </div>
      </section>

      <div className="flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900" role="tablist" aria-label="Gameweek">
        {result.weeks.map((w, i) => (
          <button
            key={w.gameweek}
            type="button"
            role="tab"
            aria-selected={i === weekIndex}
            onClick={() => (setWeekIndex(i), setSwapFrom(null))}
            className={`flex-1 rounded-lg py-1.5 text-sm font-medium ${i === weekIndex ? "bg-white shadow-sm dark:bg-zinc-800" : "text-zinc-600 dark:text-zinc-400"}`}
          >
            GW{w.gameweek}
            {(w.transfers.length > 0 || w.chip) && (
              <span className={`ml-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${w.chip ? "bg-violet-500" : "bg-emerald-500"}`} />
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
        <span className="text-zinc-600 dark:text-zinc-400">
          {week.chip === "wildcard" || week.chip === "freehit"
            ? "Unlimited transfers"
            : `${week.freeTransfers} free transfer${week.freeTransfers === 1 ? "" : "s"}`}
          {week.hits > 0 ? `, −${4 * week.hits} hit` : ""}, {formatPrice(week.bankAfter)} in the bank
        </span>
        <span className="font-semibold tabular-nums">{week.points.toFixed(1)} xP</span>
      </div>

      {chipChoices.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Chips">
          {chipChoices.map(({ chip, usedIn }) => {
            const on = week.chip === chip;
            return (
              <button
                key={chip}
                type="button"
                aria-pressed={on}
                disabled={!on && usedIn !== null}
                onClick={() => add({ kind: "chip", gw, chip: on ? null : chip })}
                className={`rounded-full border px-3 py-1 text-sm disabled:opacity-40 ${
                  on
                    ? "border-violet-600 bg-violet-600 text-white"
                    : "border-zinc-300 text-zinc-700 hover:border-violet-400 dark:border-zinc-700 dark:text-zinc-300"
                }`}
              >
                {CHIP_LABELS[chip]}
                {!on && usedIn !== null ? ` (GW${usedIn})` : ""}
              </button>
            );
          })}
        </div>
      )}

      {week.transfers.length > 0 && (
        <ul className="flex flex-col gap-1.5 rounded-2xl border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          {week.transfers.map((t) => (
            <li key={`${t.out}-${t.in}`} className="flex items-center gap-2">
              <span className="truncate font-medium text-rose-700 dark:text-rose-400">{lookup.get(t.out)?.name}</span>
              <span className="text-zinc-400">›</span>
              <span className="truncate font-medium text-emerald-700 dark:text-emerald-400">{lookup.get(t.in)?.name}</span>
            </li>
          ))}
          {week.chip === "freehit" && <li className="text-xs text-zinc-500">Free Hit: your squad comes back next week.</li>}
        </ul>
      )}

      {swapFrom !== null && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/60 dark:text-amber-100">
          <span>
            {isStarter(swapFrom) ? "Pick a bench player to bring on for" : "Pick a starter to bench for"} {lookup.get(swapFrom)?.name}.
          </span>
          <button type="button" className="font-semibold underline-offset-2 hover:underline" onClick={() => setSwapFrom(null)}>
            Cancel
          </button>
        </div>
      )}
      {notice && <p className="rounded-xl bg-zinc-100 px-3 py-2 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">{notice}</p>}
      {result.problems.length > 0 && (
        <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/60 dark:text-amber-100">
          Some moves no longer work and were skipped: {result.problems.join("; ")}.
        </div>
      )}

      <Pitch
        starters={week.xi.map(slot)}
        bench={week.bench.map(slot)}
        benchNote={week.chip === "bboost" ? "Bench Boost: all count" : undefined}
        onSelect={onSelect}
      />
      <p className="text-xs text-zinc-500">
        Tap a player to transfer, captain or bench them. Shirts show expected points for GW{gw}; ringed players are new
        signings. Your best XI is picked for you each week unless you swap someone.
      </p>

      {selectedPlayer && selected !== null && (
        <Sheet
          title={
            <span>
              {selectedPlayer.name}{" "}
              <span className="font-normal text-zinc-500">
                {(selectedPlayer.xp[weekIndex] ?? 0).toFixed(1)} xP in GW{gw}
              </span>
            </span>
          }
          onClose={() => setSelected(null)}
        >
          <div className="divide-y divide-zinc-100 pb-3 dark:divide-zinc-900">
            <SheetAction
              note={`sells for ${formatPrice(week.sell[selected] ?? selectedPlayer.price)}`}
              onClick={() => (setReplacing(selected), setQuery(""), setSelected(null))}
            >
              Transfer out
            </SheetAction>
            {isStarter(selected) && selected !== week.captain && (
              <SheetAction onClick={() => (add({ kind: "captain", gw, id: selected }), setSelected(null))}>Make captain</SheetAction>
            )}
            {week.bench.some((b) => (isStarter(selected) ? canSwap(week, lookup, selected, b) : week.xi.some((s) => canSwap(week, lookup, s, selected)))) && (
              <SheetAction onClick={() => (setSwapFrom(selected), setSelected(null))}>
                {isStarter(selected) ? "Move to the bench" : "Bring on"}
              </SheetAction>
            )}
            <SheetAction onClick={() => (openCard(selected), setSelected(null))}>Player card</SheetAction>
          </div>
        </Sheet>
      )}

      {replacingPlayer && (
        <Sheet title={`Replace ${replacingPlayer.name} in GW${gw}`} onClose={() => setReplacing(null)} tall>
          <div className="sticky top-0 z-10 bg-white px-5 pt-3 pb-2 dark:bg-zinc-950">
            <p className="text-xs text-zinc-500">
              Up to {formatPrice(budget)}: {formatPrice(week.bankAfter)} in the bank plus{" "}
              {formatPrice(week.sell[replacingPlayer.id] ?? replacingPlayer.price)} for {replacingPlayer.name}.
            </p>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or club (e.g. ARS)"
              className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600 dark:border-zinc-700 dark:bg-zinc-900"
              aria-label="Search players"
            />
            <div className="mt-2 flex justify-between text-[11px] text-zinc-500">
              <span>Best outlook first</span>
              <span>
                GW{gw} / to GW{base.gameweeks[base.gameweeks.length - 1]}
              </span>
            </div>
          </div>
          <ul className="divide-y divide-zinc-100 px-2 pb-4 dark:divide-zinc-900">
            {options.map((o) => (
              <li key={o.player.id}>
                <button
                  type="button"
                  disabled={!o.ok}
                  onClick={() => {
                    add({ kind: "transfer", gw, out: replacingPlayer.id, in: o.player.id });
                    setReplacing(null);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-zinc-50 disabled:opacity-45 dark:hover:bg-zinc-900"
                >
                  <Shirt club={o.player.club} goalkeeper={o.player.position === 1} className="h-8 w-9 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {o.player.name}
                      {o.player.status !== "a" && <span className="ml-1 text-amber-600">!</span>}
                    </span>
                    <span className="block truncate text-xs text-zinc-500">
                      {o.player.club}, {formatPrice(o.player.price)}
                      {o.player.owned != null ? `, ${o.player.owned}% owned` : ""}
                      {o.reason ? `. ${o.reason}` : ""}
                    </span>
                  </span>
                  <span className="text-right text-sm tabular-nums">
                    <span className="block font-semibold">{o.xpWeek.toFixed(1)}</span>
                    <span className="block text-xs text-zinc-500">{o.xpRest.toFixed(1)}</span>
                  </span>
                </button>
              </li>
            ))}
            {options.length === 0 && <li className="px-3 py-6 text-sm text-zinc-500">No one matches that search.</li>}
          </ul>
        </Sheet>
      )}

      {showDrafts && drafts && (
        <Sheet title="Drafts" onClose={() => setShowDrafts(false)}>
          <div className="flex gap-2 px-5 pt-4">
            {draft?.id && (
              <Button primary onClick={() => save(false)} disabled={saving}>
                Save {draft.name}
              </Button>
            )}
            <Button primary={!draft?.id} onClick={() => save(true)} disabled={saving}>
              Save as new draft
            </Button>
          </div>
          <ul className="divide-y divide-zinc-100 px-2 pt-2 pb-4 dark:divide-zinc-900">
            {drafts.length === 0 && <li className="px-3 py-4 text-sm text-zinc-500">No saved drafts yet. Saved drafts follow you to any device.</li>}
            {drafts.map((d) => {
              const total = simulate(base, lookup, cleanMoves(d.moves)).total;
              return (
                <li key={d.id} className="flex items-center gap-3 px-3 py-2.5">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      setMoves(cleanMoves(d.moves));
                      setDraft({ id: d.id, name: d.name });
                      setShowDrafts(false);
                      setNotice(d.from_gameweek < base.gameweeks[0] ? `${d.name} started at GW${d.from_gameweek}; past weeks are skipped.` : `Loaded ${d.name}.`);
                    }}
                  >
                    <span className="block font-medium">{d.name}</span>
                    <span className="block text-xs text-zinc-500 tabular-nums">
                      {total.toFixed(1)} xP over {range}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="rounded-full px-2 py-1 text-sm text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950"
                    onClick={() =>
                      startSaving(async () => {
                        const res = await deleteDraft(d.id);
                        if (!res.ok) return setNotice("Couldn't delete that draft.");
                        setDrafts((list) => (list ?? []).filter((x) => x.id !== d.id));
                        if (draft?.id === d.id) setDraft(null);
                      })
                    }
                  >
                    Delete
                  </button>
                </li>
              );
            })}
          </ul>
        </Sheet>
      )}
    </div>
  );
}
