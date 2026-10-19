# 014 - Resume writes the armed contract back to contract.json

Date: 2026-10-20
Milestones: M8, M9 (applies to every provider)

## Decision
`night-loop resume` compares `state/contract.json` with the profile, limits, model, effort, and
provider recorded on the run. If an attended `setup` typed after a stop changed any of them,
resume restores the armed values to `contract.json` before any provider restarts and appends a
`contract.restored` event carrying both the superseded and the armed values. The goal text is
not restored; it only shapes the first prompt of a fresh start. A changed contract therefore
applies to the next `start`, never to a resume.

## Why
The control-plane gate reads the worker cap from `contract.json` and is owner-attended
(decision 005), so a raised cap on disk loosened the in-turn cap of a resumed Grok run at two
or more workers (M8 judge, 2026-10-20). The run state already preserved the armed values for
the launch arguments; the file the gate reads has to say the same thing.

## Rejected
- Having the bridge decide the cap itself (decision 011: it translates, it never decides).
- Refusing `setup` while a stopped run exists: setup is the attended command and must stay
  usable for the next night.
- Waiting for the attended `gate.ts` change in decision 012: still worthwhile, but a criterion
  cannot rest on a file the build agent is not allowed to touch.
