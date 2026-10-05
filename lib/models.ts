type Environment = Record<string, string | undefined>;

export const DEFAULT_MODELS = {
  architect: 'anthropic/claude-sonnet-5',
  researcher: 'google/gemini-3.7-flash',
  builder: 'openai/gpt-5.3-codex-fast',
  reviewer: 'openai/gpt-5.6-luna-fast',
} as const;

export type ModelRole = keyof typeof DEFAULT_MODELS;

const GATEWAY_MODEL_ID = /^[a-z0-9-]+\/[a-z0-9._:-]+$/i;

/**
 * AI Gateway model ids for each role. Override any of them with
 * COLLABORAGENT_MODEL_ARCHITECT, _RESEARCHER, _BUILDER or _REVIEWER
 * (for example `anthropic/claude-haiku-4.5` for a cheaper team).
 */
export function resolveModels(env: Environment = process.env): Record<ModelRole, string> {
  const pick = (role: ModelRole) => {
    const override = env[`COLLABORAGENT_MODEL_${role.toUpperCase()}`]?.trim();
    return override && GATEWAY_MODEL_ID.test(override) ? override : DEFAULT_MODELS[role];
  };
  return { architect: pick('architect'), researcher: pick('researcher'), builder: pick('builder'), reviewer: pick('reviewer') };
}

export type TokenUsage = { inputTokens: number; outputTokens: number; calls: number };

type UsageLike = { usage?: { inputTokens?: number; outputTokens?: number } };

/** Sums token usage across every model call in one run. */
export function createUsageTracker() {
  const totals: TokenUsage = { inputTokens: 0, outputTokens: 0, calls: 0 };
  return {
    async track<T extends UsageLike>(call: PromiseLike<T>): Promise<T> {
      const result = await call;
      totals.inputTokens += result.usage?.inputTokens ?? 0;
      totals.outputTokens += result.usage?.outputTokens ?? 0;
      totals.calls += 1;
      return result;
    },
    get totals(): TokenUsage { return { ...totals }; },
  };
}

export function formatTokens(count: number) {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}
