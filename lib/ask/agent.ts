/**
 * Ask Raptor's loop: send the conversation to the model; if it asks for
 * tools, run them, hand back the results, and repeat until it answers.
 * The model call is passed in, so tests can use a scripted fake.
 */

import type { Scenario } from "@/lib/ask/tools";

export type ToolCall = {
  id: string;
  type?: "function";
  function: { name: string; arguments: string };
  [extra: string]: unknown; // e.g. Gemini's thought signature, which must be sent back untouched
};

export type ModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  [extra: string]: unknown;
};

export type CallModel = (messages: ModelMessage[], options: { toolChoice: "auto" | "none" }) => Promise<ModelMessage>;

export type ChatTurn = { role: "user" | "assistant"; content: string };

/** What /api/ask streams back, one JSON object per line. */
export type AskEvent =
  | { type: "status"; text: string }
  | {
      type: "done";
      reply: string;
      tools: string[];
      scenarios: Scenario[];
      mentions: { id: number; name: string }[];
    }
  | { type: "error"; error: string; code: "not_set_up" | "busy" | "no_team" | "failed" };

export const MAX_TURNS = 20;
export const MAX_CHARS = 2000;
const MAX_ROUNDS = 5; // tool rounds before the model must answer
const MAX_CALLS_PER_ROUND = 6;

/** The conversation as sent by the browser, or why it's not acceptable. */
export function cleanHistory(value: unknown): { ok: true; turns: ChatTurn[] } | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length === 0) return { ok: false, error: "Ask something first." };
  const turns: ChatTurn[] = [];
  for (const m of value.slice(-MAX_TURNS)) {
    if (!m || typeof m !== "object") return { ok: false, error: "That message didn't make sense." };
    const { role, content } = m as Record<string, unknown>;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return { ok: false, error: "That message didn't make sense." };
    const text = content.trim();
    if (!text) continue;
    if (role === "user" && text.length > MAX_CHARS) return { ok: false, error: `Keep questions under ${MAX_CHARS} characters.` };
    turns.push({ role, content: text.slice(0, 6000) });
  }
  if (turns.length === 0 || turns[turns.length - 1].role !== "user") return { ok: false, error: "Ask something first." };
  return { ok: true, turns };
}

function parseArgs(text: string): unknown {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return null;
  }
}

export type AgentEvent = { type: "tool"; name: string; args: unknown };

export async function runAgent<T extends { result: unknown }>(options: {
  system: string;
  turns: ChatTurn[];
  call: CallModel;
  execute: (name: string, args: unknown) => T | Promise<T>;
  onEvent?: (event: AgentEvent) => void;
  maxRounds?: number;
}): Promise<{ reply: string; tools: string[]; outcomes: T[] }> {
  const { call, execute, onEvent } = options;
  const maxRounds = options.maxRounds ?? MAX_ROUNDS;
  const messages: ModelMessage[] = [{ role: "system", content: options.system }, ...options.turns.map((t) => ({ ...t }))];
  const tools: string[] = [];
  const outcomes: T[] = [];

  for (let round = 0; round <= maxRounds; round++) {
    const last = round === maxRounds;
    const reply = await call(messages, { toolChoice: last ? "none" : "auto" });
    const calls = last ? [] : (reply.tool_calls ?? []).slice(0, MAX_CALLS_PER_ROUND);
    if (calls.length === 0) {
      const text = (reply.content ?? "").trim();
      if (text) return { reply: text, tools, outcomes };
      if (last) break;
      // An empty answer after tool results happens now and then: ask once more, without tools.
      messages.push({ role: "user", content: "Please answer my question now, using what you've found." });
      const retry = await call(messages, { toolChoice: "none" });
      const again = (retry.content ?? "").trim();
      if (again) return { reply: again, tools, outcomes };
      break;
    }
    messages.push({ ...reply, tool_calls: calls });
    for (const c of calls) {
      const name = c.function?.name ?? "";
      const args = parseArgs(c.function?.arguments ?? "");
      onEvent?.({ type: "tool", name, args });
      tools.push(name);
      let content: string;
      if (args === null) content = JSON.stringify({ error: "The arguments weren't valid JSON." });
      else {
        const outcome = await execute(name, args);
        outcomes.push(outcome);
        content = JSON.stringify(outcome.result);
      }
      messages.push({ role: "tool", tool_call_id: c.id, content }); // standard OpenAI shape
    }
  }
  throw new Error("empty reply");
}
