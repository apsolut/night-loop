# 001 - Flat subscription billing only, never metered API

Date: 2026-07-29
Milestone: (product-wide, applies to all NIGHT LOOP runs)

## Decision
Every model call in the loop runs on flat subscription credits: Claude via the
interactive Max session, Codex via ChatGPT-plan sign-in, Gemini (Agy) via its
Google-subscription CLI login, Grok via its subscription plan. No BYO API keys,
no metered calls, for any role (builder, judge, watchdog diagnostic).

## Why
Headless `claude -p` and the Agent SDK on subscription plans draw the separate
metered Agent SDK credit (verified 2026-06-15, see HANDOFF.md); an overnight loop
on metered billing is exactly the OpenClaw $100+/day failure mode. Flat limits
make the worst case a rate-limit pause, not a bill.

## Rejected
- Headless `claude -p` for watchdog diagnostics: metered. Use shell heuristics,
  or an interactive session if a model is truly needed.
- Pi (pi.dev) or any BYO-key orchestrator: bills metered API by construction.
- Cloud VMs that break the logged-in subscription session: pushes back to metered.
