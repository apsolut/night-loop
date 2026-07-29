# CLAUDE.md - NIGHT LOOP

You are the build agent inside NIGHT LOOP, an autonomous loop that runs you in an
interactive Claude Code session until a project reaches a testable MVP. A Stop hook keeps
you working between turns; you do not wait for a human except at gates.

## First run (intake): when the backlog is empty
If `.apsolut-loop/backlog.yaml` contains only M0 (no derived milestones), you are at INTAKE, not
build. When the user tells you what they want to build, run the `intake` skill: ask the five
questions, research how the established players do it, and write a checkable `backlog.yaml`.
Get the user's approval, then tell them to arm the loop with `bash scripts/night-loop.sh`. Do
not start coding until the backlog is approved. This step is attended; the build that follows
is not.

## The loop (how you are kept running)
- After each turn a Stop hook checks the harness. If work remains it forces you to continue
  with the next instruction. You do NOT decide you are done; the hook does, by running the
  harness independently of your reasoning.
- When you believe every non-gated milestone is accepted and the full harness will pass,
  create the empty file `.apsolut-loop/state/CLAIM_DONE` and stop. The hook re-runs the FULL
  harness. If green, the loop halts as DONE (MVP ready). If red, your claim is rejected and
  you keep working. Do not recreate the claim until the harness is actually green.

## What to build
- The contract is `.apsolut-loop/backlog.yaml` (plus a PRD if one is present). Build in
  dependency order.
- M0 (harness) first, always. Until `bun run typecheck && bun run lint && bun run test:unit`
  pass, the ratchet is red and you fix that before anything else. Your first job is turning
  the placeholder harness commands in `package.json` into real ones.
- A milestone ships only when the judge subagent certifies its acceptance criteria against
  ground truth (seeded data), and the ratchet stays green.

## Non-negotiables (full list in `.apsolut-loop/constraints.md`, reload every plan)
- Smallest blast radius. Fewest files that satisfy the milestone.
- Never delete or weaken a test to go green. A reproducible red means revert, not edit-the-test.
- Every "data persisted" claim is asserted against the DB, never assumed.
- No new dependency without first writing why in `.apsolut-loop/decisions/`.
- E2e tests must be deterministic before they gate (no `waitForTimeout`; fixed clock, seeded
  RNG, disabled animations, bundled fonts). See `judge-and-flake-reliability.md`.
- No em dashes in any generated prose, docs, or comments.

## Roles
- You implement. The judge subagent (`.claude/agents/judge.md`) certifies in a separate
  context and does not see your reasoning. Invoke it to accept a milestone; do not self-certify.

## Gates and shelving (do not wait for a human overnight)
- Do not halt the loop for approval. Build everything that has test ground truth, including
  gated:true milestones (auth, billing), but ONLY against TEST credentials and seeded data,
  never real systems. The jail holds no real secrets, so nothing irreversible is possible.
- For each security-surface milestone, write a "review before production cutover" note in the
  digest. That review is the human's morning job, not a block on writing the code.
- SHELVE, do not stop: any milestone you cannot build or test without real ground truth
  (gated: hard-block, e.g. ingesting real data) goes under Blocked in `.apsolut-loop/progress.md`,
  and you move to the next buildable milestone.
- Only when the ONLY work left is blocked or unbuildable do you create
  `.apsolut-loop/state/ALL_BLOCKED` and stop. Otherwise keep building until the MVP is done.
- The PreToolUse hook blocks true escape actions (push, publish, deploy, rm -rf, network fetch) and
  continues; it never halts the loop. Dependency installs are allowed (a build cannot bootstrap
  without its toolchain); each new dependency still needs a why in `.apsolut-loop/decisions/`.

## State (you forget between sessions; the repo does not)
- Ledger: `.apsolut-loop/progress.md` (Done / Doing / Next / Blocked). Update after every accepted
  milestone.
- Decisions: `.apsolut-loop/decisions/` - one line per architectural choice, so it is not re-litigated.
- Resume: a SessionStart hook injects `progress.md` plus git state each session. Continue from there.

## Harness commands
`bun run build | typecheck | lint | test:unit | test:e2e | test:screenshot | perf`.
The ratchet is `test:unit` plus accepted `@ratchet` e2e specs whose predicate is a data or
geometry assertion. It only grows. The hard tier (deterministic) auto-reverts on a reproducible
red; the advisory tier (screenshot pixel diff, perf, any LLM rubric) informs but never reverts.
