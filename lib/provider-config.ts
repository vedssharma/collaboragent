type Environment = Record<string, string | undefined>;

// This only detects an expired credential; successful authentication still has
// to be established by the provider. Never return credentials to the browser.
function oidcConfigured(env: Environment) {
  const token = env.VERCEL_OIDC_TOKEN;
  if (!token) return false;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    return typeof payload.exp === 'number' && payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

export function getSandboxOptions(env: Environment = process.env) {
  return env.VERCEL_TOKEN && env.VERCEL_TEAM_ID && env.VERCEL_PROJECT_ID
    ? { token: env.VERCEL_TOKEN, teamId: env.VERCEL_TEAM_ID, projectId: env.VERCEL_PROJECT_ID }
    : {};
}

export function getExecutionCapabilities(env: Environment = process.env) {
  const oidc = oidcConfigured(env);
  const gateway = Boolean(env.AI_GATEWAY_API_KEY) || oidc;
  const sandbox = Boolean(getSandboxOptions(env).token) || oidc;
  return { liveModels: gateway, codingHarnesses: gateway && sandbox, sandbox };
}

export function getConnectionSetup(env: Environment = process.env) {
  const capabilities = getExecutionCapabilities(env);
  return {
    gateway: capabilities.liveModels ? 'configured' : 'missing',
    sandbox: capabilities.sandbox ? 'configured' : env.VERCEL_OIDC_TOKEN ? 'expired-or-invalid' : 'missing',
    message: capabilities.codingHarnesses
      ? 'Server credentials are configured. Access is verified when a run starts.'
      : capabilities.liveModels
        ? 'Model team is available. Coding agents also need valid Vercel Sandbox credentials.'
        : 'The team needs an AI Gateway connection before it can run.',
  } as const;
}
