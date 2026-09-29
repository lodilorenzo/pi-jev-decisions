# pi-jev-decisions

A Pi extension exposing OpenRouter's **Jev Decisions API** as one model-callable `jev_decide` tool. Jev is a decision model, **not** a Pi chat model; this package does not switch models or approve actions.

## Install

Install directly from this Gitea repository:

```sh
pi install https://gitea.home.lodilorenzo.dev/lodil/pi-jev-decisions
```

Restart Pi (or use `/reload` if it is already running). Run `/login openrouter` in Pi, or set `OPENROUTER_API_KEY` in the environment that launches Pi. OpenRouter usage is billed separately from other providers' subscriptions. No key is written to this package.

To develop locally, clone the repository and run `pi install ./` from its root. To try the local source for one run without installing, use `pi -e ./extensions/jev.ts`.

## Use

Ask Pi: “Use Jev to decide whether this ticket is a bug, which team owns it, and its urgency.” The agent can send a single `jev_decide` call:

```json
{
  "state": { "ticket": "Checkout is blank after clicking Pay" },
  "questions": {
    "team": { "type": "choice", "instructions": "Which team owns this ticket?", "criteria": { "payments": "Checkout or payment problems", "frontend": "Page rendering problems", "none": "Neither fits" } },
    "bug": { "type": "noul", "instructions": "Does the ticket describe broken behavior?", "criteria": { "true": "An existing feature is broken", "false": "A feature request or expected behavior" } },
    "urgency": { "type": "score", "instructions": "How urgent is this?", "criteria": ["Can wait", "Fix soon", "Blocking a transaction"] }
  }
}
```

`choice` returns a named option; `noul` returns the probability of yes (0–1); `score` is a **fractional, zero-based** position across the ordered rubric (not a 0–1 probability). The tool also forwards optional probability/confidence details and usage from OpenRouter. Confidence is not a guarantee of correctness. Keep permissions, deterministic checks, and consequential action approval in your own workflow.

State and questions are sent to OpenRouter: avoid secrets or sensitive data. Calls use `typesafe/jev-1.13` and `POST https://openrouter.ai/api/alpha/decisions`; only successful typed answers are returned to the agent. Requests time out after 30 seconds and accept up to 256 KiB of JSON.

Run offline tests: `npm test` (Node 22+).
