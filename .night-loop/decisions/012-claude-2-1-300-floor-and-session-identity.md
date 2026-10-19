# 012 - Claude floor 2.1.300, session identity from agents JSON, hardened generated env

Date: 2026-10-19
Milestone: M10

## Decision
- The doctor floor rises from 2.1.139 to 2.1.300 (fail-closed PreToolUse on Windows, hook
  `onFailure`, bounded retries, `--bg` trust check, resume-delivers-prompt).
- `claude --bg` prints only a short id. After launch the supervisor resolves the full
  `sessionId` from `claude agents --json` and stores both; `--resume` uses the UUID, `stop`
  and `logs` use the short id or the session name.
- `status` reads `state` for lifecycle and `status` plus `waitingFor` for input-waiting, and a
  waiting native session is recorded as `interaction_required` evidence.
- Generated settings carry `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` and
  `CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1`; setup accepts `--model` and `--effort`.
- `claude logs` output, redacted, is attached to status and the morning receipt.

## Attended follow-ups (control-plane files, owner applies outside an armed session)
1. `hooks/hooks.json`: add `"onFailure": "block"` to the PreToolUse handler and an explicit
   `"timeout": 1800` on the Stop handler so a slow full harness does not fail open.
2. `.night-loop/hooks/gate.ts`: deny instead of allow when the payload is unparseable.
3. `.night-loop/hooks/gate.ts`: read the worker cap from `NIGHT_LOOP_WORKERS` (which the
   generated Claude settings and the turn supervisor both export from the armed contract)
   before falling back to `state/contract.json`. Today a `setup --workers 8` typed after a
   stop loosens the in-turn cap of a resumed Claude or Grok run (M8 judge, 2026-10-20).
   Codex is already held natively through `features.multi_agent` and
   `agents.max_concurrent_threads_per_session`; Grok at `--workers 1` through
   `--no-subagents`.
The project `.claude/settings.json` already carries changes 1 and 2 for dogfooding.

## Rejected
- `claude plugin eval` in the unattended loop (billing of its child `-p` sessions is
  undocumented; decision 001).
- `/goal` check-ins as the completion signal (transcript-only, cannot run the harness).
