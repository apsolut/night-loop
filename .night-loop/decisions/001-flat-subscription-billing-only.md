# 001 - Flat subscription billing only, never metered API

Date: 2026-07-29
Milestone: (product-wide, applies to all NIGHT LOOP runs)

## Decision
Every model call in the NIGHT LOOP runtime uses the logged-in native Claude Code
subscription session, including native background sessions. No BYO API keys and no metered calls are allowed for
the builder, judge, or watchdog diagnostic.

## Why
Headless `claude -p` and the Agent SDK are excluded from this runtime. An overnight loop
on metered billing is exactly the OpenClaw $100+/day failure mode. Flat limits
make the worst case a rate-limit pause, not a bill.

## Rejected
- Headless `claude -p` for watchdog diagnostics: metered. Use shell heuristics,
  or an interactive session if a model is truly needed.
- Any BYO-key orchestrator: bills metered API by construction.
- Cloud VMs that break the logged-in subscription session: pushes back to metered.
