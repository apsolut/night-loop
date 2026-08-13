import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  compileGoal,
  generatedSettings,
  normalizeCommand,
  parseBackgroundSessionId,
  parseWorkers,
  permissionMode,
  repoContext,
  writeContract,
  type NightContract,
} from "../../src/night-loop";
import { readJsonFile, withFixtureRepo } from "../../src/core";

describe("Night Contract", () => {
  test("full is an exact parser alias for start with full permissions", () => {
    expect(normalizeCommand("full", ["--repo", "a b"])).toEqual({
      command: "start",
      args: ["--permissions", "full", "--repo", "a b"],
    });
    expect(permissionMode("workspace")).toBe("dontAsk");
    expect(permissionMode("full")).toBe("bypassPermissions");
  });

  test("records the attended contract and compiles a zero-question goal", async () => {
    await withFixtureRepo("contract", (root) => {
      const context = repoContext(root, { now: "2026-08-13T20:00:00.000Z" });
      const contract = writeContract(context, {
        goal: "Build the thing",
        permissions: "workspace",
        maxSteps: 77,
        maxRelaunches: 3,
        workers: 1,
      });
      expect(readJsonFile<NightContract>(join(root, ".night-loop", "state", "contract.json"))).toEqual(contract);
      expect(compileGoal(contract)).toContain("/goal Build the thing");
      expect(compileGoal(contract)).toContain("Do not ask the owner questions");
      expect(generatedSettings(contract)).toMatchObject({ permissions: { defaultMode: "dontAsk" } });
    });
  });

  test("caps workers and parses native background session ids", () => {
    expect(parseWorkers("auto")).toBe("auto");
    expect(parseWorkers("16")).toBe(16);
    expect(() => parseWorkers("17")).toThrow("1 to 16");
    expect(parseBackgroundSessionId("Session: 123e4567-e89b-12d3-a456-426614174000")).toBe("123e4567-e89b-12d3-a456-426614174000");
  });

  test("rejects credential-bearing goals before they can reach process arguments", async () => {
    await withFixtureRepo("secret goal", (root) => {
      expect(() => writeContract(repoContext(root), { goal: "api_key=real-secret" })).toThrow("credential");
    });
  });
});
