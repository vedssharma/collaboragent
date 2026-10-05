import { createHash, timingSafeEqual } from 'node:crypto';

type Environment = Record<string, string | undefined>;

export const ACCESS_HEADER = 'x-collaboragent-access';

export type AccessDecision =
  | { ok: true; clientKey: string }
  | { ok: false; status: 401 | 503; error: string };

function digest(value: string) {
  return createHash('sha256').update(value).digest();
}

/**
 * Whether the browser must supply an access code. Runs spend provider credit
 * and can provision billable sandboxes, so a deployment must not accept them
 * anonymously: set COLLABORAGENT_ACCESS_TOKEN to require a shared passcode.
 * Local development stays open unless a token is configured; production
 * refuses runs until one is (or anonymous access is explicitly allowed).
 */
export function accessRequired(env: Environment = process.env) {
  return Boolean(env.COLLABORAGENT_ACCESS_TOKEN);
}

export function checkAccess(request: Request, env: Environment = process.env): AccessDecision {
  const expected = env.COLLABORAGENT_ACCESS_TOKEN;
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'local';

  if (!expected) {
    if (env.NODE_ENV === 'production' && env.COLLABORAGENT_ALLOW_ANONYMOUS !== 'true') {
      return {
        ok: false,
        status: 503,
        error: 'This deployment has no access token. Set COLLABORAGENT_ACCESS_TOKEN on the server before running agents.',
      };
    }
    return { ok: true, clientKey: `ip:${clientIp}` };
  }

  const provided = request.headers.get(ACCESS_HEADER) ?? '';
  // Compare fixed-length digests so the comparison leaks neither content nor length.
  if (!provided || !timingSafeEqual(digest(provided), digest(expected))) {
    return { ok: false, status: 401, error: 'Enter the workspace access code in Provider connections to run agents.' };
  }
  return { ok: true, clientKey: `ip:${clientIp}` };
}

type Window = { started: number[]; active: number };

/**
 * In-memory limits. They apply per server instance, which is enough to stop a
 * runaway client or a leaked URL; a shared store is needed for strict global
 * quotas across instances.
 */
export function createRunLimiter({
  windowMs = 60 * 60 * 1000,
  maxRuns = 20,
  maxHarnessRuns = 4,
  maxConcurrentPerClient = 1,
  maxConcurrentTotal = 4,
  now = () => Date.now(),
}: {
  windowMs?: number;
  maxRuns?: number;
  maxHarnessRuns?: number;
  maxConcurrentPerClient?: number;
  maxConcurrentTotal?: number;
  now?: () => number;
} = {}) {
  const clients = new Map<string, Window & { harness: number[] }>();
  let activeTotal = 0;

  return {
    acquire(clientKey: string, harness: boolean):
      | { ok: true; release: () => void }
      | { ok: false; error: string; retryAfterSeconds: number } {
      const at = now();
      const client = clients.get(clientKey) ?? { started: [], harness: [], active: 0 };
      client.started = client.started.filter((time) => at - time < windowMs);
      client.harness = client.harness.filter((time) => at - time < windowMs);
      clients.set(clientKey, client);

      const retryAfter = (times: number[]) => Math.max(1, Math.ceil((times[0] + windowMs - at) / 1000));
      if (client.active >= maxConcurrentPerClient || activeTotal >= maxConcurrentTotal) {
        return { ok: false, error: 'A team run is already in progress. Wait for it to finish or stop it first.', retryAfterSeconds: 30 };
      }
      if (client.started.length >= maxRuns) {
        return { ok: false, error: `Run limit reached (${maxRuns} per hour). Try again later.`, retryAfterSeconds: retryAfter(client.started) };
      }
      if (harness && client.harness.length >= maxHarnessRuns) {
        return { ok: false, error: `Coding-agent limit reached (${maxHarnessRuns} sandboxes per hour). Try again later.`, retryAfterSeconds: retryAfter(client.harness) };
      }

      client.started.push(at);
      if (harness) client.harness.push(at);
      client.active += 1;
      activeTotal += 1;
      let released = false;
      return {
        ok: true,
        release: () => {
          if (released) return;
          released = true;
          client.active -= 1;
          activeTotal -= 1;
        },
      };
    },
  };
}

function limit(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const runLimiter = createRunLimiter({
  maxRuns: limit(process.env.COLLABORAGENT_RUNS_PER_HOUR, 20),
  maxHarnessRuns: limit(process.env.COLLABORAGENT_HARNESS_RUNS_PER_HOUR, 4),
  maxConcurrentTotal: limit(process.env.COLLABORAGENT_MAX_CONCURRENT_RUNS, 4),
});
