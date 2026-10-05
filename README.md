# Collaboragent

Collaboragent is a working product prototype for a shared AI-agent workspace. A user chooses coding, design, or research, gives the team a mission, and Collaboragent divides the work across specialized agents while a normalized event stream makes the collaboration visible in real time.

## What is included

- A responsive collaboration room with agent ownership, status, progress, file activity, and Google-Docs-style cursors.
- Dedicated coding, design, and research workspaces with mode-specific agent roles and workflows.
- An editable spatial canvas for agent-created shapes, assets, notes, labels, and diagrams.
- A web-grounded research studio that streams verified sources into a structured, citation-linked paper.
- A streamed server-sent event protocol for run, agent, task, file, review, and completion events.
- Interactive mission submission, stopping, retrying (output merges into existing artifacts), agent inspection, and file selection.
- Real AI SDK v7 execution across Claude, Gemini, and OpenAI/Codex models.
- Follow-up requests: turn on **Build on result** to send the current files, board or paper with the next instruction so the team revises it instead of starting over. Coding-agent runs restore the previous files into the sandbox first.
- Claude Code and Codex harness adapters, plus a provider readiness endpoint.
  Harness runs collect up to 60 files (48 KB each, 400 KB total) and report anything skipped or truncated.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Quality checks:

```bash
npm run typecheck
npm run lint
npm run build
npm run smoke:harness
```

Browser regression tests (mocked model streams; no provider spend):

```bash
npx playwright install chromium
npm run test:e2e
```

The suite covers mobile submission, retry preservation, interrupted streams,
keyboard submission, review counts, empty files, research navigation, canvas
panning/export, request validation, and provider setup. Boards export as SVG.

The harness smoke test provisions a real Vercel Sandbox and verifies the full
Claude Code → Codex → Claude handoff on one shared file, so it incurs provider
and sandbox usage.

## Provider setup

Copy `.env.example` to `.env.local` and provide `AI_GATEWAY_API_KEY` for model mode. Linking the repository to a Vercel project populates `VERCEL_OIDC_TOKEN`, which enables Coding agents and Vercel Sandbox access. The `/api/providers` endpoint detects configured capabilities without returning secrets to the browser.

Open **Settings → Provider connections** to inspect configuration and setup
instructions. Configuration is not proof of provider access: the run performs
actual authentication. Expired OIDC credentials disable sandbox execution. For
local development, link the current project, run `vercel env pull .env.local`,
and restart. Alternatively, supply all of `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, and
`VERCEL_PROJECT_ID` on the server for Sandbox access. AI Gateway is still required
for the Gemini research stage. Direct API keys configure the corresponding
coding harness, not the complete multi-provider model pipeline.

### Access control and limits

Every run spends provider credit, and coding-agent runs provision billable
sandboxes, so `/api/runs` is gated:

- Set `COLLABORAGENT_ACCESS_TOKEN` to require a shared access code. Users enter
  it under **Settings → Provider connections**; it is stored only in their
  browser and sent as the `x-collaboragent-access` header.
- In production, runs are refused until a token is configured. Set
  `COLLABORAGENT_ALLOW_ANONYMOUS=true` only if the deployment is protected some
  other way (for example Vercel Deployment Protection).
- Each client gets one concurrent run, 20 runs per hour and 4 coding-agent
  sandboxes per hour; the server allows 4 concurrent runs in total. Override
  with `COLLABORAGENT_RUNS_PER_HOUR`, `COLLABORAGENT_HARNESS_RUNS_PER_HOUR` and
  `COLLABORAGENT_MAX_CONCURRENT_RUNS`. Limits are kept in memory per server
  instance.

### Subscription sign-in limitations

This hosted app does **not** currently offer ChatGPT or Claude subscription
sign-in. The installed AI SDK adapters support API keys and AI Gateway rather
than subscription OAuth. Official Codex clients support ChatGPT sign-in,
including `codex login --device-auth`, but that is not wired into this app's
request-scoped sandbox adapter. See [Codex authentication](https://learn.chatgpt.com/docs/auth).

Anthropic does not permit third-party products to offer Claude.ai login without
approval. Claude Code access here uses API/gateway credentials; a Claude
subscription does not provide those credentials. See
[Claude authentication rules](https://code.claude.com/docs/en/legal-and-compliance).
No subscription credentials are collected or copied from the user's machine.
Per-user account linking would also require application accounts, isolated
server-side credential storage, revocation, and supported provider integrations.

`POST /api/runs` accepts a `workType` of `coding`, `design`, or `research` and supports two real execution modes:

- `harness`: Claude Code and Codex collaborate sequentially inside one isolated Vercel Sandbox filesystem. Claude creates the architecture and first implementation, Codex inspects and completes it, and Claude performs the final review before Collaboragent collects the files and destroys the sandbox. This mode appears as **Coding agents** when `VERCEL_OIDC_TOKEN` is configured.
- `live`: Claude and Gemini generate architecture and UX direction in parallel, Codex produces complete project files, and an independent OpenAI reviewer scores the artifacts. Every stage is projected into the `RunEvent` protocol and the generated files appear in the shared editor.

Design and research use live mode. Design streams a typed spatial board into the canvas. Research uses the AI Gateway web-search tool, preserves returned source URLs, writes a multi-section paper from that source packet, and sends it through an independent research review.

Generated artifacts are saved in the browser's local storage so a refresh keeps
the last files, board and paper for each workspace; neither real execution mode
writes to the host filesystem. Runs themselves are tied to the streaming
request: closing the tab stops the run. Server-side run storage with
reconnectable event streams is the next step for durable, shareable runs.

Claude Code and Codex use the experimental AI SDK harness interface. Harness sessions require `VERCEL_OIDC_TOKEN` and provision billable isolated sandboxes. The request-scoped implementation always destroys its sandbox; persistent projects should store each opaque resume state and sandbox identity in durable storage.

## Architecture

```text
Mission brief
    ↓
Orchestrator / task graph
    ├── Claude architect ────┐
    ├── Gemini researcher ───┼── Codex builder ── reviewer
    └── coding harnesses* ───┘             ↓
                                  normalized RunEvent stream
                                              ↓
                                      live collaboration UI
                                      ├── presence/cursors
                                      ├── activity timeline
                                      ├── files and patches
                                      └── approvals/status

* Activated separately when Vercel Sandbox authentication is configured.
```

For production, agents should work in isolated branches or worktrees. A merge gate—not direct concurrent writes—should own conflict resolution, tests, approval policy, and integration into the shared branch.
