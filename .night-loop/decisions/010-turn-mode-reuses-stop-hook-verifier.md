# 010 - Turn-mode providers reuse loop.ts as the verifier between turns

Date: 2026-10-19
Milestone: M8

## Decision
`codex exec` and `grok -p` run one headless turn per process and exit. For these providers the
detached supervisor runs the turn, then executes the unchanged Stop hook
(`.night-loop/hooks/loop.ts`) as a subprocess with `CLAUDE_PROJECT_DIR` pointing at the repo,
and feeds its exact block reason to the provider as the next prompt. No output from the hook
means the hook halted the run (done, blocked, or budget) and no further turn is launched. If the
hook printed nothing and wrote no HALTED marker, it crashed: the supervisor writes
`HALTED=verifier_failed` and stops rather than launch an unverified turn. The armed limits reach
the in-turn hooks through `NIGHT_LOOP_MAX_STEPS` and, as a fallback, `run.json`, so a later
attended `setup` cannot change what a running night enforces.
Inside a turn, the same hooks also run natively (Codex via config overrides, Grok via a
generated project hook file), so a long turn is verified the same way a Claude session is.

## Why
One verdict implementation. The halt tests already prove loop.ts; duplicating its decision
table in the supervisor would be a second place to drift.

## Rejected
- A second verifier written in the supervisor.
- Skipping in-turn hooks for non-Claude providers (the gate must see every tool call).
