# Constraints

Reload at the start of every plan. Human feedback at checkpoints appends here, dated.

- Smallest blast radius. Fewest files that satisfy the milestone.
- No new dependencies without writing why in `.night-loop/decisions/` first.
- Every "data persisted" claim is asserted against the DB. Never assume a write succeeded.
- Never delete or weaken a test to go green. Quarantining a flaky spec (out of the hard tier
  until determinized) is allowed and is not weakening.
- Only revert on a reproducible red. A non-reproducible red is flake: quarantine it, do not
  revert and do not diagnose against it.
- E2e tests must be deterministic before they gate: wait on state not time (no `waitForTimeout`;
  use `expect.poll` / `toPass` / element waits), fixed clock, seeded RNG, animations disabled,
  fonts bundled with `document.fonts.ready` awaited, fixed viewport, no real network.
- Security surfaces are built and tested only against seeded data and test credentials, then logged
  for review before production cutover. Missing real credentials or ground truth shelves the affected
  milestone and the loop continues. No execution-time approval prompt is allowed.
- Architectural choices get a one-line entry in `.night-loop/decisions/`.
- No em dashes in any generated prose, docs, or comments.

## Project conventions (fill before first run)
- Runtime: Bun 1.3.x and TypeScript; this is a CLI and repository-tooling project with no frontend or charting layer.
- Canonical cross-platform logic: one Bun and TypeScript core. PowerShell and POSIX files may only be thin launchers.
- Operating systems: native Windows without WSL is required; Linux and macOS must use the same core behavior.
- Product boundary: NIGHT LOOP runs one Claude Code CLI implementer session. Local contributor tools, including `.apsolut-agents/`, are not product dependencies and never enter setup, runtime, packaging, or public documentation.
- Claude boundary: construct Claude commands as argument arrays and never concatenate a shell string.
- Zero interaction after arming: treat any request for clarification, approval, edit permission, confirmation, or user input as a failed Claude turn that cannot pause the supervisor.
- Command model: `night-loop setup` is the only attended command. `night-loop start` defaults to workspace permission, and `night-loop full` is a parser-level exact alias for `night-loop start --permissions full` with no confirmation and no separate execution path.
- Permission profiles: `full` changes Claude workspace authority only. Environment scrubbing, process and filesystem containment, command and network policy, test-credential allowlisting, spend caps, and blocks on push, publish, deploy, and production writes remain immutable outside Claude.
- Resume safety: stop preserves resumable state and the selected permission profile. Resume never upgrades permission, limits, or spend caps implicitly.
- Ambiguity policy: use the backlog, constraints, repository evidence, and deterministic defaults for reversible decisions. Emit a structured blocked result and continue when required authority or ground truth is absent.
- Tests: a deterministic fake Claude executable and seeded temporary Git repositories gate behavior. Live Claude calls never substitute for the hard tier.
- Paths and text: use platform path APIs, support spaces and Unicode, and normalize LF and CRLF deliberately.
- Security: no Claude credential or API key in the repository, logs, prompts, process arguments, or test snapshots.

## Appended by human feedback
- 2026-08-13: The main product requirement is that the active Claude implementer never asks execution-time questions such as approval, confirmation, or permission to edit. Any future CLI support must satisfy the same contract before entering product scope.
- 2026-08-13: Use `night-loop full` as the self-explanatory no-confirmation alias for `night-loop start --permissions full`; do not expose `arm` as the primary command.
- 2026-08-13: `.apsolut-agents/` is personal local state and must never be tracked or published to the public repository.
- 2026-08-13: Installing `.apsolut-agents/` in this checkout was solely to help multiple assistants develop NIGHT LOOP. It is not a NIGHT LOOP integration, feature, dependency, or public deliverable.
