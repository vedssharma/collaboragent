import { createClaudeCode } from '@ai-sdk/harness-claude-code';
import { createCodex } from '@ai-sdk/harness-codex';
import type { HarnessV1 } from '@ai-sdk/harness';
import { HarnessAgent } from '@ai-sdk/harness/agent';
import { createVercelSandbox } from '@ai-sdk/sandbox-vercel';

type HarnessDefinition = {
  id: 'claude' | 'codex';
  label: string;
  packageName: string;
  isConfigured: () => boolean;
  create: () => HarnessV1;
};

/**
 * Server-only catalog for real coding runtimes. The UI uses the same provider
 * ids and event vocabulary across model and sandboxed HarnessAgent sessions.
 */
export const harnessCatalog: HarnessDefinition[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    packageName: '@ai-sdk/harness-claude-code',
    isConfigured: () =>
      Boolean(
        process.env.AI_GATEWAY_API_KEY ||
          process.env.VERCEL_OIDC_TOKEN ||
          process.env.ANTHROPIC_API_KEY ||
          process.env.ANTHROPIC_AUTH_TOKEN,
      ),
    create: () => createClaudeCode({ auth: 'auto' }),
  },
  {
    id: 'codex',
    label: 'Codex',
    packageName: '@ai-sdk/harness-codex',
    isConfigured: () =>
      Boolean(
        process.env.AI_GATEWAY_API_KEY ||
          process.env.VERCEL_OIDC_TOKEN ||
          process.env.CODEX_API_KEY ||
          process.env.OPENAI_API_KEY,
      ),
    create: () => createCodex({ auth: 'auto' }),
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
        process.env.AI_GATEWAY_API_KEY ||
          process.env.VERCEL_OIDC_TOKEN ||
          process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      ),
    },
  ];
}

export function getExecutionCapabilities() {
  const gatewayReady = Boolean(
    process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN,
  );
  const sandboxReady = Boolean(process.env.VERCEL_OIDC_TOKEN);
  return {
    liveModels: gatewayReady,
    codingHarnesses: gatewayReady && sandboxReady,
    sandbox: sandboxReady,
  };
}

/**
 * Creates a real, isolated coding harness. Session creation is intentionally
 * deferred until a user starts a harness run because it provisions a billable
 * remote sandbox.
 */
export function createCodingHarnessAgent(providerId: 'claude' | 'codex') {
  const definition = harnessCatalog.find((provider) => provider.id === providerId);
  if (!definition) throw new Error(`Unknown coding harness: ${providerId}`);

  return new HarnessAgent({
    id: `Collaboragent-${providerId}-harness`,
    harness: definition.create(),
    instructions:
      'Work only inside the assigned sandbox. Make focused changes, report file operations clearly, and keep the project runnable.',
    sandbox: createVercelSandbox({
      runtime: 'node24',
      ports: [4000],
      timeout: 15 * 60 * 1000,
    }),
  });
}
