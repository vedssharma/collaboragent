import { HarnessAgent } from '@ai-sdk/harness/agent';
import { createClaudeCode } from '@ai-sdk/harness-claude-code';
import { createCodex } from '@ai-sdk/harness-codex';
import { createVercelSandbox } from '@ai-sdk/sandbox-vercel';

if (!process.env.VERCEL_OIDC_TOKEN) {
  throw new Error('VERCEL_OIDC_TOKEN is required.');
}

const sandboxProvider = createVercelSandbox({
  runtime: 'node24',
  ports: [4000, 4001],
  timeout: 6 * 60 * 1000,
});
const claude = new HarnessAgent({
  id: 'Collaboragent-claude-smoke',
  harness: createClaudeCode({
    auth: 'ai-gateway',
    port: 4000,
    maxTurns: 3,
    effort: 'low',
  }),
  permissionMode: 'allow-all',
  sandboxConfig: { workDir: 'smoke-workspace' },
});
const codex = new HarnessAgent({
  id: 'Collaboragent-codex-smoke',
  harness: createCodex({
    auth: 'ai-gateway',
    port: 4001,
    reasoningEffort: 'low',
  }),
  permissionMode: 'allow-all',
  sandboxConfig: { workDir: 'smoke-workspace' },
});

let sandbox;
let activeSession;

async function destroySandboxWithRetry() {
  if (!sandbox) return;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await sandbox.destroy();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
      }
    }
  }
  throw lastError;
}

async function rotateCredentials() {
  await activeSession?.destroy();
  activeSession = undefined;
  await sandbox.setRequestTransformations?.([]);
}

try {
  sandbox = await sandboxProvider.createSession();

  activeSession = await claude.createSession({ sandboxSession: sandbox });
  await claude.generate({
    session: activeSession,
    prompt: 'Use a file tool to create handoff.txt containing exactly CLAUDE followed by a newline.',
    timeout: 2 * 60 * 1000,
  });
  await rotateCredentials();

  activeSession = await codex.createSession({ sandboxSession: sandbox });
  await codex.generate({
    session: activeSession,
    prompt: 'Read handoff.txt and append exactly CODEX followed by a newline. Verify the file.',
    timeout: 2 * 60 * 1000,
  });
  await rotateCredentials();

  activeSession = await claude.createSession({ sandboxSession: sandbox });
  await claude.generate({
    session: activeSession,
    prompt: 'Read handoff.txt and append exactly REVIEWED followed by a newline. Do not change anything else.',
    timeout: 2 * 60 * 1000,
  });

  const workDir = `${sandbox.defaultWorkingDirectory}/smoke-workspace`;
  const content = await sandbox.restricted().readTextFile({
    path: `${workDir}/handoff.txt`,
  });
  if (content !== 'CLAUDE\nCODEX\nREVIEWED\n') {
    throw new Error(`Unexpected coding-agent handoff: ${JSON.stringify(content)}`);
  }
  console.log('coding-agents:ready (Claude -> Codex -> Claude)');
} finally {
  await activeSession?.destroy();
  await destroySandboxWithRetry();
}
