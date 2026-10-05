/**
 * Calls Google's Gemini through its OpenAI-compatible endpoint (free tier,
 * Flash models only). Model names come and go, so the list is read from the
 * API and ranked the same way as the recap job (jobs/raptor/recaps.py): the
 * -latest alias first, then the newest stable versions, then previews, then
 * Flash-Lite. A busy model gets one quick retry, then the next one is tried.
 */

import { TOOL_SPECS } from "@/lib/ask/tools";
import type { CallModel, ModelMessage, ToolCall } from "@/lib/ask/agent";

const BASE = "https://generativelanguage.googleapis.com/v1beta/openai";
const FALLBACK_MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest"];
const NOT_TEXT = ["image", "tts", "audio", "live", "embedding", "robotics", "computer-use"];
const MAX_MODELS = 4;
const BUSY = new Set([429, 500, 502, 503, 504]);
const LIST_TTL = 60 * 60 * 1000;
// Google's documented stand-in for a thought signature, for tool calls made by another model.
const STAND_IN_SIGNATURE = "skip_thought_signature_validator";

export class ModelError extends Error {
  constructor(
    message: string,
    readonly busy: boolean,
  ) {
    super(message);
  }
}

export function rankModels(ids: string[]): string[] {
  const flash = [...new Set(ids.map((i) => i.replace(/^models\//, "")))].filter(
    (i) => i.includes("flash") && !NOT_TEXT.some((w) => i.includes(w)),
  );
  const version = (m: string) => Number(/gemini-(\d+(?:\.\d+)?)/.exec(m)?.[1] ?? 0);
  const key = (m: string) => [
    Number(m.includes("lite")),
    Number(!m.endsWith("-latest")),
    Number(m.includes("preview") || m.includes("exp")),
    -version(m),
  ];
  return flash.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return a.localeCompare(b);
  });
}

let cachedList: { at: number; models: string[] } | null = null;

async function candidateModels(key: string, base: string, fetchImpl: typeof fetch, now: number): Promise<string[]> {
  if (cachedList && now - cachedList.at < LIST_TTL) return cachedList.models;
  let models: string[] = [];
  try {
    const res = await fetchImpl(`${base}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const body = (await res.json()) as { data?: { id?: string }[] };
      models = rankModels((body.data ?? []).map((m) => String(m.id ?? "")));
    }
  } catch {
    // Use the fallback list below.
  }
  models = (models.length ? models : FALLBACK_MODELS).slice(0, MAX_MODELS);
  cachedList = { at: now, models };
  return models;
}

/** Tool calls made by one model, made safe to show to another. */
function withStandInSignatures(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((m) =>
    m.tool_calls
      ? {
          ...m,
          tool_calls: m.tool_calls.map(
            (c): ToolCall => ({ ...c, extra_content: { google: { thought_signature: STAND_IN_SIGNATURE } } }),
          ),
        }
      : m,
  );
}

async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } } | { error?: { message?: string } }[];
    const first = Array.isArray(body) ? body[0] : body;
    return String(first?.error?.message ?? res.statusText).slice(0, 160);
  } catch {
    return res.statusText;
  }
}

/** A CallModel that sticks with the first model that works and falls back when one is busy. */
export function geminiCaller(
  key: string,
  {
    fetchImpl = fetch,
    sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
    now = Date.now(),
    base = BASE, // another OpenAI-compatible address, e.g. a stand-in for tests (GEMINI_API_BASE)
  }: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<unknown>; now?: number; base?: string } = {},
): CallModel & { model: () => string | null } {
  let models: string[] | null = null;
  let index = 0;
  let current: string | null = null;
  let usedBy: string | null = null; // the model that made the tool calls in the conversation so far

  let thinking = true; // ask for light thinking (quicker answers) until a model objects

  const call: CallModel = async (messages, { toolChoice }) => {
    models ??= await candidateModels(key, base, fetchImpl, now);
    const problems: string[] = [];
    let busy = false;
    while (index < models.length) {
      const model = models[index];
      const sent = usedBy && usedBy !== model ? withStandInSignatures(messages) : messages;
      for (let attempt = 0; attempt < 3; attempt++) {
        let res: Response;
        try {
          res = await fetchImpl(`${base}/chat/completions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model,
              messages: sent,
              tools: TOOL_SPECS,
              tool_choice: toolChoice,
              max_tokens: 4000,
              ...(thinking ? { reasoning_effort: "low" } : {}),
            }),
            signal: AbortSignal.timeout(45_000),
          });
        } catch (e) {
          problems.push(`${model}: ${e instanceof Error ? e.message : "network error"}`);
          busy = true;
          break;
        }
        if (res.ok) {
          const body = (await res.json()) as { choices?: { message?: ModelMessage }[] };
          const message = body.choices?.[0]?.message;
          if (!message) {
            problems.push(`${model}: no reply`);
            break;
          }
          current = model;
          if (message.tool_calls?.length) usedBy = model;
          return { ...message, role: "assistant", content: message.content ?? null };
        }
        const text = await errorText(res);
        problems.push(`${model}: ${res.status} ${text}`);
        if (res.status === 401 || res.status === 403) throw new ModelError(`Gemini refused the key (${res.status}).`, false);
        if (res.status === 400 && thinking && /reason|think/i.test(text)) {
          thinking = false; // this model doesn't take a thinking level: ask again without one
          continue;
        }
        if (!BUSY.has(res.status)) break; // e.g. 404: this model is gone, try the next
        busy = true;
        if (attempt === 0) await sleep(1500);
        else break;
      }
      index += 1;
    }
    throw new ModelError(problems.join("; ") || "no models to try", busy);
  };
  return Object.assign(call, { model: () => current });
}
