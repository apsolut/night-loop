import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { LedgerEvent } from "../../src/core";
import { withFixtureRepo } from "../../src/core";
import {
  appendLesson,
  compileConsultPrompt,
  compileThinkPrompt,
  detectStuck,
  extractPlan,
  lessonsPreface,
  readLessons,
} from "../../src/reflect";

let sequence = 0;
function event(type: string, data: Record<string, unknown> = {}): LedgerEvent {
  sequence += 1;
  return { id: `t:${sequence}`, timestamp: "2026-10-20T00:00:00.000Z", type, previousHash: "", hash: "", data };
}

const red = (line: string) => event("stop.continued", { reason: `Ratchet is RED: ${line}. Fix this before starting any new milestone.` });
const green = () => event("stop.continued", { reason: "Ratchet green (step 3/2000). Keep building, do not wait for a human." });

describe("stuck detector", () => {
  test("three identical red verdicts are stuck; two, or three different ones, are not", () => {
    const same = [red("bun run test:unit -> 1 fail"), red("bun run test:unit -> 1 fail"), red("bun run test:unit -> 1 fail")];
    expect(detectStuck(same)).toMatchObject({ stuck: true, reason: "repeated_red", fingerprint: "red:bun run test:unit -> 1 fail" });
    expect(detectStuck(same.slice(1)).stuck).toBe(false);
    expect(detectStuck([red("a -> 1"), red("b -> 2"), red("c -> 3")]).stuck).toBe(false);
    expect(detectStuck([red("a -> 1"), green(), red("a -> 1"), red("a -> 1")]).stuck).toBe(false);
  });

  test("the same denied category in three consecutive provider turns is stuck", () => {
    const events: LedgerEvent[] = [];
    for (let turn = 0; turn < 3; turn += 1) {
      events.push(event("turn.started", { turn }));
      events.push(event("policy.blocked", { tool: "Bash", category: "external_or_irreversible_action" }));
      events.push(green());
    }
    expect(detectStuck(events)).toMatchObject({ stuck: true, reason: "repeated_block", fingerprint: "block:external_or_irreversible_action:Bash" });
    const mixed = [...events.slice(0, 6), event("turn.started", { turn: 2 }), green()];
    expect(detectStuck(mixed).stuck).toBe(false);
    // Three blocked turns with three different categories are three different problems, not a loop.
    const differing: LedgerEvent[] = [];
    for (const category of ["external_or_irreversible_action", "control_plane_write", "worker_cap"]) {
      differing.push(event("turn.started", {}));
      differing.push(event("policy.blocked", { tool: "Bash", category }));
      differing.push(green());
    }
    expect(detectStuck(differing).stuck).toBe(false);
    const twoOfThree = [...differing.slice(3, 6), ...events.slice(0, 6)];
    expect(detectStuck(twoOfThree).stuck).toBe(false);
  });

  test("an unchanged working tree for the whole window is stuck, and a think turn resets the episode", () => {
    expect(detectStuck([green(), green(), green()], 3, ["abc", "abc", "abc"])).toMatchObject({ stuck: true, reason: "no_progress" });
    expect(detectStuck([green()], 3, ["abc", "abc", "def"]).stuck).toBe(false);
    const afterThink = [red("x -> 1"), red("x -> 1"), red("x -> 1"), event("think.completed", {}), red("x -> 1")];
    expect(detectStuck(afterThink).stuck).toBe(false);
    const shelved = [red("x -> 1"), red("x -> 1"), event("stuck.shelved", {}), red("x -> 1"), red("x -> 1"), red("x -> 1")];
    expect(detectStuck(shelved).stuck).toBe(true);
  });

  test("plans are extracted from the last PLAN or SHELVE line", () => {
    expect(extractPlan("ROOT CAUSE: a\nALTERNATIVES: b\nPLAN: seed pass.ts first")).toBe("PLAN: seed pass.ts first");
    expect(extractPlan("nothing here")).toBeUndefined();
    expect(extractPlan("PLAN: first\nSHELVE M3: needs real data")).toBe("SHELVE M3: needs real data");
  });

  test("prompts carry evidence, lessons, and the consultant's opinion", () => {
    const verdict = { stuck: true, reason: "repeated_red" as const, fingerprint: "red:x", evidence: ["bun run test:unit -> 1 fail"] };
    const think = compileThinkPrompt(verdict, ["- 2026 lesson one"], { provider: "grok", text: "PLAN: do y" });
    expect(think).toContain("THINK TURN");
    expect(think).toContain("bun run test:unit -> 1 fail");
    expect(think).toContain("lesson one");
    expect(think).toContain("read-only grok consultant");
    expect(think).toContain("PLAN: do y");
    const consult = compileConsultPrompt(verdict, []);
    expect(consult).toContain("read-only consultant");
    expect(consult).toContain("cannot edit");
  });

  test("lessons append one line each and are read back newest-last", async () => {
    await withFixtureRepo("lessons", (root) => {
      expect(readLessons(root)).toEqual([]);
      expect(lessonsPreface(root)).toBe("");
      appendLesson(root, "recovery(stalled) relaunch 1", "2026-10-20T01:00:00.000Z");
      appendLesson(root, "think(repeated_red): PLAN: try\nthe other\tway", "2026-10-20T02:00:00.000Z");
      const lessons = readLessons(root);
      expect(lessons.length).toBe(2);
      expect(lessons[1]).toBe("- 2026-10-20T02:00:00.000Z think(repeated_red): PLAN: try the other way");
      expect(lessonsPreface(root)).toContain("Lessons recorded so far:");
      expect(Bun.file(join(root, ".night-loop", "lessons.md")).size).toBeGreaterThan(0);
    });
  });
});
