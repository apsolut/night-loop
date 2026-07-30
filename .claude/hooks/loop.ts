#!/usr/bin/env bun
// Stop hook = the NIGHT LOOP outer loop. Fires every time Claude tries to end a turn.
// It is the INDEPENDENT verifier: Claude never declares itself done; this does, by
// running the harness. Forces continuation until the build proves done or a gate halts.
import {
  isActive, hasMarker, writeHalt, disarm, bumpStep, maxSteps,
  runRatchet, runFullHarness, removeMarker, blockStop, allowStop,
} from "./lib";

await Bun.stdin.text(); // drain the Stop payload (unused)

// 1. Not armed -> behave like a normal interactive session. Never hijack a manual `claude`.
if (!isActive()) allowStop();

// 2. Only halt when there is nothing buildable left. A single gated/blocked milestone does
//    NOT stop the night; the agent shelves it and keeps going (see step 6).
if (hasMarker("ALL_BLOCKED")) { writeHalt("blocked"); disarm(); allowStop(); }

// 3. Runaway guard.
const step = bumpStep();
if (step > maxSteps()) { writeHalt("budget"); disarm(); allowStop(); }

// 4. Done-claim verification (judge-first: the maker's claim is checked, not trusted).
if (hasMarker("CLAIM_DONE")) {
  const full = runFullHarness();
  if (full.allGreen) { writeHalt("done"); disarm(); allowStop(); } // real DONE -> MVP ready
  removeMarker("CLAIM_DONE");
  blockStop(
    `Done claim REJECTED by the independent check. Full harness is RED: ${full.failing}. ` +
    `Keep working, fix it, and do not recreate CLAIM_DONE until the whole harness is green.`
  );
}

// 5. Regression guard: a red hard tier blocks all new work.
const ratchet = runRatchet();
if (!ratchet.allGreen) {
  blockStop(
    `Ratchet is RED: ${ratchet.failing}. Fix this before starting any new milestone. ` +
    `Never weaken or delete a test to go green; a reproducible red means revert.`
  );
}

// 6. Green and not done -> advance. Never wait for a human; shelve what you cannot build.
blockStop(
  `Ratchet green (step ${step}/${maxSteps()}). Keep building, do not wait for a human. Pick the next ` +
  `buildable milestone in .night-loop/backlog.yaml (dependencies first, M0 first), write the smallest diff, ` +
  `invoke the judge to certify it against seeded data, update .night-loop/progress.md, add a one-line decision. ` +
  `Build gated:true milestones (auth, billing) too, but ONLY against TEST credentials and seeded data, never ` +
  `real systems, and note the security surface in the digest for morning review. SHELVE any milestone you ` +
  `cannot build or test without real ground truth (gated: hard-block, e.g. real data ingestion): record it ` +
  `under Blocked in .night-loop/progress.md and move to the next. When every non-gated milestone is accepted and ` +
  `the full harness will pass, create .night-loop/state/CLAIM_DONE and stop. If the ONLY work left is ` +
  `blocked or unbuildable, create .night-loop/state/ALL_BLOCKED and stop.`
);
