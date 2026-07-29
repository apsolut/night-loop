# PRD: Analytics Dashboard, Autonomous Build

> **NIGHT LOOP reconciliation (2026-06).** This analytics dashboard is one *example target* NIGHT LOOP builds; the generic intake-to-spec flow is `idea-to-product-pipeline.md`, and the runtime is `NIGHT-LOOP.md`. Read every `/goal` reference below as the supervisor plus the Stop hook (`.claude/hooks/loop.ts`): there is no built-in `/goal` loop. The stop condition in Section 3 is enforced by the Stop hook running the harness, not by a built-in. Billing reality: only Claude Code *interactive* uses the flat Max limits; headless and SDK usage is metered. Where this doc and the real files differ, the files win.

This document is the contract you (Claude Code) build against and the only definition of "done" that counts. Read it fully before starting and reload the Constraints section at the start of every plan. You are running unattended overnight. A human reviews the digest each morning. The Gates below are where you stop and wait for that human.

## 0. How to run this

- This PRD lives at `.apsolut-loop/PRD.md`. `CLAUDE.md` points here and is the entry point.
- The loop runs under the NIGHT LOOP supervisor (`scripts/night-loop.sh`) plus a Stop hook (`.claude/hooks/loop.ts`) that enforces the stop condition in Section 3. There is no built-in `/goal`. The Stop hook runs the harness independently of the agent that wrote the code, so the writer is not the one that decides it is done.
- Gates (Section 7) are enforced by a `PreToolUse` hook that blocks edits to sensitive paths and sensitive commands. When the hook fires, write the request into the digest and stop.
- Implementation and verification are different subagents (`.claude/agents/implementer`, `.claude/agents/judge`). The judge sees the spec, the artifact, and the harness output. It does not see the implementer's reasoning.
- State lives in git plus `.apsolut-loop/progress.md` plus `.apsolut-loop/decisions/`. You forget between runs; the repo does not. Resume from the last commit and `progress.md`.
- Running on Claude Code Max, so the budget is generous. That is not a license to thrash. The stuck protocol (Section 10) is what protects the budget, not frugality.

## 1. Product

A self-hosted analytics dashboard for tracking domains, pages, and tracked items, with charts over stored time-series data. Auth and billing wrap it. Data ingestion is explicitly out of autonomous scope until a source is decided (Section 9). Build the buildable core to completion; stop at the seams where a human has to own the decision.

## 2. Stack and conventions, pinned

Pin every version. Do not introduce alternatives. An unstated choice is a hole you will fill with a guess, so it is stated here.

- Runtime: Bun (pinned in `package.json`)
- Language: TypeScript, strict mode on
- DB: libSQL / Turso, accessed via `@libsql/client`
- Frontend: [fill: e.g. React + Vite] with [fill: charting lib]
- Tests: vitest (unit), Playwright (render, DOM, screenshot)
- Auth: better-auth
- Billing: Stripe
- State and knowledge: markdown in `.apsolut-loop/`, git for code

If a required convention is not written here, stop and add it to `constraints.md` with a one-line rationale, then continue. Do not guess silently.

## 3. Definition of done (the Stop-hook stop condition)

The build is done when ALL of these hold, verifiably:

1. Every non-gated milestone in Section 6 has its acceptance criteria passing.
2. The ratchet is 100 percent green (Section 5).
3. Every gated milestone is either human-approved-and-passing or explicitly deferred in `progress.md`.

Encode this in the Stop hook (`.claude/hooks/loop.ts`) as the stop condition. "Done" is a claim until these three are checkable green. Do not declare done on anything weaker.

## 4. The harness, build this first

The harness is how "done" means something. The loop can only verify what the harness can see, so a weak harness produces a dashboard that is confidently wrong. Build M0 before any feature. These run cheapest-first; stop at the first failure and diagnose.

1. `bun run build` and `tsc --noEmit`, zero type errors. (deterministic, HARD tier)
2. `bun run lint`, clean. (deterministic, HARD tier)
3. `bun run test:unit`, all pass. This suite is the core ratchet. (deterministic, HARD tier)
4. Playwright headless render, zero console errors. (noisy: async timing and third-party warnings; ADVISORY)
5. Playwright DOM and data assertions: the value shown equals the value computed from seeded data. (predicate deterministic, HARD tier; the *wait* must be a state wait, never `waitForTimeout`)
6. Playwright screenshot diff against committed baselines. (noisy: anti-aliasing, fonts, sub-pixel; ADVISORY. Prefer deterministic `boundingBox` geometry assertions for anything that must gate)
7. `bun run perf` budget check (bundle size, render timing) for M10. (bundle size deterministic; render timing noisy and ADVISORY)

Objective is not deterministic. Only the deterministic layers (and the data/geometry *predicate* of layer 4) are in the HARD tier that auto-reverts; the noisy layers and the M11 LLM rubric are ADVISORY (they block forward acceptance and surface in the digest, they never revert green work). The spurious-revert rate is `1 - (1-p)^N` in the number of ratchet specs, so the hard tier must stay deterministic as it grows. Full rationale in `judge-and-flake-reliability.md`.

## 5. The ratchet rule

- When a milestone is accepted, its acceptance tests join the ratchet suite permanently, sorted into the HARD tier (deterministic) or the ADVISORY tier (noisy) per Section 4.
- No diff may reduce the green count of the HARD tier. If a change reds a previously-green HARD-tier test, and the red is *reproducible* (fails on retry on the diff AND the unchanged baseline was green), revert the diff. Never accept a reproducible regression.
- A non-reproducible red is flake, not a regression: do not revert, quarantine the spec until it is determinized (see `judge-and-flake-reliability.md`). A failing ADVISORY layer blocks forward acceptance and is surfaced in the digest, but never reverts green work.
- Never delete or weaken a test to make the suite pass. This is a hard rule with no exception. Quarantine is not weakening: the spec still runs and reports, it just cannot gate until it is trustworthy.
- Enforce at commit: a pre-commit step runs the deterministic HARD tier (typecheck, lint, unit), and a commit that reds it is rejected. The noisy layers run at the judge, not on every commit.

This makes progress monotonic. The HARD-tier green count only goes up.

## 6. Milestones (the backlog)

Build in dependency order. Each ships only when its acceptance criteria pass AND the ratchet is still green. Acceptance criteria are behavioral and checked against ground truth, not "implemented."

**M0 Harness** (depends: none, gated: no)
App builds with zero type errors. One smoke test passes. Headless render produces zero console errors. One screenshot baseline committed. Ratchet suite initialized.

**M1 DB and schema** (depends: M0, gated: no)
Migrations create the `domains`, `pages`, `items`, and `metrics` tables. A `seed` script populates known fixture data. Acceptance: seed runs clean, and a query returns the exact fixture rows. Note: schema is open at M1; after M1, migrations are gated (Section 7).

**M2 Tracked domains CRUD** (depends: M1, gated: no)
Adding a domain via the UI persists a row in `domains`. The list view renders all persisted domains. Delete removes it from both the list and the table. All three asserted against the DB, not assumed.

**M3 Pages and items CRUD** (depends: M2, gated: no)
Same pattern as M2 for `pages` and `items`, each asserted against the DB.

**M4 Analytics views** (depends: M3, gated: no)
A chart renders a time-series computed from seeded `metrics`. The displayed aggregate equals the aggregate computed directly from the seed. Acceptance is the number on screen matching the number from the data, not the chart merely rendering.

**M5 Composition and layout** (depends: M4, gated: no)
Multiple panels in a responsive grid. New screenshot baselines committed for the composed views.

**M6 Edge states** (depends: M4, gated: no)
Loading, empty, and error states for every data view. Each renders without crashing and shows the correct affordance. Asserted via Playwright by forcing each state.

**M7 Auth** (depends: M0, gated: YES)
better-auth. Signup creates a user. Login issues a session. A protected route returns 401 without a session. STOP before starting: this touches the security surface a human must own. Surface the planned approach in the digest, including what you did not auto-test (session fixation, CSRF, cross-tenant access).

**M8 Billing** (depends: M7, gated: YES)
Stripe. Checkout, webhook flips the subscription flag, webhook is idempotent. STOP before starting. Surface the failure paths you did not cover (canceled, failed, disputed, proration) in the digest.

**M9 Ingestion** (depends: M4, gated: HARD BLOCK)
No data source is defined. Do NOT build a pipeline that ingests placeholder or fabricated data and passes "rows inserted" tests, because that is green over a hole. STOP and write the data-source decision into the digest as a blocker. Wait for a human decision before any ingestion work.

**M10 Optimization pass** (depends: all non-gated above, gated: no)
Behavior is frozen by the ratchet. Improve only metrics: bundle size, a11y score, render timing against the perf budget. If behavior changes, the ratchet reds and you revert. Optimization that removes a feature is a failure.

**M11 Landing page** (depends: M0, gated: no, human-judged)
Build to functional and render-clean. The LLM rubric (`.apsolut-loop/rubrics/landing.md`) judges quality. The final taste and conversion call is the human's, not yours. Do not loop on this past the rubric passing; flag it for human review and move on.

## 7. Gates, stop and ask

When you are about to do any of these, do not proceed. Write the request into the digest and stop. The `PreToolUse` hook enforces the path and command set.

- Edit any file matching: `auth`, `billing`, `payment`, `stripe`, `.env`, `migration`, `schema` (after M1)
- Run any command matching: `rm`, `drop`, `git push`, `npm publish`, `curl` or `wget` with side effects (dependency installs are allowed; a build cannot bootstrap without them)
- Any schema migration after M1
- Any external API call that writes or charges
- Milestones M7, M8 (gated) and M9 (hard block)

A gate is not a failure. It is the loop correctly recognizing a decision a human has to make.

## 8. Constraints (durable rules, reload every plan)

These live in `.apsolut-loop/constraints.md` and you reload them at the start of every plan. Your feedback at a checkpoint appends here, so they grow.

- Smallest blast radius. Touch the fewest files that satisfy the milestone.
- No new dependencies without stopping to ask. State why one is needed.
- Every claim that data persisted must be asserted against the DB. Never assume a write succeeded.
- Never delete or weaken a test to go green. Quarantining a flaky spec (out of the hard tier until determinized) is allowed and is not weakening.
- E2e tests must be deterministic before they are allowed to gate: wait on state, never on time (no `waitForTimeout`; use `expect.poll` / `toPass` / element waits), fixed clock, seeded RNG, animations and transitions disabled, fonts bundled with `document.fonts.ready` awaited, fixed viewport, no real network. See `judge-and-flake-reliability.md`.
- Only revert on a reproducible red. A non-reproducible red is flake; quarantine it, do not revert and do not diagnose against it.
- Architecture decisions get a one-line entry in `.apsolut-loop/decisions/` so they are not re-litigated next run.
- No em dashes in any generated prose, docs, or comments.
- [Fill: project-specific naming and structure conventions]

## 9. The one decision that gates the whole thing

Ingestion (M9) has no ground truth and cannot be looped into existence. Before this PRD delivers real value end to end, a human must answer: where does the metrics data come from. Until then, the build delivers a complete, tested shell around seeded data, which is genuine and useful, but is not a populated product. Treat this as the top open question in the first digest.

## 10. Stuck protocol

- If the same failure recurs across 3 attempts (judged by similarity of the failure diagnosis, not just identical error text), stop. Do not keep producing diffs that wiggle the signals without converging.
- On stuck: decompose the milestone into smaller ones and try once more. If that also fails, write it into the digest as blocked and move to the next available milestone.
- Hard caps: max 100 steps between checkpoints, max [fill] wall-clock hours per run. Halt and checkpoint at either.

## 11. Checkpoint protocol and the digest

Checkpoint at whichever comes first: a milestone boundary, 100 steps, a gate, a stuck condition, or a budget threshold.

Write `.apsolut-loop/runs/<run-id>/digest.md` so the morning review takes minutes and forces understanding, not a rubber stamp:

```markdown
# Run <id> - Checkpoint (reason: <milestone boundary | 100 steps | gate | stuck | budget>)

## Shipped since last checkpoint
- <milestone>: <one line on what and how verified>

## Ratchet
- <X>/<Y> green. Reverts this batch: <none | what and why>

## THE READ (do not skip)
The single most important change from this batch you must read to stay current:
- <file:lines> - <why it matters, what decision it encodes>

## Blocked / needs you
- <gated milestone or decision, with the risk surface I could not auto-verify>

## Next
- <the next 1 to 3 milestones if you approve>

## Open questions / risks the harness cannot see
- <e.g. ingestion data source still undecided>
```

The THE READ line is the point of the checkpoint. Status without comprehension lets the human approve code they do not understand, and the gap between what exists and what they understand is the real debt of running this unattended.

## 12. Self-extension (after M0)

Set up a daily automation that runs a triage skill: read the latest test failures, any new issues, and recent regressions, and append actionable findings to this backlog as new milestones with acceptance criteria. This is how the backlog grows from observed reality instead of staying frozen at what was written today. New auto-generated milestones obey every rule above, including gates.
