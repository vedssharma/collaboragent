import { getExecutionCapabilities } from './provider-config';
export { getExecutionCapabilities } from './provider-config';

type HarnessDefinition = {
  id: 'claude' | 'codex';
  label: string;
  packageName: string;
  isConfigured: () => boolean;
};

/**
 * Server-only readiness catalog for the coding runtimes. The harness sessions
 * themselves are created in harness-collaboration.ts.
 */
export const harnessCatalog: HarnessDefinition[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    packageName: '@ai-sdk/harness-claude-code',
    isConfigured: () =>
      Boolean(
        getExecutionCapabilities().liveModels ||
          process.env.ANTHROPIC_API_KEY ||
          process.env.ANTHROPIC_AUTH_TOKEN,
      ),
  },
  {
    id: 'codex',
    label: 'Codex',
    packageName: '@ai-sdk/harness-codex',
    isConfigured: () =>
      Boolean(
        getExecutionCapabilities().liveModels ||
          process.env.CODEX_API_KEY ||
          process.env.OPENAI_API_KEY,
      ),
  },
];

export function getProviderSummaries() {
  return [
    ...harnessCatalog.map(({ id, label, packageName, isConfigured }) => ({
      id,
      label,
      packageName,
      kind: 'coding-harness' as const,
      configured: isConfigured(),
    })),
    {
      id: 'gemini',
      label: 'Gemini',
      packageName: 'AI SDK provider',
      kind: 'model-agent' as const,
      configured: Boolean(
        getExecutionCapabilities().liveModels ||
          process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      ),
    },
  ];
}
