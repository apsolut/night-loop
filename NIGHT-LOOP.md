# NIGHT LOOP - Operator Guide

An autonomous coding agent that drives the **interactive** Claude Code CLI in a loop until a
project reaches a testable MVP, then halts for you to debug. It stays on the flat interactive
Max limits by using a Stop hook to keep one session working, instead of metered headless `claude -p`.

## Designed to run while you sleep
Three things make the night hands-off and safe by construction, not by you approving anything:
1. **Front-load the owner decisions at intake.** Data source, auth approach, billing model, and
   the wedge are decided while you are awake (the intake questions), so the night has no gates to hit.
2. **Only test credentials and seeded data are in the jail.** The agent builds and tests
   auth/billing/payments against fakes; no real card, DB, or user is connected, so nothing
   irreversible is even possible. Real cutover is a separate, awake decision.
3. **Gates shelve, they do not stop.** A milestone it cannot build or test without real ground
   truth is parked under Blocked and the loop moves on. It halts only when the MVP is done, the
   only work left is blocked, or the step cap is hit.

You answer ~5 questions, run it, and sleep. You wake to a built, tested MVP plus a short list of
shelved items and a security surface to review before production.

## How it works

```
scripts/night-loop.sh (supervisor, in tmux)
   |  launches ->  claude  (interactive, one session)
   |                 |  does a turn
   |                 v
   |            Stop hook: .claude/hooks/loop.ts
   |                 |  not done?  -> {"decision":"block","reason":"...next..."}  (keeps going)
   |                 |  done?      -> writes HALTED, lets Claude stop
   |  <- polls HALTED / detects session end / detects stall, then resumes or stops
```

- **The loop is the Stop hook.** It runs the harness every turn and forces continuation until
  the build proves done. Claude never declares itself done; the hook verifies.
- **State is git + markdown**, not conversation history. A SessionStart hook re-injects
  `progress.md` each (re)launch and, while armed, auto-submits the resume kickoff
  (`initialUserMessage`), so fresh sessions resume cleanly and start working on their own.
- **Armed, not always-on.** The Stop hook only loops when `.night-loop/state/ACTIVE` exists
  (the supervisor creates it). Opening `claude` here manually is never hijacked.

## Files

| File | Role |
|---|---|
| `CLAUDE.md` | The agent's operating protocol (entry point) |
| `.claude/settings.json` | Registers the Stop / SessionStart / PreToolUse hooks + permission deny rules |
| `.claude/hooks/loop.ts` | Stop hook = the outer loop and independent done-verifier |
| `.claude/hooks/resume.ts` | SessionStart hook = injects progress + git state |
| `.claude/hooks/gate.ts` | PreToolUse hook = denies escape commands, flags security surfaces for morning review (never halts) |
| `.claude/hooks/lib.ts` | Shared helpers (markers, harness runners) |
| `.claude/agents/judge.md` | The separate-context verifier for milestone acceptance |
| `.claude/skills/intake/SKILL.md` | The attended front half: 5 questions + research to backlog.yaml |
| `scripts/night-loop.sh` | The tmux supervisor (launch, resume, backoff, halt) |
| `Dockerfile` | The isolated jail |
| `.night-loop/backlog.yaml` | The contract (M0 + the research-derived spec) |
| `.night-loop/progress.md` | The ledger |
| `.night-loop/constraints.md` | Durable rules, reloaded every plan |

### Markers (`.night-loop/state/`)
`ACTIVE` armed · `STEP` turn counter · `CLAIM_DONE` agent's done claim (verified by the hook) ·
`ALL_BLOCKED` only blocked work remains, halt for morning · `REVIEW` security-surface files touched
(for the morning review) · `HALTED` supervisor-read halt signal (done/blocked/budget).

## Run it

```bash
# 1. Build the jail
docker build -t night-loop .

# 2. Start the loop (mount your repo and your Claude auth)
docker run --rm -it \
  -v "$PWD:/work" \
  -v "$HOME/.claude:/home/loop/.claude" \
  --cap-drop ALL \
  night-loop
# -> scripts/night-loop.sh arms the loop and launches the interactive session.
```

Test the hook BEFORE trusting it overnight:
```bash
echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf /tmp/x"}}' | bun .claude/hooks/gate.ts
echo '{"tool_name":"Bash","tool_input":{"command":"git push origin main"}}' | bun .claude/hooks/gate.ts
echo '{"tool_name":"Write","tool_input":{"file_path":"src/auth/login.ts"}}' | bun .claude/hooks/gate.ts
```
The first two must emit `permissionDecision: "deny"` (escape commands). The third must emit
`permissionDecision: "allow"` with a review note (security code is built and tested overnight, not
blocked). If not, do not run unattended; verify the hook schema against your Claude Code version first.

## When it halts
- **done**: the full harness passed. The MVP is built and tested, ready for you to review.
- **blocked**: every remaining milestone is shelved (no test ground truth). The buildable work is
  finished; the digest and progress.md Blocked list the few items that need your call.
- **budget**: `NIGHT_LOOP_MAX_STEPS` was hit (runaway guard). Inspect, raise the cap, re-arm.

It never halts for a single gate. Security-surface milestones (auth/billing) are built and tested
against test credentials overnight and listed in `REVIEW` for your morning security pass.

## Honest caveats (read before a multi-day run)

1. **Billing.** Interactive Max stays flat but is not infinite: you will hit the 5-hour rolling
   window and weekly caps. The loop pauses and the supervisor resumes after reset. That pause is
   accepted by design: decision 001 (`.night-loop/decisions/`) rules out headless `claude -p`,
   the Agent SDK, and API keys, because they bill metered. On flat limits the worst case is a
   pause, never a bill.
2. **Rate-limit at the prompt is the rough edge.** If a turn errors on a rate limit, the
   interactive session may sit idle rather than exit. The supervisor catches this with a stall
   detector (no STEP progress for ~20 min -> relaunch with backoff), but it is less crisp than
   headless exit codes. This is the price of staying on flat interactive billing.
3. **Context + a system loop-guard.** One session cannot run forever; Claude Code also guards
   against runaway Stop loops. Periodic `/compact` and the fresh-session-on-resume design handle
   this, but expect restarts on long builds.
4. **The jail is the real safety, not the hook.** The PreToolUse gate is a tripwire. Run in the
   container, deny egress by default with an allowlist (api.anthropic.com, api.tavily.com,
   api.perplexity.ai), and rely on git as the recovery net. Hook + sandbox + git is the stack.
5. **Verify install/schema against current docs.** The Dockerfile install lines and the hook
   block schema can move; confirm before an unattended run.
