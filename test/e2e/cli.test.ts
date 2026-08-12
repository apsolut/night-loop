import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { readJsonFile, runCommand, withFixtureRepo } from "../../src/core";

interface FixtureResult {
  status: "success" | "interaction_required";
  repo: string;
  payload: string;
}

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");

describe("deterministic CLI fixture", () => {
  test("writes seeded state without a provider or network", async () => {
    let parent = "";
    await withFixtureRepo("cli", async (root) => {
      parent = dirname(root);
      const payload = "space ' quote \" Unicode żółć ; $(never-run)";
      const result = await runCommand(
        [process.execPath, CLI, "fixture", "--repo", root, "--payload", payload],
        { cwd: root },
      );
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout) as FixtureResult).toEqual({
        status: "success",
        repo: ".",
        payload,
      });
      expect(readJsonFile<FixtureResult>(join(root, ".night-loop", "state", "fixture.json"))).toEqual({
        status: "success",
        repo: ".",
        payload,
      });
    });
    expect(existsSync(parent)).toBe(false);
  });

  test("returns interaction_required instead of waiting for approval", async () => {
    await withFixtureRepo("cli question", async (root) => {
      const result = await runCommand(
        [
          process.execPath,
          CLI,
          "fixture",
          "--repo",
          root,
          "--payload",
          "seed",
          "--agent-output",
          "Yes, approve. Allow editing?",
        ],
        { cwd: root },
      );
      expect(result.exitCode).toBe(42);
      expect((JSON.parse(result.stdout) as FixtureResult).status).toBe("interaction_required");
    });
  });
});
