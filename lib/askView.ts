import type { AskEvent } from "@/lib/ask/agent";
import type { Scenario } from "@/lib/ask/tools";
import { cleanMoves } from "@/lib/draft";

export type AskMessage = { role: "user" | "assistant"; content: string; tools?: string[]; scenarios?: Scenario[]; mentions?: { id: number; name: string }[]; error?: boolean };

/** Never adopt the old, unscoped chat: its account and team are unknown. */
export function askStorageKey(userId: string, teamId: number | null, gameweek: number | null): string {
  return `raptor-ask:${userId}:${teamId ?? "unlinked"}:gw${gameweek ?? "none"}`;
}

export function readAskHistory(value: string | null): AskMessage[] {
  try {
    const data: unknown = JSON.parse(value ?? "null");
    if (!Array.isArray(data)) return [];
    const messages = data.slice(-40).flatMap((m): AskMessage[] => {
      if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") return [];
      return [{ role: m.role, content: m.content.slice(0, m.role === "user" ? 2000 : 16000), error: m.error === true,
        tools: Array.isArray(m.tools) ? m.tools.filter((s: unknown) => typeof s === "string") : [],
        mentions: Array.isArray(m.mentions) ? m.mentions.filter((p: { id?: unknown; name?: unknown } | null) => p && Number.isInteger(p.id) && Number(p.id) > 0 && typeof p.name === "string") : [],
        scenarios: Array.isArray(m.scenarios) ? m.scenarios.flatMap((s: Scenario) => s && typeof s.label === "string" && Number.isFinite(s.gain) && Number.isFinite(s.total) && Array.isArray(s.gameweeks) && s.gameweeks.length && s.gameweeks.every(g => Number.isInteger(g) && g > 0 && g <= 38) && Array.isArray(s.moves)
          ? [{ label: s.label.slice(0,80), gain: s.gain, total: s.total, gameweeks: s.gameweeks, moves: cleanMoves(s.moves) }] : []) : [],
      }];
    });
    if (messages.at(-1)?.role === "user") messages.push({ role: "assistant", content: "The previous reply was interrupted. Your question is still here; try again.", error: true });
    return messages.slice(-40);
  } catch { return []; }
}

/** Fetch chunks can split UTF-8 characters or contain several NDJSON events. */
export async function* askEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<AskEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      if (done && buffer.trim()) lines.push(buffer);
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as AskEvent;
        if (!event || !(event.type === "status" && typeof event.text === "string" || event.type === "error" && typeof event.error === "string" || event.type === "done" && typeof event.reply === "string")) throw new Error("Invalid reply event");
        yield event;
      }
      if (done) break;
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
