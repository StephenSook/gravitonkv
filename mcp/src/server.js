// Tool registration shared by the stdio entry and the Vercel remote route.
// Read-only forever: no tool triggers runs or mutates anything.
import { z } from "zod";
import {
  CONFIGS,
  CONTEXTS,
  PRIORITIES,
  loadDocs,
  getHeadlineFinding,
  queryResults,
  compareConfigs,
  recommendConfig,
  getMethodology,
} from "./tools.js";

const MODELS = [
  "Qwen3-4B-Instruct-2507",
  "Qwen3-1.7B",
  "Qwen3-0.6B",
  "Phi-4-mini",
  "Granite-4.0-micro",
  "SmolLM3-3B",
];

function jsonResult(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 1) }] };
}

export function registerTools(server, dataDir) {
  const docs = () => loadDocs(dataDir);

  server.tool(
    "get_headline_finding",
    "Returns the one-paragraph headline result of the GravitonKV study (the prefill/decode/memory " +
      "tradeoff of KV-cache quantization on AWS Graviton4 CPU) with the supporting numbers and source. " +
      "Use for 'what did this benchmark find?'. Takes no parameters.",
    {},
    async () => jsonResult(getHeadlineFinding(docs()))
  );

  server.tool(
    "query_results",
    "Returns median prefill tok/s, decode tok/s, peak memory MiB, variance (stdev, N), and quality " +
      "scores for ONE (model, config, context) cell of the GravitonKV study. config is one of f16, " +
      "q8_0, q4_0, q8_0/q4_0, q4_0/q8_0. Use for a specific data point, not for comparisons.",
    {
      model: z.enum(MODELS),
      config: z.enum(CONFIGS),
      context: z.union(CONTEXTS.map((c) => z.literal(c))),
    },
    async ({ model, config, context }) => jsonResult(queryResults(docs(), model, config, context))
  );

  server.tool(
    "compare_configs",
    "Compares two or more KV-cache configs for a given model and context, returning absolute medians " +
      "and deltas vs the f16 baseline for prefill, decode, and memory. Use for 'which config is best for X?'.",
    {
      model: z.enum(MODELS),
      context: z.union(CONTEXTS.map((c) => z.literal(c))),
      configs: z.array(z.enum(CONFIGS)).min(2),
    },
    async ({ model, context, configs }) => jsonResult(compareConfigs(docs(), model, context, configs))
  );

  server.tool(
    "recommend_config",
    "Recommends the best KV-cache config for a target context length and optimization priority " +
      "(speed, memory, quality, or balanced), with the supporting numbers, the tradeoff, the " +
      "alternatives, and the transparent scoring formula. Use for 'what's the best config for a " +
      "32k workload on Graviton4?'.",
    {
      context: z.number().int().min(512).max(262144),
      priority: z.enum(PRIORITIES),
    },
    async ({ context, priority }) => jsonResult(recommendConfig(docs(), context, priority))
  );

  server.tool(
    "get_methodology",
    "Returns the measurement environment (instance, CPU, kernel, pinned llama.cpp commit, build " +
      "flags), the run standard, and links. Use to verify how the benchmark was run.",
    {},
    async () => jsonResult(getMethodology(docs()))
  );
}
