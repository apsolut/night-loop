# 009 - Codex and Grok join Claude as subscription-CLI providers

Date: 2026-10-19
Milestones: M8, M9

## Decision
NIGHT LOOP keeps one implementer session, one Night Contract, one immutable hook set, and
one Stop-hook verifier, but the implementer binary is selectable at setup:
`--provider claude` (default), `codex`, or `grok`. Each provider is driven through its own
installed CLI on the owner's flat subscription login. This supersedes the "provider adapters
remain outside the backlog" clause of decisions 003 and 004; the rest of both decisions stands.

## Why
The owner asked for it on 2026-10-19, and the ground truth in
`.night-loop/research/2026-10-19-provider-surfaces.md` shows that Codex 0.162 and Grok Build
1.0.46 now ship the same hook schema, a never-ask headless mode, resumable sessions, and a
subscription login. The adapter is argument arrays plus a payload bridge, not a control plane.

## Codex workspace sandbox and network
`workspace-write` is launched with `sandbox_workspace_write.network_access=true`. Codex's
sandbox defaults to no network, which would block the dependency installs the gate
deliberately allows (`bun add`, `npm install`); parity with the Claude profile needs the
network on, and the gate still denies direct fetches, pushes, publishes, and deploys.

## Rejected
- `@openai/codex-sdk` and `grok-agent-sdk`: new dependencies for what argv already does.
- Codex app-server or Grok ACP websocket protocols: more surface, same promise.
- API keys of any kind (decision 001). `OPENAI_API_KEY`, `CODEX_API_KEY`, `XAI_API_KEY`, and
  `GROK_API_KEY` are scrubbed before every launch exactly like the Anthropic variables.
- Provider competition, routing, or running two implementers at once (decision 003).
