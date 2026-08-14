import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFile, readJsonFile, runCommand, withFixtureRepo } from "../../src/core";

const LOOP_HOOK = join(import.meta.dir, "..", "..", ".night-loop", "hooks", "loop.ts");
const RESUME_HOOK = join(import.meta.dir, "..", "..", ".night-loop", "hooks", "resume.ts");

async function invoke(root: string, env: Record<string, string> = {}) {
  const child = Bun.spawn([process.execPath, LOOP_HOOK], {
    cwd: root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, ...env },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  child.stdin.write("{}");
  child.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function seedHarness(root: string, screenshotPass = true): void {
  atomicWriteFile(join(root, "pass.ts"), "process.exit(0);\n");
  atomicWriteFile(join(root, "fail.ts"), "process.exit(1);\n");
  atomicWriteFile(join(root, "package.json"), `${JSON.stringify({
    scripts: {
      "test:screenshot": `bun ${screenshotPass ? "pass.ts" : "fail.ts"}`,
      perf: "bun pass.ts",
    },
  }, null, 2)}\n`);
  atomicWriteFile(join(root, ".night-loop", "ratchet.json"), `${JSON.stringify({
    hard: [{ display: "seed pass", argv: ["bun", "pass.ts"] }],
    acceptedE2e: [],
  }, null, 2)}\n`);
}

describe("durable resume injection", () => {
  async function invokeResume(root: string) {
    const child = Bun.spawn([process.execPath, RESUME_HOOK], {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      stdin: "pipe",
      stdout: "pipe",
    });
    child.stdin.write("{}");
    child.stdin.end();
    return JSON.parse(await new Response(child.stdout).text()) as {
      hookSpecificOutput: { additionalContext: string; initialUserMessage?: string };
    };
  }

  test("a relaunched session receives progress.md and Git state, and auto-resumes only when armed", async () => {
    await withFixtureRepo("resume inject", async (root) => {
      atomicWriteFile(join(root, ".night-loop", "progress.md"), "# Progress\n\n## Doing\n- M3 durable resume Ω\n");
      const git = { cwd: root, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } };
      for (const args of [["init", "-q"], ["add", "-A"], ["commit", "-q", "-m", "seeded backlog item"]]) {
        expect((await runCommand(["git", ...args] as [string, ...string[]], git)).exitCode).toBe(0);
      }
      const unarmed = await invokeResume(root);
      expect(unarmed.hookSpecificOutput.additionalContext).toContain("M3 durable resume Ω");
      expect(unarmed.hookSpecificOutput.additionalContext).toContain("seeded backlog item");
      expect(unarmed.hookSpecificOutput.additionalContext).toContain("Continue from here");
      expect(unarmed.hookSpecificOutput.initialUserMessage).toBeUndefined();
      atomicWriteFile(join(root, ".night-loop", "state", "ACTIVE"), "run\n");
      const armed = await invokeResume(root);
      expect(armed.hookSpecificOutput.initialUserMessage).toContain("Resume NIGHT LOOP");
      expect(armed.hookSpecificOutput.initialUserMessage).toContain("progress.md");
    });
  });
});

describe("shelve and continue", () => {
  const GATE_HOOK = join(import.meta.dir, "..", "..", ".night-loop", "hooks", "gate.ts");

  test("a green ratchet after a denied external action continues the loop and instructs shelving", async () => {
    await withFixtureRepo("continue", async (root) => {
      seedHarness(root);
      atomicWriteFile(join(root, ".night-loop", "state", "ACTIVE"), "run\n");
      const gate = Bun.spawn([process.execPath, GATE_HOOK], {
        cwd: root,
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
        stdin: "pipe",
        stdout: "pipe",
      });
      gate.stdin.write(JSON.stringify({ tool_name: "Bash", tool_input: { command: "git push origin main" } }));
      gate.stdin.end();
      expect(JSON.parse(await new Response(gate.stdout).text())).toMatchObject({
        hookSpecificOutput: { permissionDecision: "deny" },
      });
      expect(await gate.exited).toBe(0);
      const result = await invoke(root);
      expect(result.exitCode).toBe(0);
      const decision = JSON.parse(result.stdout) as { decision: string; reason: string };
      expect(decision.decision).toBe("block");
      expect(decision.reason).toContain("Ratchet green");
      expect(decision.reason).toContain("SHELVE any milestone");
      expect(decision.reason).toContain("record it under Blocked");
      expect(existsSync(join(root, ".night-loop", "state", "HALTED"))).toBe(false);
      expect(existsSync(join(root, ".night-loop", "state", "ACTIVE"))).toBe(true);
      const tape = await Bun.file(join(root, ".night-loop", "state", "events.jsonl")).text();
      expect(tape).toContain("policy.blocked");
      expect(tape).toContain("stop.continued");
    });
  });

  test("a red ratchet blocks new work with the failing command and never halts the loop", async () => {
    await withFixtureRepo("red ratchet", async (root) => {
      seedHarness(root);
      atomicWriteFile(join(root, ".night-loop", "ratchet.json"), `${JSON.stringify({
        hard: [{ display: "seed red", argv: ["bun", "fail.ts"] }],
        acceptedE2e: [],
      }, null, 2)}\n`);
      atomicWriteFile(join(root, ".night-loop", "state", "ACTIVE"), "run\n");
      const result = await invoke(root);
      expect(result.exitCode).toBe(0);
      const decision = JSON.parse(result.stdout) as { decision: string; reason: string };
      expect(decision.decision).toBe("block");
      expect(decision.reason).toContain("Ratchet is RED");
      expect(decision.reason).toContain("seed red");
      expect(decision.reason).toContain("revert");
      expect(existsSync(join(root, ".night-loop", "state", "HALTED"))).toBe(false);
      expect(existsSync(join(root, ".night-loop", "state", "ACTIVE"))).toBe(true);
    });
  });
});

describe("verified halt states", () => {
  test("done requires a green full harness", async () => {
    await withFixtureRepo("done", async (root) => {
      seedHarness(root);
      atomicWriteFile(join(root, ".night-loop", "state", "ACTIVE"), "run\n");
      atomicWriteFile(join(root, ".night-loop", "state", "CLAIM_DONE"), "");
      const result = await invoke(root);
      expect(result.exitCode).toBe(0);
      expect(await Bun.file(join(root, ".night-loop", "state", "HALTED")).text()).toBe("done");
      expect(existsSync(join(root, ".night-loop", "state", "ACTIVE"))).toBe(false);
    });
  });

  test("a red full harness rejects and removes CLAIM_DONE with exact command evidence", async () => {
    await withFixtureRepo("rejected", async (root) => {
      seedHarness(root, false);
      atomicWriteFile(join(root, ".night-loop", "state", "ACTIVE"), "run\n");
      atomicWriteFile(join(root, ".night-loop", "state", "CLAIM_DONE"), "");
      const result = await invoke(root);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ decision: "block" });
      expect(result.stdout).toContain("bun run test:screenshot");
      expect(existsSync(join(root, ".night-loop", "state", "CLAIM_DONE"))).toBe(false);
      expect(existsSync(join(root, ".night-loop", "state", "ACTIVE"))).toBe(true);
    });
  });

  test("blocked and budget halt without leaving ACTIVE", async () => {
    for (const reason of ["blocked", "budget"] as const) {
      await withFixtureRepo(reason, async (root) => {
        seedHarness(root);
        atomicWriteFile(join(root, ".night-loop", "state", "ACTIVE"), "run\n");
        if (reason === "blocked") atomicWriteFile(join(root, ".night-loop", "state", "ALL_BLOCKED"), "");
        const result = await invoke(root, reason === "budget" ? { NIGHT_LOOP_MAX_STEPS: "0" } : {});
        expect(result.exitCode).toBe(0);
        expect(await Bun.file(join(root, ".night-loop", "state", "HALTED")).text()).toBe(reason);
        expect(existsSync(join(root, ".night-loop", "state", "ACTIVE"))).toBe(false);
        const tape = await Bun.file(join(root, ".night-loop", "state", "events.jsonl")).text();
        expect(tape).toContain(`\"reason\":\"${reason}\"`);
      });
    }
  });
});
