import { cleanHistory, runAgent, type AskEvent } from "@/lib/ask/agent";
import { loadAskContext } from "@/lib/ask/context";
import { geminiCaller, ModelError } from "@/lib/ask/gemini";
import { botSummary, systemPrompt } from "@/lib/ask/prompt";
import { describeTool, runTool, squadBrief, type Scenario, type ToolOutcome } from "@/lib/ask/tools";
import { createClient, currentUserId } from "@/lib/supabase/server";

// Ask Raptor: one question in, a stream of progress lines and then the answer
// out (newline-delimited JSON). Signed-in users only; the Gemini key stays on
// the server.

export const maxDuration = 60;

const PER_HOUR = 40; // questions per user per hour, per server instance (a soft guard for the free tier)
const asked = new Map<string, number[]>();

function allowed(userId: string, now: number): boolean {
  const recent = (asked.get(userId) ?? []).filter((t) => now - t < 3600_000);
  if (recent.length >= PER_HOUR) return false;
  recent.push(now);
  asked.set(userId, recent);
  return true;
}

const json = (body: AskEvent, status: number) => Response.json(body, { status });

export async function POST(request: Request) {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return Response.json({ type: "error", error: "Sign in first.", code: "failed" }, { status: 401 });

  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return json({ type: "error", error: "Ask Raptor isn't switched on yet.", code: "not_set_up" }, 503);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ type: "error", error: "That message didn't make sense.", code: "failed" }, 400);
  }
  const history = cleanHistory((body as { messages?: unknown })?.messages);
  if (!history.ok) return json({ type: "error", error: history.error, code: "failed" }, 400);
  if (!allowed(userId, Date.now())) {
    return json({ type: "error", error: "That's a lot of questions for one hour. Give Raptor a breather and try again soon.", code: "busy" }, 429);
  }

  const loaded = await loadAskContext(supabase, userId);
  if (!loaded.ok) return json({ type: "error", error: loaded.reason, code: "no_team" }, 409);
  const { data, plan, teamName, leagueName, deadline } = loaded.context;

  const brief = squadBrief(data, {
    teamName,
    leagueName,
    deadline: deadline ? new Date(deadline).toUTCString().replace(" GMT", " UTC") : null,
    botSummary: botSummary(plan, data.base.gameweeks),
  });
  const today = new Date().toUTCString().slice(0, 16);
  const call = geminiCaller(key, { base: process.env.GEMINI_API_BASE?.trim() || undefined });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: AskEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        const { reply, tools, outcomes } = await runAgent<ToolOutcome>({
          system: systemPrompt(brief, today),
          turns: history.turns,
          call,
          execute: (name, args) => runTool(data, name, args),
          onEvent: (e) => send({ type: "status", text: describeTool(e.name, e.args) }),
        });
        // The plans it ran, in order, without repeats (the last few): each can open in the planner.
        const scenarios: Scenario[] = [];
        for (const o of outcomes) {
          if (!o.scenario) continue;
          const seen = scenarios.findIndex((s) => s.label === o.scenario!.label);
          if (seen >= 0) scenarios.splice(seen, 1);
          scenarios.push(o.scenario);
        }
        const ids = new Set([...data.base.squad, ...outcomes.flatMap((o) => o.players ?? [])]);
        for (const s of scenarios) for (const m of s.moves) if (m.kind === "transfer") ids.add(m.in).add(m.out);
        const byId = new Map(data.players.map((p) => [p.id, p.name]));
        const mentions = [...ids].filter((id) => byId.has(id)).map((id) => ({ id, name: byId.get(id)! }));
        send({ type: "done", reply, tools: [...new Set(tools)], scenarios: scenarios.slice(-3), mentions });
      } catch (e) {
        const busy = e instanceof ModelError && e.busy;
        const badKey = e instanceof ModelError && /refused the key/.test(e.message);
        console.error("ask raptor:", e instanceof Error ? e.message : e);
        send({
          type: "error",
          error: badKey
            ? "Ask Raptor's AI key isn't working. Check GEMINI_API_KEY in Vercel."
            : busy
              ? "Raptor's swamped right now (Google's free AI is busy). Try again in a minute."
              : "Raptor lost his train of thought. Try asking again.",
          code: badKey ? "not_set_up" : busy ? "busy" : "failed",
        });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
