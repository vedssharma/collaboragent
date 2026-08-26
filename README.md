# Collaboragent

Collaboragent is a working product prototype for a shared AI-agent workspace. A user chooses coding, design, or research, gives the team a mission, and Collaboragent divides the work across specialized agents while a normalized event stream makes the collaboration visible in real time.

## What is included

- A responsive collaboration room with agent ownership, status, progress, file activity, and Google-Docs-style cursors.
- Dedicated coding, design, and research workspaces with mode-specific agent roles and workflows.
- An editable spatial canvas for agent-created shapes, assets, notes, labels, and diagrams.
- A web-grounded research studio that streams verified sources into a structured, citation-linked paper.
- A streamed server-sent event protocol for run, agent, task, file, review, and completion events.
- Interactive mission submission, pausing, restarting, agent inspection, and file selection.
- Real AI SDK v7 execution across Claude, Gemini, and OpenAI/Codex models.
- Claude Code and Codex harness adapters, plus a provider readiness endpoint.

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

The harness smoke test provisions a real Vercel Sandbox and verifies the full
Claude Code → Codex → Claude handoff on one shared file, so it incurs provider
and sandbox usage.

## Provider setup

Copy `.env.example` to `.env.local` and provide `AI_GATEWAY_API_KEY` for model mode. Linking the repository to a Vercel project populates `VERCEL_OIDC_TOKEN`, which enables Coding agents and Vercel Sandbox access. The `/api/providers` endpoint detects configured capabilities without returning secrets to the browser.

`POST /api/runs` accepts a `workType` of `coding`, `design`, or `research` and supports two real execution modes:

- `harness`: Claude Code and Codex collaborate sequentially inside one isolated Vercel Sandbox filesystem. Claude creates the architecture and first implementation, Codex inspects and completes it, and Claude performs the final review before Collaboragent collects the files and destroys the sandbox. This mode appears as **Coding agents** when `VERCEL_OIDC_TOKEN` is configured.
- `live`: Claude and Gemini generate architecture and UX direction in parallel, Codex produces complete project files, and an independent OpenAI reviewer scores the artifacts. Every stage is projected into the `RunEvent` protocol and the generated files appear in the shared editor.

Design and research use live mode. Design streams a typed spatial board into the canvas. Research uses the AI Gateway web-search tool, preserves returned source URLs, writes a multi-section paper from that source packet, and sends it through an independent research review.

Generated artifacts remain in the browser session; neither real execution mode writes to the host filesystem.

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
