export type Question =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string; criteria?: { true?: string; false?: string } }
  | { type: "score"; instructions: string; criteria: string[] };

export interface DecisionRequest {
  state: unknown;
  questions: Record<string, Question>;
}

export const MODEL = "typesafe/jev-1.13";
const ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
const MAX_BYTES = 256 * 1024;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Validate agent-supplied questions before any paid network call. */
export function prepareRequest(input: DecisionRequest): string {
  if (input.state === null || input.state === undefined || typeof input.state === "number" || typeof input.state === "boolean") {
    throw new Error("state must be a string, object, or array");
  }
  if (!record(input.questions) || Object.keys(input.questions).length === 0) {
    throw new Error("questions must be a nonempty object");
  }
  if (Object.keys(input.questions).length > 30) throw new Error("at most 30 questions per call");
  for (const [id, question] of Object.entries(input.questions)) {
    if (!nonempty(id) || !record(question) || !nonempty(question.instructions)) {
      throw new Error(`question ${JSON.stringify(id)} needs nonempty instructions`);
    }
    if (question.type === "choice") {
      if (!record(question.criteria) || Object.keys(question.criteria).length < 2 || Object.keys(question.criteria).length > 255 ||
        Object.entries(question.criteria).some(([key, description]) => !nonempty(key) || !nonempty(description))) {
        throw new Error(`choice ${JSON.stringify(id)} needs 2–255 named options with descriptions`);
      }
    } else if (question.type === "score") {
      if (!Array.isArray(question.criteria) || question.criteria.length < 2 || question.criteria.length > 10 ||
        question.criteria.some((level: unknown) => !nonempty(level))) {
        throw new Error(`score ${JSON.stringify(id)} needs 2–10 ordered level descriptions`);
      }
    } else if (question.type === "noul") {
      if (question.criteria !== undefined && (!record(question.criteria) ||
        Object.keys(question.criteria).some(key => key !== "true" && key !== "false") ||
        Object.values(question.criteria).some(value => !nonempty(value)))) {
        throw new Error(`noul ${JSON.stringify(id)} criteria must describe true and/or false`);
      }
    } else {
      throw new Error(`unsupported question type for ${JSON.stringify(id)}`);
    }
  }
  let body: string;
  try {
    body = JSON.stringify({ model: MODEL, state: input.state, questions: input.questions });
  } catch {
    throw new Error("state and questions must be JSON-serializable");
  }
  if (Buffer.byteLength(body) > MAX_BYTES) throw new Error("decision request exceeds 256 KiB");
  return body;
}

function probability(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function parseAnswers(payload: unknown, questions: DecisionRequest["questions"]): Record<string, unknown> {
  if (!record(payload) || !record(payload.answers)) throw new Error("OpenRouter returned no answers");
  const answers: Record<string, unknown> = Object.create(null);
  for (const [id, question] of Object.entries(questions)) {
    const answer = Object.hasOwn(payload.answers, id) ? payload.answers[id] : undefined;
    if (!record(answer) || answer.type !== question.type) throw new Error(`OpenRouter returned an invalid answer for ${JSON.stringify(id)}`);
    if (question.type === "choice" && (typeof answer.choice !== "string" ||
      !Object.hasOwn(question.criteria, answer.choice))) {
      throw new Error(`OpenRouter returned an unknown choice for ${JSON.stringify(id)}`);
    }
    if (question.type === "noul" && !probability(answer.noul)) {
      throw new Error(`OpenRouter returned an invalid noul probability for ${JSON.stringify(id)}`);
    }
    if (question.type === "score" && (typeof answer.score !== "number" || !Number.isFinite(answer.score) ||
      answer.score < 0 || answer.score > question.criteria.length - 1)) {
      throw new Error(`OpenRouter returned an invalid score for ${JSON.stringify(id)}`);
    }
    answers[id] = answer;
  }
  return answers;
}

export async function decide(input: DecisionRequest, apiKey: string, signal?: AbortSignal, fetcher: typeof fetch = fetch) {
  const body = prepareRequest(input);
  if (!apiKey) throw new Error("No OpenRouter API key. Run /login openrouter or set OPENROUTER_API_KEY.");
  const timeout = AbortSignal.timeout(30_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetcher(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body,
      signal: combined,
    });
  } catch (error) {
    if (signal?.aborted) throw new Error("Jev request cancelled");
    if (timeout.aborted) throw new Error("Jev request timed out after 30 seconds");
    // Do not include raw transport errors: they can contain credentials or payloads.
    throw new Error("Unable to reach OpenRouter Decisions API", { cause: error });
  }
  if (!response.ok) throw new Error(`OpenRouter Decisions API returned HTTP ${response.status}`);
  // Bound memory before decoding (Response.text() would read an unbounded body).
  const reader = response.body?.getReader();
  if (!reader) throw new Error("OpenRouter returned an empty response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new Error("OpenRouter decision response exceeds 256 KiB");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const text = Buffer.concat(chunks, size).toString("utf8");
  let payload: unknown;
  try { payload = JSON.parse(text); } catch { throw new Error("OpenRouter returned invalid JSON"); }
  const answers = parseAnswers(payload, input.questions);
  return { answers, model: record(payload) && typeof payload.model === "string" ? payload.model : MODEL,
    usage: record(payload) && record(payload.usage) ? payload.usage : undefined };
}
