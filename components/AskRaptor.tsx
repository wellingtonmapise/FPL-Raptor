"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";
import { usePlayerSheet } from "@/components/PlayerSheet";
import Raptor, { SKINS, type RaptorLook } from "@/components/recap/Raptor";
import type { AskEvent } from "@/lib/ask/agent";
import { formatReply, type Inline } from "@/lib/ask/format";
import { HANDOFF } from "@/lib/ask/handoff";
import { askEvents, readAskHistory, type AskMessage as Message } from "@/lib/askView";
import { TOOL_LABELS, type Scenario } from "@/lib/ask/tools";

// Ask Raptor: a chat about your squad with the cartoon raptor, who looks
// things up and runs "what if" plans through the planner before answering.
// The conversation stays on this device; each question sends the recent
// turns to /api/ask, which streams back progress lines and then the answer.

const COACH: Partial<RaptorLook> = { palette: SKINS[0], gear: "cap", hat: "#1D3557", spots: true, sleepy: false };
type Props = {
  storageKey: string;
  needsTeam: boolean;
  enabled: boolean;
  gameweek: number | null; // the next gameweek: a new one starts a fresh chat
  suggestions: string[];
  blocked: string | null; // why asking can't work yet, e.g. no team linked
};

function Coach({ className, thinking = false }: { className: string; thinking?: boolean }) {
  return (
    <div
      className={`motion-safe-bob shrink-0 ${className}`}
      style={thinking ? { animation: "raptor-bob 1.1s ease-in-out infinite" } : undefined}
      aria-hidden
    >
      <Raptor seed={7} look={COACH} className="h-full w-full" />
    </div>
  );
}

function Parts({ parts }: { parts: Inline[] }) {
  const { open } = usePlayerSheet();
  return (
    <>
      {parts.map((p, i) =>
        p.kind === "text" ? (
          <Fragment key={i}>{p.text}</Fragment>
        ) : p.kind === "bold" ? (
          <strong key={i} className="font-semibold">
            <Parts parts={p.parts} />
          </strong>
        ) : (
          <button
            key={i}
            type="button"
            onClick={() => open(p.id)}
            className="text-link cursor-pointer"
          >
            {p.text}
          </button>
        ),
      )}
    </>
  );
}

function Reply({ text, mentions }: { text: string; mentions: { id: number; name: string }[] }) {
  return (
    <div className="space-y-2">
      {formatReply(text, mentions).map((b, i) =>
        b.kind === "p" ? (
          <p key={i}>
            <Parts parts={b.parts} />
          </p>
        ) : (
          <ul key={i} className="list-disc space-y-1 pl-5 marker:text-emerald-600">
            {b.items.map((item, j) => (
              <li key={j}>
                <Parts parts={item} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

function ScenarioChips({ scenarios, onOpen }: { scenarios: Scenario[]; onOpen: (s: Scenario) => void }) {
  return <div className="space-y-2">{scenarios.map((s,i) => <div key={i} className="rounded-xl border border-line bg-surface p-3">
    <p className="text-sm font-semibold">{s.label}</p>
    <p className="mt-1 text-xs leading-relaxed text-muted">{s.gain >= 0 ? "+" : "−"}{Math.abs(s.gain).toFixed(1)} xP vs no moves · GW{s.gameweeks[0]}–{s.gameweeks.at(-1)} · after hits</p>
    <button type="button" className="text-link mt-1 min-h-11 text-sm" onClick={() => onOpen(s)}>Review in Planner <span aria-hidden>→</span></button>
  </div>)}</div>;
}

export default function AskRaptor({ storageKey, needsTeam, enabled, gameweek, suggestions, blocked }: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [ready, setReady] = useState(false);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [showLatest, setShowLatest] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const followRef = useRef(true);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore once per account/team/week, before persisting
      setMessages(readAskHistory(window.localStorage.getItem(storageKey)));
    } catch { setStorageError(true); }
    setReady(true);
    return () => { alive.current = false; requestRef.current?.abort(); };
  }, [storageKey]);
  useEffect(() => {
    if (!ready) return;
    try { window.localStorage.setItem(storageKey, JSON.stringify(messages.slice(-40))); }
    catch {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- storage failure must be visible
      setStorageError(true);
    }
  }, [messages, ready, storageKey]);
  useEffect(() => {
    const area = scrollRef.current;
    if (area && followRef.current) area.scrollTop = area.scrollHeight;
  }, [messages, pending, status, ready]);
  useEffect(() => {
    // Safari's keyboard shrinks the visual viewport without resizing dvh.
    const viewport = window.visualViewport;
    const fitKeyboard = () => {
      const panel = panelRef.current;
      const field = panel?.querySelector("textarea");
      if (!panel || !viewport) return;
      if (document.activeElement === field && viewport.height < window.innerHeight - 100) {
        panel.style.setProperty("--ask-keyboard-height", `${Math.max(180, viewport.height - 80)}px`);
        requestAnimationFrame(() => field?.scrollIntoView({ block: "nearest" }));
      } else panel.style.removeProperty("--ask-keyboard-height");
    };
    viewport?.addEventListener("resize", fitKeyboard);
    document.addEventListener("focusin", fitKeyboard);
    document.addEventListener("focusout", fitKeyboard);
    return () => {
      viewport?.removeEventListener("resize", fitKeyboard);
      document.removeEventListener("focusin", fitKeyboard);
      document.removeEventListener("focusout", fitKeyboard);
    };
  }, []);

  function latest() {
    followRef.current = true;
    setShowLatest(false);
    const area = scrollRef.current;
    if (area) area.scrollTop = area.scrollHeight;
  }

  async function ask(question: string, retry = false) {
    const text = question.trim();
    if (!text || requestRef.current || !ready || !enabled || blocked) return;
    const history = retry ? messages.filter(m => !m.error) : [...messages.filter(m => !m.error), { role: "user" as const, content: text }];
    setMessages(retry ? history : [...messages, { role: "user", content: text }]);
    setInput("");
    setPending(true);
    setStatus(null);
    latest();
    const controller = new AbortController();
    requestRef.current = controller;
    const fail = (error: string) => { if (alive.current) setMessages(m => [...m, { role: "assistant", content: error, error: true }]); };
    try {
      const res = await fetch("/api/ask", {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-20).map(({ role, content }) => ({ role, content })) }),
      });
      if (!res.ok || !res.body) {
        const event = (await res.json().catch(() => null)) as AskEvent | null;
        fail(event?.type === "error" ? event.error : "Raptor couldn’t be reached. Check your connection and try again.");
        return;
      }
      let finished = false;
      for await (const event of askEvents(res.body)) {
        if (!alive.current || controller.signal.aborted) break;
        if (event.type === "status") setStatus(event.text);
        else {
          finished = true;
          if (event.type === "error") fail(event.error);
          else setMessages(m => [...m, { role: "assistant", content: event.reply, tools: event.tools, scenarios: event.scenarios, mentions: event.mentions }]);
          break;
        }
      }
      if (!finished && !controller.signal.aborted) fail("The reply was interrupted. Your question is still here; try again.");
    } catch {
      if (!controller.signal.aborted) fail("Raptor couldn’t be reached. Check your connection and try again.");
    } finally {
      requestRef.current = null;
      if (alive.current) { setPending(false); setStatus(null); }
    }
  }

  function openInPlanner(s: Scenario) {
    try { window.localStorage.setItem(HANDOFF, JSON.stringify({ gameweek: s.gameweeks[0], moves: s.moves, label: s.label })); }
    catch { setHandoffError("This browser couldn’t pass the scenario to Planner. Allow site storage, then try again."); return; }
    router.push("/planner?mode=build");
  }

  const empty = messages.length === 0;
  const off = !enabled || Boolean(blocked);
  const lastQuestion = messages.findLast(m => m.role === "user")?.content;
  return <section ref={panelRef} className="ask-panel surface mx-auto flex w-full max-w-3xl flex-col overflow-hidden" aria-label="Ask Raptor conversation">
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-2">
      <div className="flex items-center gap-2"><Coach className="h-9 w-9" /><div><h2 className="text-sm font-semibold">Ask Raptor</h2><p className="text-xs text-muted">Your squad · {gameweek ? `GW${gameweek}` : "No upcoming gameweek"}</p></div></div>
      {!empty && <button type="button" onClick={() => { setMessages([]); setHandoffError(null); }} disabled={pending || !ready} className="button-secondary text-xs">New chat</button>}
    </div>
    {storageError && <p role="status" className="shrink-0 bg-warning-soft px-4 py-2 text-xs text-warning">Chat history can’t be saved in this browser. Keep this page open to retain this conversation.</p>}
    <div ref={scrollRef} tabIndex={0} aria-label="Conversation history" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4" onScroll={() => {
      const area = scrollRef.current;
      if (!area) return;
      followRef.current = area.scrollHeight - area.scrollTop - area.clientHeight < 70;
      setShowLatest(!followRef.current);
    }}>
      {empty && <div className="py-3"><h3 className="section-title">Talk through your next move</h3><p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">{off ? blocked ?? "Ask Raptor is temporarily unavailable. Try again later." : "Compare transfers, check fixtures or test a captain. Raptor checks your squad and runs the numbers before replying."}</p>
        {needsTeam && <Link href="/account" className="text-link mt-2 inline-flex min-h-11 items-center text-sm">Link your FPL team</Link>}
        {!off && <div className="mt-4 grid gap-2 sm:grid-cols-2">{suggestions.map(s => <button key={s} type="button" disabled={!ready} onClick={() => ask(s)} className="min-h-11 rounded-lg border border-line px-3 py-2 text-left text-sm hover:bg-surface-muted">{s}</button>)}</div>}
      </div>}
      <ol className="flex flex-col gap-5" aria-label="Messages">{messages.map((m,i) => <li key={i} className={m.role === "user" ? "ml-8 self-end max-w-full rounded-xl bg-accent-soft px-4 py-3 text-sm whitespace-pre-wrap text-foreground" : "min-w-0 space-y-3 text-sm leading-relaxed break-words"}>
        <p className="sr-only">{m.role === "user" ? "You" : "Raptor"}</p>
        {m.role === "user" ? m.content : m.error ? <div role="alert" className="rounded-xl bg-warning-soft p-3 text-warning"><p>{m.content}</p>{i === messages.length - 1 && lastQuestion && <button type="button" disabled={pending || off} className="button-secondary mt-2" onClick={() => ask(lastQuestion,true)}>Try again</button>}</div> : <Reply text={m.content} mentions={m.mentions ?? []} />}
        {m.scenarios?.length ? <ScenarioChips scenarios={m.scenarios} onOpen={openInPlanner} /> : null}
        {m.tools?.length ? <p className="text-xs text-muted">Checked: {m.tools.map(t => TOOL_LABELS[t] ?? t).join(" · ")}</p> : null}
      </li>)}</ol>
      <div role="status" aria-live="polite" className={pending ? "mt-5 flex items-center gap-2 text-sm text-muted" : "sr-only"}>{pending ? <><Coach className="h-8 w-8" thinking />{status ?? "Checking your squad…"}</> : !empty ? "Reply complete" : "Ready for your question"}</div>
    </div>
    {showLatest && <button type="button" className="min-h-11 shrink-0 border-t border-line bg-accent-soft text-sm text-accent" onClick={latest}>Latest message ↓</button>}
    {handoffError && <p role="alert" className="shrink-0 bg-warning-soft px-4 py-2 text-sm text-warning">{handoffError}</p>}
    {!off && <div className="shrink-0 border-t border-line bg-surface p-3">
      <form onSubmit={e => { e.preventDefault(); ask(input); }} className="flex items-end gap-2">
        <textarea value={input} onChange={e => setInput(e.target.value.slice(0,2000))} onKeyDown={e => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(input); }
        }} rows={1} maxLength={2000} placeholder="Ask about your team…" aria-label="Your question" disabled={!ready}
          className="max-h-28 min-h-11 min-w-0 flex-1 resize-none rounded-lg border border-line bg-background px-3 py-2 text-base [field-sizing:content]" />
        <button type="submit" disabled={!ready || pending || !input.trim()} className="button-primary">Ask</button>
      </form>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">Predictions are estimates. Check the details before making a transfer.</p>
    </div>}
  </section>;
}
