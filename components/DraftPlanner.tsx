"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { deleteDraft, saveDraft, type SavedDraft } from "@/app/planner/actions";
import GameweekPicker from "@/components/GameweekPicker";
import PlayerLink from "@/components/PlayerLink";
import { hasDraftProjection, moveSignature, readLocalDraft, readPlannerHandoff, type DraftIdentity, type PredictionCoverage } from "@/lib/plannerView";
import Pitch from "@/components/Pitch";
import { usePlayerSheet } from "@/components/PlayerSheet";
import { HANDOFF } from "@/lib/ask/handoff";
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
  storageKey: string;
  predictionCoverage: PredictionCoverage;
  notes: string[];
  botRange: string | null;
  fixturesAvailable: boolean;
  base: DraftBase;
  players: DraftPlayer[];
  fixtures: TeamFixtures; // club id -> gameweek -> matches
  botMoves: Move[] | null;
  drafts: SavedDraft[] | null; // null: saving isn't available
};

type Replacement = {
  title: string;
  description: string;
  moves: Move[];
  draft: DraftIdentity | null;
  savedMoves: Move[];
  notice: string;
  source?: "handoff" | "legacy";
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
      className={`${primary ? "button-primary" : "button-secondary"} disabled:opacity-40`}
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
      className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-surface-muted"
    >
      <span className="font-medium">{children}</span>
      {note && <span className="text-sm text-muted">{note}</span>}
    </button>
  );
}

export default function DraftPlanner({ base, players, fixtures, botMoves, drafts: savedDrafts, storageKey, predictionCoverage, notes, botRange, fixturesAvailable }: Props) {
  const lookup = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const { open: openCard } = usePlayerSheet();
  const firstGameweek = base.gameweeks[0];

  const [moves, setMoves] = useState<Move[]>([]);
  const [draft, setDraft] = useState<DraftIdentity | null>(null);
  const [savedMoves, setSavedMoves] = useState<Move[]>([]);
  const [ready, setReady] = useState(false);
  const restoredScope = useRef<string | null>(null);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [incoming, setIncoming] = useState<Replacement[]>([]);
  const [replacement, setReplacement] = useState<Replacement | null>(null);
  const [showTools, setShowTools] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedDraft | null>(null);
  const [weekIndex, setWeekIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [replacing, setReplacing] = useState<number | null>(null);
  const [swapFrom, setSwapFrom] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [showDrafts, setShowDrafts] = useState(false);
  const [drafts, setDrafts] = useState(savedDrafts);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  // Read once before any writes, including React's development effect replay.
  useEffect(() => {
    if (restoredScope.current === storageKey) return;
    restoredScope.current = storageKey;
    const available: Replacement[] = [];
    try {
      const local = readLocalDraft(window.localStorage.getItem(storageKey));
      if (!local) {
        const legacy = readLocalDraft(window.localStorage.getItem(`raptor-draft-gw${firstGameweek}`));
        const owned = legacy?.draft && savedDrafts?.find((item) => item.id === legacy.draft?.id);
        if (legacy && (legacy.moves.length || legacy.draft)) available.push({ title: "Recover an older local draft?", description: "This older draft has no account label. Confirm it belongs to this team before loading it.", moves: legacy.moves, draft: owned ? { id: owned.id, name: owned.name } : null, savedMoves: owned ? cleanMoves(owned.moves) : [], notice: "Recovered local moves. Review them before saving.", source: "legacy" });
      }
      if (local) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring the account's saved device state once
        setMoves(local.moves);
        setDraft(local.draft);
        setSavedMoves(local.savedMoves);
      }
      const handoff = readPlannerHandoff(window.localStorage.getItem(HANDOFF), firstGameweek);
      if (handoff) available.push({ title: "Load the Ask Raptor scenario?", description: handoff.label, moves: handoff.moves, draft: null, savedMoves: [], notice: `Loaded from Ask Raptor: ${handoff.label}`, source: "handoff" });
      setIncoming(available);
    } catch { setStorageBlocked(true); }
    setReady(true);
  }, [storageKey, firstGameweek, savedDrafts]);
  useEffect(() => {
    if (!ready) return;
    try { window.localStorage.setItem(storageKey, JSON.stringify({ moves, draft, savedMoves })); }
    catch {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- report a failed external-storage write
      setStorageBlocked(true);
    }
  }, [ready, moves, draft, savedMoves, storageKey]);

  const result = useMemo(() => simulate(base, lookup, moves), [base, lookup, moves]);
  const keep = useMemo(() => simulate(base, lookup, []), [base, lookup]);
  const bot = useMemo(() => (botMoves ? simulate(base, lookup, botMoves) : null), [base, lookup, botMoves]);
  const week: DraftWeek = result.weeks[weekIndex] ?? result.weeks[0];
  const gw = week.gameweek;
  const original = new Set(base.squad);
  const dirty = draft ? moveSignature(moves) !== moveSignature(savedMoves) : moves.length > 0;
  const weekReady = hasDraftProjection(week, predictionCoverage);
  const totalReady = result.weeks.every((item) => hasDraftProjection(item, predictionCoverage));
  const keepReady = keep.weeks.every((item) => hasDraftProjection(item, predictionCoverage));
  const botReady = bot?.weeks.every((item) => hasDraftProjection(item, predictionCoverage));
  const range = `GW${base.gameweeks[0]}-${base.gameweeks[base.gameweeks.length - 1]}`;

  const add = (move: Move) => {
    if (!ready) return;
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
    const fx = fixturesAvailable ? fixtureCaption((p ? fixtures[p.team]?.[gw] : undefined) ?? []) : { caption: "Fixture —", tone: "muted" as const };
    const out = p && (["i", "s", "u", "n"].includes(p.status) || p.chance === 0);
    const doubtful = p && !out && (p.status === "d" || (p.chance != null && p.chance < 100));
    return {
      id,
      name: p?.name ?? `#${id}`,
      position: p?.position ?? 3,
      club: p?.club ?? "?",
      caption: fx.caption,
      tone: fx.tone,
      number: predictionCoverage[id]?.includes(gw) ? (p?.xp[weekIndex] ?? 0).toFixed(1) : null,
      badge: id === week.captain ? (week.chip === "3xc" ? "TC" : "C") : id === week.vice ? "V" : null,
      alert: out ? "out" : doubtful ? "doubtful" : null,
      ring: swapFrom !== null ? (swapCandidate(id) || id === swapFrom ? "pick" : null) : original.has(id) ? null : "in",
      dim: swapFrom !== null && id !== swapFrom && !swapCandidate(id),
    };
  };

  const onSelect = (id: number) => {
    if (!ready) return;
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

  const applyReplacement = (next: Replacement) => {
    setMoves(next.moves);
    setDraft(next.draft);
    setSavedMoves(next.savedMoves);
    setSwapFrom(null);
    setSelected(null);
    setReplacing(null);
    setNotice(next.notice);
    setReplacement(null);
    setShowDrafts(false);
    setShowTools(false);
    if (next.source) {
      setIncoming((items) => items.filter((item) => item.source !== next.source));
      if (next.source === "handoff") try { window.localStorage.removeItem(HANDOFF); } catch { /* storage blocked */ }
    }
  };
  const requestReplacement = (next: Replacement) => {
    if (saving || !ready) return;
    if (dirty || next.source) setReplacement(next);
    else applyReplacement(next);
  };
  const openSave = () => {
    setSaveError(null);
    setSaveName(draft?.name ?? `Draft ${(drafts?.length ?? 0) + 1}`);
    setShowSave(true);
  };
  const save = (asNew: boolean, name: string) => {
    const snapshot = [...moves];
    setSaveError(null);
    startSaving(async () => {
      try {
        const response = await saveDraft({ id: asNew ? null : draft?.id ?? null, name, fromGameweek: firstGameweek, moves: snapshot });
        if (!response.ok) { setSaveError(response.error); setNotice(response.error); return; }
        setDraft({ id: response.draft.id, name: response.draft.name });
        setSavedMoves(snapshot);
        setDrafts((list) => [response.draft, ...(list ?? []).filter((item) => item.id !== response.draft.id)]);
        setShowSave(false);
        setShowTools(false);
        setShowDrafts(false);
        setNotice(`Saved ${response.draft.name}.`);
      } catch { setSaveError("Couldn’t save this draft. Your edits are still here; try again."); }
    });
  };

  const selectedPlayer = selected !== null ? lookup.get(selected) : null;
  const replacingPlayer = replacing !== null ? lookup.get(replacing) : null;
  const options = replacing !== null ? replacements(result, weekIndex, replacing, players, query).slice(0, 60) : [];
  const budget = replacingPlayer ? week.bankAfter + (week.sell[replacingPlayer.id] ?? replacingPlayer.price) : 0;

  return (
    <div className="space-y-5">
      <section className="surface p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="section-title">{draft?.name ?? "Your draft"}</h2><p className="mt-1 text-xs text-muted">{!ready ? "Restoring draft…" : dirty ? "Unsaved changes" : draft ? "Saved draft" : "No changes yet"} · {range}</p></div>
          <div className="flex flex-wrap gap-2">
            {drafts && <Button onClick={() => draft ? save(false, draft.name) : openSave()} disabled={!ready || saving || Boolean(draft && !dirty)} primary>{saving ? "Saving…" : draft ? "Save changes" : "Save draft"}</Button>}
            <Button onClick={undo} disabled={!ready || moves.length === 0}>Undo</Button>
            <Button onClick={() => setShowTools(true)} disabled={!ready || saving}>More</Button>
          </div>
        </div>
        {storageBlocked && <p className="mt-3 text-xs text-warning">This browser can’t keep local edits. Save a draft before leaving.</p>}
        {drafts === null && <p className="mt-3 text-xs text-muted">Saved drafts couldn’t load. Local edits are still available on this device.</p>}
      </section>
      {incoming.map((item) => <div key={item.source} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-accent-soft px-4 py-3 text-sm"><p>{item.source === "handoff" ? "Ask Raptor sent a scenario." : "An older draft is available on this device."}</p><button type="button" className="text-link min-h-9" onClick={() => requestReplacement(item)}>Review {item.source === "handoff" ? "scenario" : "local draft"}</button></div>)}
      {notice && <p role="status" className="rounded-xl bg-surface-muted px-4 py-3 text-sm">{notice}</p>}
      {saveError && !showSave && <p role="alert" className="text-sm text-warning">{saveError}</p>}
      <GameweekPicker weeks={result.weeks} selected={weekIndex} onSelect={(index) => { setWeekIndex(index); setSwapFrom(null); }} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:gap-8">
        <div className="min-w-0 space-y-4">
          <section className="surface sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 px-4 py-3" aria-label="Selected week budget">
            <div><h3 className="text-sm font-semibold">GW{gw}{week.chip ? ` · ${CHIP_LABELS[week.chip]}` : ""}</h3><p className="mt-1 text-xs text-muted">{week.chip === "wildcard" || week.chip === "freehit" ? "Unlimited transfers" : `${week.freeTransfers} free transfers`} · {formatPrice(week.bankAfter)} bank{week.hits > 0 ? ` · −${week.hits * 4} hit` : " · no hit"}</p></div>
            <p className="text-sm font-semibold tabular-nums">{weekReady ? week.points.toFixed(1) : "—"} <span className="font-normal text-muted">net xP</span></p>
            {notes.length > 0 && <p className="basis-full text-xs text-warning">Some data is estimated or unavailable. Check Budget & data below.</p>}
          </section>
          {!weekReady && <p className="text-xs text-muted">Some predictions are unavailable. Estimates appear when all counting players have a projection.</p>}
          {week.transfers.length > 0 && <ul className="surface space-y-2 p-3 text-sm">{week.transfers.map((transfer) => <li key={`${transfer.out}-${transfer.in}`} className="flex min-w-0 items-center gap-2"><PlayerLink id={transfer.out} className="truncate text-rose-700 dark:text-rose-300">{lookup.get(transfer.out)?.name}</PlayerLink><span aria-label="replaced by">→</span><PlayerLink id={transfer.in} className="truncate font-medium text-accent">{lookup.get(transfer.in)?.name}</PlayerLink></li>)}{week.chip === "freehit" && <li className="text-xs text-muted">Free Hit: your squad comes back next week.</li>}</ul>}
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
      <p className="text-xs leading-relaxed text-muted">
        Tap a player to transfer, captain or bench them. Shirts show expected points for GW{gw}; ringed players are new
        signings. Your best XI is picked for you each week unless you swap someone.
      </p>

        </div>
        <aside className="min-w-0 space-y-4">
          <section className="surface p-5"><p className="text-xs text-muted">Expected points over {range}, after hits</p><p className="mt-1 text-3xl font-semibold tabular-nums">{totalReady ? result.total.toFixed(1) : "—"} <span className="text-sm font-normal text-muted">xP</span></p><dl className="mt-4 space-y-2 text-sm"><div className="flex justify-between gap-3"><dt className="text-muted">vs keeping your squad</dt><dd className="font-semibold tabular-nums">{totalReady && keepReady ? signed(result.total - keep.total) : "—"}</dd></div>{bot && <div className="flex justify-between gap-3"><dt className="text-muted">vs suggested plan</dt><dd className="font-semibold tabular-nums">{totalReady && botReady ? signed(result.total - bot.total) : "—"}</dd></div>}</dl><p className="mt-3 text-xs leading-relaxed text-muted">Your draft covers {range}.{botRange ? ` The suggestion covers ${botRange}; this comparison replays its moves over the draft’s full horizon.` : ""}</p></section>
          <details className="disclosure surface" open={chipChoices.some((item) => item.chip === week.chip)}><summary className="flex min-h-14 items-center justify-between gap-3 p-5 text-sm font-semibold">Chip for GW{gw}<span aria-hidden>⌄</span></summary><div className="space-y-2 px-5 pb-5">{chipChoices.length ? chipChoices.map(({ chip, usedIn }) => <button key={chip} type="button" aria-pressed={week.chip === chip} disabled={week.chip !== chip && usedIn !== null} onClick={() => add({ kind: "chip", gw, chip: week.chip === chip ? null : chip })} className={`flex min-h-11 w-full items-center justify-between rounded-lg border px-3 text-sm disabled:opacity-45 ${week.chip === chip ? "border-accent bg-accent-soft text-accent" : "border-line"}`}><span>{CHIP_LABELS[chip]}</span><span className="text-xs">{week.chip === chip ? "Selected" : usedIn !== null ? `GW${usedIn}` : "Add to draft"}</span></button>) : <p className="text-sm text-muted">No available chips are recorded for this week.</p>}</div></details>
          <details className="disclosure surface"><summary className="flex min-h-14 items-center justify-between gap-3 p-5 text-sm font-semibold">Budget & data<span aria-hidden>⌄</span></summary><div className="space-y-3 px-5 pb-5 text-xs leading-relaxed text-muted"><p>Bank and transfers use a recorded snapshot. Selling prices come from the current plan when available.</p>{notes.map((note) => <p key={note}>{note}</p>)}<p>Your best XI is chosen each week unless you swap players. Changes here stay in this planner; apply them yourself in FPL.</p></div></details>
          {notes.length > 0 && <p className="text-xs leading-relaxed text-warning">Open Budget & data for the estimates and unavailable information affecting this draft.</p>}
          {drafts && <button type="button" className="button-secondary w-full" onClick={() => setShowDrafts(true)} disabled={saving}>Saved drafts ({drafts.length}/5)</button>}
        </aside>
      </div>

      {selectedPlayer && selected !== null && (
        <Sheet
          title={
            <span>
              {selectedPlayer.name}{" "}
              <span className="font-normal text-muted">
                {predictionCoverage[selectedPlayer.id]?.includes(gw) ? (selectedPlayer.xp[weekIndex] ?? 0).toFixed(1) : "—"} xP in GW{gw}
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
            {/* Sheet suspends this menu while the card is open, then restores it. */}
            <SheetAction onClick={() => openCard(selected)}>Player card</SheetAction>
          </div>
        </Sheet>
      )}

      {replacingPlayer && (
        <Sheet title={`Replace ${replacingPlayer.name} in GW${gw}`} onClose={() => setReplacing(null)} tall>
          <div className="sticky top-0 z-10 bg-surface px-5 pt-3 pb-2">
            <p className="text-xs text-muted">
              Up to {formatPrice(budget)}: {formatPrice(week.bankAfter)} in the bank plus{" "}
              {formatPrice(week.sell[replacingPlayer.id] ?? replacingPlayer.price)} for {replacingPlayer.name}.
            </p>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or club (e.g. ARS)"
              className="mt-2 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-emerald-600 "
              aria-label="Search players"
            />
            <div className="mt-2 flex justify-between text-[11px] text-muted">
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
                    <span className="block truncate text-xs text-muted">
                      {o.player.club}, {formatPrice(o.player.price)}
                      {o.player.owned != null ? `, ${o.player.owned}% owned` : ""}
                      {o.reason ? `. ${o.reason}` : ""}
                    </span>
                  </span>
                  <span className="text-right text-sm tabular-nums">
                    <span className="block font-semibold">{predictionCoverage[o.player.id]?.includes(gw) ? o.xpWeek.toFixed(1) : "—"}</span>
                    <span className="block text-xs text-muted">{base.gameweeks.slice(weekIndex).every((gameweek) => predictionCoverage[o.player.id]?.includes(gameweek)) ? o.xpRest.toFixed(1) : "—"}</span>
                  </span>
                </button>
              </li>
            ))}
            {options.length === 0 && <li className="px-3 py-6 text-sm text-muted">No one matches that search.</li>}
          </ul>
        </Sheet>
      )}

      {showDrafts && drafts && (
        <Sheet title="Saved drafts" onClose={() => setShowDrafts(false)}>
          <div className="p-5"><Button primary onClick={openSave} disabled={saving}>Save as a new draft</Button><p className="mt-3 text-xs text-muted">Up to five drafts. Loading a different draft asks before replacing unsaved changes.</p></div>
          <ul className="divide-y divide-line px-5 pb-5">
            {drafts.length === 0 && <li className="py-4 text-sm text-muted">No saved drafts yet.</li>}
            {drafts.map((item) => {
              const preview = simulate(base, lookup, cleanMoves(item.moves));
              const previewReady = preview.weeks.every((week) => hasDraftProjection(week, predictionCoverage));
              return <li key={item.id} className="flex items-center gap-3 py-3"><button type="button" disabled={saving} className="min-h-11 min-w-0 flex-1 text-left" onClick={() => requestReplacement({ title: `Load ${item.name}?`, description: `This draft starts at GW${item.from_gameweek}. Past weeks are skipped.`, moves: cleanMoves(item.moves), draft: { id: item.id, name: item.name }, savedMoves: cleanMoves(item.moves), notice: `Loaded ${item.name}.` })}><span className="block truncate text-sm font-medium">{item.name}{draft?.id === item.id ? " · current" : ""}</span><span className="mt-1 block text-xs text-muted">GW{item.from_gameweek} · {previewReady ? `${preview.total.toFixed(1)} xP over ${range}` : "Projection unavailable"}</span></button><button type="button" disabled={saving} className="min-h-11 rounded-lg px-3 text-sm text-rose-700 dark:text-rose-300" aria-label={`Delete ${item.name}`} onClick={() => { setDeleteError(null); setDeleteTarget(item); }}>Delete</button></li>;
            })}
          </ul>
        </Sheet>
      )}
      {showTools && (
        <Sheet title="Draft actions" onClose={() => setShowTools(false)}>
          <div className="divide-y divide-line">
            {drafts && <SheetAction onClick={() => setShowDrafts(true)}>Saved drafts</SheetAction>}
            {botMoves && <SheetAction onClick={() => requestReplacement({ title: "Use the suggested plan?", description: "This replaces the current draft’s moves with the latest suggestion. You can edit it afterward.", moves: botMoves, draft: null, savedMoves: [], notice: "Loaded the suggested plan. Change anything you like." })}>Use suggested plan</SheetAction>}
            <SheetAction onClick={() => requestReplacement({ title: "Start a new draft?", description: "This returns to your last-deadline squad. Saved drafts remain available.", moves: [], draft: null, savedMoves: [], notice: "Started a new draft." })}>Start over</SheetAction>
            {drafts && <SheetAction onClick={openSave}>Save as a new draft</SheetAction>}
          </div>
        </Sheet>
      )}
      {replacement && (
        <Sheet title={replacement.title} onClose={() => setReplacement(null)}>
          <div className="space-y-4 p-5">
            <p className="text-sm leading-relaxed text-muted">{replacement.description}</p>
            {dirty && <p className="rounded-lg bg-warning-soft p-3 text-sm text-warning">Your current draft has unsaved changes. Loading this will replace them.</p>}
            <p className="text-xs text-muted">{replacement.moves.length} planned action{replacement.moves.length === 1 ? "" : "s"}. This changes the planner only.</p>
            <div className="flex flex-wrap gap-2"><Button primary onClick={() => applyReplacement(replacement)}>Load into planner</Button><Button onClick={() => setReplacement(null)}>Keep current draft</Button></div>
            {replacement.source && <button type="button" className="text-link min-h-11 text-sm" onClick={() => { setIncoming((items) => items.filter((item) => item.source !== replacement.source)); if (replacement.source === "handoff") try { window.localStorage.removeItem(HANDOFF); } catch { /* storage blocked */ } setReplacement(null); }}>Dismiss this suggestion</button>}
          </div>
        </Sheet>
      )}
      {showSave && (
        <Sheet title="Save a new draft" onClose={() => setShowSave(false)}>
          <form className="space-y-4 p-5" onSubmit={(event) => { event.preventDefault(); save(true, saveName); }}>
            <div><label htmlFor="draft-name" className="text-sm font-medium">Draft name</label><input id="draft-name" value={saveName} onChange={(event) => setSaveName(event.target.value)} maxLength={40} required className="mt-2 min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm" /></div>
            <p className="text-xs text-muted">Saves {range} to your Raptor account. It won’t submit transfers to FPL.</p>
            {saveError && <p role="alert" className="text-sm text-warning">{saveError}</p>}
            <button type="submit" className="button-primary" disabled={saving}>{saving ? "Saving…" : "Save draft"}</button>
          </form>
        </Sheet>
      )}
      {deleteTarget && (
        <Sheet title={`Delete ${deleteTarget.name}?`} onClose={() => setDeleteTarget(null)}>
          <div className="space-y-4 p-5"><p className="text-sm text-muted">This removes the saved copy. Any moves currently open in the planner stay here.</p>{deleteError && <p role="alert" className="text-sm text-warning">{deleteError}</p>}<Button primary disabled={saving} onClick={() => startSaving(async () => { try { const response = await deleteDraft(deleteTarget.id); if (!response.ok) { setDeleteError("Couldn’t delete that draft. Try again."); return; } setDrafts((items) => (items ?? []).filter((item) => item.id !== deleteTarget.id)); if (draft?.id === deleteTarget.id) { setDraft(null); setSavedMoves([]); } setDeleteTarget(null); setNotice(`Deleted ${deleteTarget.name}.`); } catch { setDeleteError("Couldn’t delete that draft. Try again."); } })}>{saving ? "Deleting…" : "Delete saved draft"}</Button><Button onClick={() => setDeleteTarget(null)}>Keep draft</Button></div>
        </Sheet>
      )}
    </div>
  );
}
