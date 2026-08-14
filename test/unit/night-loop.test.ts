import { describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  compileGoal,
  generatedSettings,
  normalizeCommand,
  parseBackgroundSessionId,
  parseWorkers,
  permissionMode,
  repoContext,
  superviseNightLoop,
  writeContract,
  type NightContract,
} from "../../src/night-loop";
import { atomicWriteFile, atomicWriteJson, readJsonFile, withFixtureRepo } from "../../src/core";

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
      const full = generatedSettings({ ...contract, permissions: "full" });
      const fullPermissions = full.permissions as { defaultMode: string; deny: string[] };
      expect(fullPermissions.defaultMode).toBe("bypassPermissions");
      expect(fullPermissions.deny).toEqual(expect.arrayContaining(["Skill(batch)", "Skill(autofix-pr)", "Agent"]));
    });
  });

  test("caps workers and parses native background session ids", () => {
    expect(parseWorkers("auto")).toBe("auto");
    expect(parseWorkers("16")).toBe(16);
    expect(() => parseWorkers("17")).toThrow("1 to 16");
    expect(parseBackgroundSessionId("Session: 123e4567-e89b-12d3-a456-426614174000")).toBe("123e4567-e89b-12d3-a456-426614174000");
  });

  test("a stop during the recovery backoff cancels the relaunch", async () => {
    await withFixtureRepo("backoff stop", async (root) => {
      const script = join(root, "fake claude.ts");
      const log = join(root, "claude calls.jsonl");
      atomicWriteFile(script, [
        "import { appendFileSync } from 'node:fs';",
        "appendFileSync(process.env.FAKE_CLAUDE_LOG!, JSON.stringify({ args: Bun.argv.slice(2) }) + '\\n');",
        "if (Bun.argv.includes('agents')) console.log('[]');",
        "else console.log('ok');",
        "",
      ].join("\n"));
      const seededEnv: Record<string, string> = {
        NIGHT_LOOP_CLAUDE_BIN: process.execPath,
        NIGHT_LOOP_CLAUDE_SHIM: script,
        FAKE_CLAUDE_LOG: log,
        NIGHT_LOOP_TEST_BACKOFF_MS: "0",
      };
      const previous: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(seededEnv)) {
        previous[key] = process.env[key];
        process.env[key] = value;
      }
      try {
        const context = repoContext(root, { now: "2026-08-13T20:00:00.000Z" });
        writeContract(context, { goal: "Backoff guard" });
        const state = join(root, ".night-loop", "state");
        atomicWriteJson(join(state, "run.json"), {
          schemaVersion: 1,
          runId: "seeded-run",
          sessionName: "night-loop",
          nativeSessionId: "123e4567-e89b-12d3-a456-426614174000",
          status: "running",
          permissions: "workspace",
          limits: { maxSteps: 2000, maxRelaunches: 20, workers: 1 },
          startedAt: "2026-08-13T20:00:00.000Z",
          updatedAt: "2026-08-13T20:00:00.000Z",
        });
        atomicWriteFile(join(state, "ACTIVE"), "seeded-run\n");
        atomicWriteFile(join(state, "STEP"), "0\n");
        await superviseNightLoop(context, {
          once: true,
          delay: async () => {
            rmSync(join(state, "ACTIVE"), { force: true });
          },
        });
        expect(existsSync(join(state, "ACTIVE"))).toBe(false);
        const calls = (await Bun.file(log).text()).trim().split(/\r?\n/).map((line) => JSON.parse(line) as { args: string[] });
        expect(calls.some((call) => call.args[0] === "--resume")).toBe(false);
        const events = await Bun.file(join(state, "events.jsonl")).text();
        expect(events).toContain("supervisor.recovery_cancelled");
      } finally {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    });
  });

  test("rejects credential-bearing goals before they can reach process arguments", async () => {
    await withFixtureRepo("secret goal", (root) => {
      expect(() => writeContract(repoContext(root), { goal: "api_key=real-secret" })).toThrow("credential");
    });
  });
});
