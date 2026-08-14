# 005: The worker cap in gate.ts must exempt the night-loop-judge (attended edit required)

Date: 2026-08-14. Status: APPLIED 2026-08-14 by the owner (attended cp into
.night-loop/hooks/gate.ts). Follow-ups 2 and 3 landed in the same change: an e2e
case proves the judge is allowed and a generic Agent call denied at workers=1, and
generatedSettings no longer emits the bare Agent deny (the gate enforces the cap).

## Defect

`.night-loop/hooks/gate.ts` denies every Agent tool call when the contract's worker
limit is 1 (the default) or the cap is saturated. The independent night-loop-judge is
invoked through the Agent tool, so under the default contract no milestone can ever be
certified: the loop's own acceptance protocol (CLAUDE.md: "invoke the judge subagent,
do not self-certify") is unreachable. M2's acceptance criteria state the judge "remains
verification infrastructure rather than a second implementation lane", which requires
it to stay invocable independent of the implementer worker cap.

## Required change (one hunk, in the Agent/Workflow branch of gate.ts)

Before reading the contract worker cap:

```ts
// The independent judge is verification infrastructure, never an implementation
// worker: it must stay invocable even when the worker cap disables implementer
// subagents, or no milestone could ever be certified under workers=1.
const subagentType = String(ti.subagent_type ?? "");
if (tool === "Agent" && /night-loop-judge/.test(subagentType)) {
  appendEvent("judge.invoked", { subagentType });
  process.exit(0);
}
```

## Why this session did not apply it

The PreToolUse gate marks `.night-loop/hooks/` immutable, and hook configuration is
captured at session start, so the running build agent cannot edit its own control
plane. That containment is correct and was not evaded. The build session worked around
it for certification only by recording a dev contract with `workers: 2`
(`night-loop setup --workers 2`), which raises the cap without touching the hook.

## Follow-up for the attended morning review

1. Apply the hunk above to `.night-loop/hooks/gate.ts` in a session where the gate is
   not armed (or edit it outside Claude).
2. Add an e2e case to the gate matrix asserting an Agent call with
   `subagent_type: "night-loop-judge"` is allowed at workers=1 while a generic Agent
   call stays denied.
3. Consider whether `generatedSettings` should keep denying the bare `Agent` tool at
   workers=1, since that settings-level deny also blocks the judge inside a real
   jailed run and the gate exemption cannot help if the settings deny fires first.
