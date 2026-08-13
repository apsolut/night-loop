# NIGHT LOOP Handoff

Date: 2026-08-13

## Product boundary

NIGHT LOOP is a Claude Code-only trust layer for one native background implementer session. Local
`.apsolut-agents/` state and contributor use of Codex, Grok, or Agy are private development tooling,
not runtime integrations or public dependencies.

## Current runtime

- `src/cli.ts` exposes setup, start, full, status, stop, resume, morning, and doctor.
- `src/night-loop.ts` owns the Night Contract, native Claude command arrays, monitor, durable state,
  environment scrub, and Morning Receipt.
- `.night-loop/hooks/events.ts` is the structured Question Firewall and event collector.
- `.night-loop/hooks/gate.ts` keeps irreversible and external actions blocked in every profile.
- `.night-loop/hooks/loop.ts` independently verifies completion through the ratchet and full harness.
- `.claude-plugin/plugin.json`, `skills/`, `agents/`, and `hooks/` package the public Claude plugin.
- PowerShell and POSIX launchers forward to the same Bun entry point with no tmux or WSL.
- CI defines Windows, Linux, and macOS deterministic jobs.

## Permission contract

- `start` defaults to workspace and maps to Claude `dontAsk`.
- `full` is the exact parser alias for `start --permissions full` and maps to
  `bypassPermissions` without confirmation.
- Full never weakens the immutable gate, credential scrub, worker cap, step cap, relaunch cap, or
  test-only production boundary.
- Resume restores the saved run profile and limits, even if attended setup defaults later change.

## Verification state

M0 was previously accepted. M1 through M5 require fresh independent judge certification against
the updated backlog and current harness. M6 remains hard-blocked until GitHub-hosted Windows, Linux,
and macOS jobs run on the same commit. M7 remains hard-blocked until the owner approves test Claude
authentication for a live smoke.

Do not create `CLAIM_DONE` until every non-gated milestone is independently accepted and the full
harness is green.
