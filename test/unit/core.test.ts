import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  atomicWriteFile,
  isInteractionRequest,
  runAgentCommand,
  runCommand,
  toRepoRelativePath,
  withFixtureRepo,
} from "../../src/core";

const observedFixtureParents: string[] = [];

afterEach(() => {
  while (observedFixtureParents.length > 0) {
    const parent = observedFixtureParents.pop();
    if (parent) expect(existsSync(parent)).toBe(false);
  }
});

describe("cross-platform primitives", () => {
  test("normalizes a repository path containing spaces and Unicode", async () => {
    await withFixtureRepo("path", (root) => {
      observedFixtureParents.push(dirname(root));
      const nested = join(root, "folder space", "żółć.txt");
      mkdirSync(dirname(nested), { recursive: true });
      expect(toRepoRelativePath(root, nested)).toBe("folder space/żółć.txt");
      expect(() => toRepoRelativePath(root, join(root, "..", "outside.txt"))).toThrow("escapes repository");
    });
  });

  test("atomically replaces state and leaves no temporary file", async () => {
    await withFixtureRepo("atomic", (root) => {
      observedFixtureParents.push(dirname(root));
      const state = join(root, ".night-loop", "state.json");
      atomicWriteFile(state, "first\n");
      atomicWriteFile(state, "second\n");
      expect(readFileSync(state, "utf8")).toBe("second\n");
      expect(readdirSync(dirname(state))).toEqual(["state.json"]);
    });
  });

  test("preserves command arguments without shell evaluation", async () => {
    await withFixtureRepo("arguments", async (root) => {
      observedFixtureParents.push(dirname(root));
      const script = join(root, "fake provider.ts");
      atomicWriteFile(script, "console.log(JSON.stringify(Bun.argv.slice(2)));\n");
      const args = ["space value", "quote'\"value", "żółć", "$(not-run)", "semi;colon"];
      const result = await runCommand([process.execPath, script, ...args], { cwd: root });
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(args);
      expect(result.command).toEqual([process.execPath, script, ...args]);
    });
  });

  test("cleans a fixture repository even when its callback fails", async () => {
    let parent = "";
    await expect(withFixtureRepo("cleanup", (root) => {
      parent = dirname(root);
      throw new Error("seeded failure");
    })).rejects.toThrow("seeded failure");
    expect(existsSync(parent)).toBe(false);
  });
});

describe("interaction sentinel", () => {
  test.each([
    "Yes, approve",
    "Allow editing",
    "Please confirm this action",
    "May I have permission to run the command?",
    "Do you want me to continue?",
    "I need your input before proceeding",
    "Could you clarify the target?",
    "Can I edit the file?",
    "May I run the command?",
    "What target should I use?",
    "Reply yes so I can continue",
    "I am waiting for user input",
  ])("rejects seeded agent question: %s", (output) => {
    expect(isInteractionRequest(output)).toBe(true);
  });

  test("does not reject an ordinary completed response", () => {
    expect(isInteractionRequest("Completed the task. All checks pass.")).toBe(false);
  });

  test("classifies a fake provider request and closes stdin", async () => {
    await withFixtureRepo("provider", async (root) => {
      observedFixtureParents.push(dirname(root));
      const script = join(root, "fake agent.ts");
      atomicWriteFile(script, "const input = await Bun.stdin.text(); console.log(input.length === 0 ? 'Allow editing' : 'stdin open');\n");
      const result = await runAgentCommand([process.execPath, script], root);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("Allow editing");
      expect(result.status).toBe("interaction_required");
    });
  });
});
