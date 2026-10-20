# 015 - Stuck detection, think turns, read-only consult, and the lessons file

Date: 2026-10-20
Milestone: M11

## Decision
The supervisor gains a deterministic stuck detector (same red ratchet line, same denied
category, or unchanged tree for three turns). A stuck run gets a bounded think turn: the
implementer is relaunched read-only with the evidence and asked for a root cause, three
alternatives, and one chosen plan. With `setup --consult codex|grok`, a read-only turn of that
other provider runs first and its opinion is quoted in the think prompt. Every recovery,
stuck verdict, and think outcome appends one line to `.night-loop/lessons.md`, which resume
and think prompts carry. Two think turns on the same fingerprint are the limit; the third
episode shelves the path under Blocked in `progress.md` and the night continues.

## Why
The loop already shelves and continues, but it cannot tell circling from progress, and it
carries nothing from one night to the next except what the agent happens to write. The
owner asked for exactly this on 2026-10-20. Jev (a metered decision classifier) was
considered for the fuzzy half of the detector and deferred behind a decision 001 amendment.

## Boundary
The consultant never edits and never owns the session: Codex runs with `--sandbox read-only`
and `--ephemeral`, Grok with `dontAsk` and allow rules for Read, Grep, and Glob only. That is
verification-side infrastructure, like the judge (decision 003 unchanged). Claude cannot be the
consultant because `claude -p` is excluded by decision 001.

## Rejected
- A model-driven stuck detector: deterministic signals first; Jev later, behind decision 001.
- Letting the think turn edit code: a think turn that edits is just another build turn.
- Unbounded think turns: the step cap already bounds the night, but circling inside a think
  loop would burn it; two per fingerprint, then shelve.
