import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, prepareRequest, parseAnswers, MODEL, type DecisionRequest } from "../extensions/decisions.ts";

const input: DecisionRequest = {
  state: { ticket: "Checkout is blank after clicking Pay" },
  questions: {
    team: { type: "choice", instructions: "Which team?", criteria: { payments: "Checkout failures", frontend: "Rendering issues" } },
    bug: { type: "noul", instructions: "Is it broken?", criteria: { true: "Broken behavior", false: "Expected behavior" } },
    urgency: { type: "score", instructions: "How urgent?", criteria: ["Low", "Medium", "High"] },
  },
};
const answers = {
  team: { type: "choice", choice: "payments", probabilities: { payments: 0.8, frontend: 0.2 }, confidence: 0.6 },
  bug: { type: "noul", noul: 0.91 },
  urgency: { type: "score", score: 1.7, probabilities: { 0: 0, 1: 0.3, 2: 0.7 }, legend: { 0: "Low", 1: "Medium", 2: "High" } },
};

test("sends typed batch to Decisions API, returns all answers and usage", async () => {
  const result = await decide(input, "secret", undefined, async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/alpha/decisions");
    assert.equal(options?.method, "POST");
    assert.equal((options?.headers as Record<string, string>).Authorization, "Bearer secret");
    assert.deepEqual(JSON.parse(options?.body as string), { model: MODEL, ...input });
    return new Response(JSON.stringify({ answers, model: MODEL, usage: { input_tokens: 42 } }), { status: 200 });
  });
  assert.deepEqual(result.answers.team, answers.team);
  assert.deepEqual(result.answers.bug, answers.bug);
  assert.deepEqual(result.answers.urgency, answers.urgency);
  assert.deepEqual(result.usage, { input_tokens: 42 });
});

test("rejects invalid questions before network calls", () => {
  assert.throws(() => prepareRequest({ ...input, questions: {} }), /nonempty/);
  assert.throws(() => prepareRequest({ ...input, questions: { x: { type: "score", instructions: "rate", criteria: ["one"] } } }), /2–10/);
  assert.throws(() => prepareRequest({ ...input, questions: { x: { type: "choice", instructions: "pick", criteria: { only: "One" } } } }), /2–255/);
  assert.throws(() => prepareRequest({ ...input, questions: { x: { type: "noul", instructions: "  " } } }), /instructions/);
  assert.throws(() => prepareRequest({ state: "x".repeat(300_000), questions: input.questions }), /256 KiB/);
});

test("rejects malformed or incomplete upstream results", () => {
  assert.throws(() => parseAnswers({ answers: { ...answers, team: { type: "choice", choice: "missing" } } }, input.questions), /unknown choice/);
  assert.throws(() => parseAnswers({ answers: { ...answers, bug: { type: "noul", noul: 2 } } }, input.questions), /invalid noul/);
  assert.throws(() => parseAnswers({ answers: { ...answers, urgency: { type: "score", score: -1 } } }, input.questions), /invalid score/);
  assert.throws(() => parseAnswers({ answers: { team: answers.team } }, input.questions), /invalid answer/);
});

test("non-2xx responses expose status, not response body or key", async () => {
  await assert.rejects(decide(input, "secret", undefined, async () => new Response("secret upstream error", { status: 401 })),
    error => error instanceof Error && error.message === "OpenRouter Decisions API returned HTTP 401");
});

test("malformed and oversized responses fail closed", async () => {
  await assert.rejects(decide(input, "secret", undefined, async () => new Response("not json")), /invalid JSON/);
  await assert.rejects(decide(input, "secret", undefined, async () => new Response("x".repeat(300_000))), /exceeds 256 KiB/);
});

test("aborted request is reported as cancelled", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(decide(input, "secret", controller.signal, async (_url, options) => {
    if (options?.signal?.aborted) throw new Error("aborted");
    throw new Error("should be aborted");
  }), /cancelled/);
});
