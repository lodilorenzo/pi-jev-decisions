import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { decide, type DecisionRequest } from "./decisions.ts";

const questionBase = { instructions: Type.String({ description: "Precise, self-contained question to judge against state" }) };
const Params = Type.Object({
  state: Type.Unknown({ description: "Text, object, or array containing only the relevant facts. Sent to OpenRouter; avoid secrets." }),
  questions: Type.Record(Type.String(), Type.Union([
    Type.Object({ type: Type.Literal("choice"), ...questionBase,
      criteria: Type.Record(Type.String(), Type.String(), { description: "Option name -> description; include 'none' if appropriate (2–255 options)" }) }),
    Type.Object({ type: Type.Literal("noul"), ...questionBase,
      criteria: Type.Optional(Type.Object({
        true: Type.Optional(Type.String()), false: Type.Optional(Type.String()),
      }, { description: "Optional descriptions of yes and no" })) }),
    Type.Object({ type: Type.Literal("score"), ...questionBase,
      criteria: Type.Array(Type.String(), { description: "2–10 ordered levels, lowest to highest; score is a fractional zero-based position" }) }),
  ]), { description: "Question ID -> typed question; batch related questions in one call" }),
});

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "jev_decide",
    label: "Jev decisions",
    description: "Ask OpenRouter's Jev model typed questions about supplied state. choice picks a named option; noul returns P(yes) in [0,1]; score returns a probability-weighted zero-based position across ordered levels. Outputs are judgments, not authorization or facts. Sends state to OpenRouter; do not include secrets. Does not change the active Pi model.",
    parameters: Params,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      // Pi's credential resolution supports /login openrouter, models.json, and provider env keys.
      const key = await ctx.modelRegistry.getApiKeyForProvider("openrouter") || process.env.OPENROUTER_API_KEY;
      const result = await decide(params as DecisionRequest, key ?? "", signal);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  });
}
