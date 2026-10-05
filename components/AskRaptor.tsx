"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";
import { usePlayerSheet } from "@/components/PlayerSheet";
import Raptor, { SKINS, type RaptorLook } from "@/components/recap/Raptor";
import type { AskEvent } from "@/lib/ask/agent";
import { formatReply, type Inline } from "@/lib/ask/format";
import { HANDOFF } from "@/lib/ask/handoff";
import { TOOL_LABELS, type Scenario } from "@/lib/ask/tools";

// Ask Raptor: a chat about your squad with the cartoon raptor, who looks
// things up and runs "what if" plans through the planner before answering.
// The conversation stays on this device; each question sends the recent
// turns to /api/ask, which streams back progress lines and then the answer.

const COACH: Partial<RaptorLook> = { palette: SKINS[0], gear: "cap", hat: "#1D3557", spots: true, sleepy: false };
const STORE = "raptor-ask";
const MAX_KEPT = 40;

type Message = {
  role: "user" | "assistant";
  content: string;
  tools?: string[];
  scenarios?: Scenario[];
  mentions?: { id: number; name: string }[];
  error?: boolean;
};

type Props = {
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
            className="cursor-pointer font-medium text-emerald-700 underline decoration-emerald-700/30 underline-offset-2 hover:decoration-emerald-700 dark:text-emerald-400"
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
  return (
    <div className="px-1">
      <p className="mb-1 text-[11px] text-zinc-500">
        Open in the planner (xP vs doing nothing, GW{scenarios[0].gameweeks[0]}–{scenarios[0].gameweeks.at(-1)}):
      </p>
      <div className="flex flex-wrap gap-1.5">
        {scenarios.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => onOpen(s)}
            className="flex max-w-full items-center gap-1.5 rounded-full border border-zinc-200 bg-white py-1 pr-1 pl-3 text-left text-[13px] hover:border-emerald-600 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <span className="truncate">{s.label}</span>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
                s.gain >= 0 ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200" : "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
              }`}
            >
              {s.gain >= 0 ? "+" : "−"}
              {Math.abs(s.gain).toFixed(1)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function AskRaptor({ enabled, gameweek, suggestions, blocked }: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // The chat survives a refresh on this device, until the gameweek moves on.
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORE) ?? "null");
      if (saved?.gameweek === gameweek && Array.isArray(saved.messages)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring once after hydration
        setMessages(saved.messages);
      }
    } catch {
      // Nothing saved, or storage is blocked.
    }
  }, [gameweek]);
  useEffect(() => {
    try {
      if (messages.length) window.localStorage.setItem(STORE, JSON.stringify({ gameweek, messages: messages.slice(-MAX_KEPT) }));
      else window.localStorage.removeItem(STORE);
    } catch {
      // Not kept on this device, which is fine.
    }
  }, [messages, gameweek]);
  useEffect(() => {
    if (messages.length || pending) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending, status]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || pending || !enabled || blocked) return;
    const history = [...messages.filter((m) => !m.error), { role: "user" as const, content: text }];
    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setPending(true);
    setStatus(null);
    const fail = (error: string) => setMessages((m) => [...m, { role: "assistant", content: error, error: true }]);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-20).map(({ role, content }) => ({ role, content })) }),
      });
      if (!res.ok || !res.body) {
        const event = (await res.json().catch(() => null)) as AskEvent | null;
        fail(event?.type === "error" ? event.error : "Raptor couldn't be reached. Check your connection and try again.");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as AskEvent;
          if (event.type === "status") setStatus(event.text);
          else if (event.type === "error") {
            finished = true;
            fail(event.error);
          } else {
            finished = true;
            setMessages((m) => [
              ...m,
              { role: "assistant", content: event.reply, tools: event.tools, scenarios: event.scenarios, mentions: event.mentions },
            ]);
          }
        }
        if (done) break;
      }
      if (!finished) fail("Raptor went quiet halfway through. Try asking again.");
    } catch {
      fail("Raptor couldn't be reached. Check your connection and try again.");
    } finally {
      setPending(false);
      setStatus(null);
    }
  }

  function openInPlanner(s: Scenario) {
    try {
      window.localStorage.setItem(HANDOFF, JSON.stringify({ gameweek: s.gameweeks[0], moves: s.moves, label: s.label }));
    } catch {
      // Storage blocked: the planner opens without it.
    }
    router.push("/planner?mode=build");
  }

  const empty = messages.length === 0;
  const off = !enabled || blocked;

  return (
    <section className="flex flex-col gap-3">
      {empty ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-gradient-to-b from-emerald-50 to-transparent px-4 pt-6 pb-2 text-center dark:from-emerald-950/40">
          <Coach className="h-24 w-24" />
          <div>
            <h2 className="text-lg font-bold tracking-tight">Ask Raptor</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-zinc-600 dark:text-zinc-400">
              {off
                ? (blocked ?? "Ask Raptor isn't switched on yet.")
                : "Talk your moves through. Raptor knows your squad, bank, chips and the bot's plan, runs the numbers before he answers, and tells you when your reasoning's daft."}
            </p>
            {!enabled && !blocked && (
              <p className="mx-auto mt-2 max-w-sm text-xs text-zinc-500">
                For the site&apos;s owner: add <code className="font-mono">GEMINI_API_KEY</code> to the Vercel project&apos;s environment variables and redeploy.
              </p>
            )}
            {blocked && (
              <Link href="/me" className="mt-2 inline-block text-sm font-medium text-emerald-700 underline underline-offset-2 dark:text-emerald-400">
                Go to My gameweek
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setMessages([])}
            disabled={pending}
            className="text-xs text-zinc-500 underline-offset-2 hover:underline disabled:opacity-50"
          >
            New chat
          </button>
        </div>
      )}

      <ol className="flex flex-col gap-3" aria-live="polite">
        {messages.map((m, i) =>
          m.role === "user" ? (
            <li key={i} className="ml-10 self-end rounded-2xl rounded-br-md bg-emerald-700 px-3.5 py-2 text-[15px] whitespace-pre-wrap text-white">
              {m.content}
            </li>
          ) : (
            <li key={i} className="mr-4 flex items-start gap-2">
              <Coach className="mt-1 h-9 w-9" />
              <div className="min-w-0 flex-1 space-y-2">
                <div
                  className={`rounded-2xl rounded-bl-md px-3.5 py-2.5 text-[15px] leading-relaxed ${
                    m.error ? "bg-rose-50 text-rose-900 dark:bg-rose-950/50 dark:text-rose-200" : "bg-zinc-100 dark:bg-zinc-900"
                  }`}
                >
                  {m.error ? m.content : <Reply text={m.content} mentions={m.mentions ?? []} />}
                </div>
                {m.scenarios && m.scenarios.length > 0 && <ScenarioChips scenarios={m.scenarios} onOpen={openInPlanner} />}
                {m.tools && m.tools.length > 0 && (
                  <p className="px-1 text-[11px] text-zinc-500">{m.tools.map((t) => TOOL_LABELS[t] ?? t).join(" · ")}</p>
                )}
              </div>
            </li>
          ),
        )}
        {pending && (
          <li className="mr-4 flex items-start gap-2">
            <Coach className="mt-1 h-9 w-9" thinking />
            <div className="rounded-2xl rounded-bl-md bg-zinc-100 px-3.5 py-2.5 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
              {status ?? "Thinking"}
              <span aria-hidden className="ml-0.5 inline-flex gap-0.5">
                {[0, 1, 2].map((d) => (
                  <span key={d} style={{ animation: `dot-pulse 1.2s ${d * 0.2}s infinite` }}>
                    .
                  </span>
                ))}
              </span>
            </div>
          </li>
        )}
      </ol>
      <div ref={endRef} className="scroll-mb-44 sm:scroll-mb-28" />

      {empty && !off && (
        <div className="flex flex-wrap justify-center gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => ask(s)}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-left text-sm text-zinc-700 hover:border-emerald-600 hover:text-emerald-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:text-emerald-300"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {!off && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
          className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 flex items-end gap-2 rounded-2xl border border-zinc-200 bg-white p-2 shadow-sm sm:bottom-4 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 2000))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                ask(input);
              }
            }}
            rows={1}
            placeholder={empty ? "e.g. Should I sell Saka for Palmer?" : "Reply to Raptor"}
            aria-label="Your question"
            className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[16px] outline-none [field-sizing:content] placeholder:text-zinc-400"
          />
          <button
            type="submit"
            disabled={pending || !input.trim()}
            className="h-10 shrink-0 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-40"
          >
            Ask
          </button>
        </form>
      )}
      {!off && <p className="text-center text-[11px] text-zinc-500">Raptor can be wrong. The numbers come from the app&apos;s model, which runs a little optimistic.</p>}
    </section>
  );
}
