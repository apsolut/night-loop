import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { atomicWriteFile, atomicWriteJson, readJsonFile, runCommand, withFixtureRepo } from "../../src/core";

interface FixtureResult {
  status: "success" | "interaction_required";
  repo: string;
  payload: string;
}

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
const PRODUCT_ROOT = join(import.meta.dir, "..", "..");
const EVENT_HOOK = join(import.meta.dir, "..", "..", ".night-loop", "hooks", "events.ts");
const GATE_HOOK = join(import.meta.dir, "..", "..", ".night-loop", "hooks", "gate.ts");
const POWERSHELL_LAUNCHER = join(import.meta.dir, "..", "..", "scripts", "night-loop.ps1");
const POSIX_LAUNCHER = join(import.meta.dir, "..", "..", "scripts", "night-loop.sh");

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

  test("the native launcher forwards the same seeded arguments to the Bun core", async () => {
    await withFixtureRepo("launcher", async (root) => {
      const payload = "space ' quote \" Ω ; $(never-run)";
      const launcher: [string, ...string[]] = process.platform === "win32"
        ? ["pwsh", "-NoProfile", "-File", POWERSHELL_LAUNCHER]
        : ["sh", POSIX_LAUNCHER];
      const result = await runCommand([
        ...launcher,
        "fixture",
        "--repo",
        root,
        "--payload",
        payload,
      ], { cwd: root });
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ status: "success", repo: ".", payload });
    });
  });

  test("every available launcher drives the same Bun core to identical state from one seed", async () => {
    await withFixtureRepo("launcher parity", async (root) => {
      const payload = "parity ' quote \" Ω ; $(never-run)";
      const launchers: [string, ...string[]][] = [];
      if (Bun.which("pwsh")) launchers.push(["pwsh", "-NoProfile", "-File", POWERSHELL_LAUNCHER]);
      if (Bun.which("sh")) launchers.push(["sh", POSIX_LAUNCHER]);
      expect(launchers.length).toBeGreaterThan(0);
      for (const launcher of launchers) {
        const result = await runCommand([
          ...launcher,
          "fixture",
          "--repo",
          root,
          "--payload",
          payload,
        ], { cwd: root });
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({ status: "success", repo: ".", payload });
        expect(readJsonFile<FixtureResult>(join(root, ".night-loop", "state", "fixture.json"))).toEqual({
          status: "success",
          repo: ".",
          payload,
        });
      }
    });
  }, 20000);
});

const SESSION_ID = "123e4567-e89b-12d3-a456-426614174000";

async function fakeClaude(root: string): Promise<{ script: string; log: string }> {
  const script = join(root, "fake claude Ω.ts");
  const log = join(root, "claude calls.jsonl");
  atomicWriteFile(script, [
    "import { appendFileSync } from 'node:fs';",
    "const args = Bun.argv.slice(2);",
    "const secretPresent = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);",
    "appendFileSync(process.env.FAKE_CLAUDE_LOG!, JSON.stringify({ args, secretPresent }) + '\\n');",
    "if (args.includes('--version')) console.log('2.1.229 (Claude Code)');",
    "else if (args[0] === 'agents') console.log(process.env.FAKE_AGENTS_JSON || '[]');",
    `else if (args[0] === 'stop') console.log('stopped ${SESSION_ID}');`,
    "else if (process.env.FAKE_CLAUDE_OUTPUT) console.log(process.env.FAKE_CLAUDE_OUTPUT);",
    `else console.log('Session: ${SESSION_ID}');`,
    "",
  ].join("\n"));
  return { script, log };
}

function cliEnv(script: string, log: string): Record<string, string> {
  return {
    NIGHT_LOOP_CLAUDE_BIN: process.execPath,
    NIGHT_LOOP_CLAUDE_SHIM: script,
    NIGHT_LOOP_NOW: "2026-08-13T20:00:00.000Z",
    NIGHT_LOOP_DISABLE_WATCH: "1",
    NIGHT_LOOP_TEST_BACKOFF_MS: "0",
    FAKE_CLAUDE_LOG: log,
    ANTHROPIC_API_KEY: "must-not-reach-child",
  };
}

describe("Claude-native command surface", () => {
  test("start defaults to dontAsk and full follows the same path with bypassPermissions", async () => {
    for (const command of ["start", "full"] as const) {
      await withFixtureRepo(`command ${command}`, async (root) => {
        const { script, log } = await fakeClaude(root);
        const env = cliEnv(script, log);
        const setup = await runCommand([
          process.execPath,
          CLI,
          "setup",
          "--repo",
          root,
          "--goal",
          "Handle spaces ' quotes and Ω",
        ], { cwd: root, env });
        expect(setup.exitCode).toBe(0);
        const launched = await runCommand([process.execPath, CLI, command, "--repo", root], { cwd: root, env });
        expect(launched.exitCode).toBe(0);
        const state = JSON.parse(launched.stdout) as { status: string; permissions: string; nativeSessionId: string };
        expect(state.status).toBe("running");
        expect(state.nativeSessionId).toBe(SESSION_ID);
        const call = JSON.parse((await Bun.file(log).text()).trim().split(/\r?\n/).at(-1)!) as {
          args: string[];
          secretPresent: boolean;
        };
        expect(call.args).toContain("--bg");
        expect(call.args).toContain("--plugin-dir");
        expect(call.args[call.args.indexOf("--plugin-dir") + 1]).toBe(PRODUCT_ROOT);
        expect(call.args[call.args.indexOf("--permission-mode") + 1]).toBe(command === "full" ? "bypassPermissions" : "dontAsk");
        expect(call.secretPresent).toBe(false);
      });
    }
  });

  test("start without a permissions option selects workspace even when the contract records full", async () => {
    await withFixtureRepo("workspace default", async (root) => {
      const { script, log } = await fakeClaude(root);
      const env = cliEnv(script, log);
      expect((await runCommand([
        process.execPath,
        CLI,
        "setup",
        "--repo",
        root,
        "--goal",
        "Full contract, plain start",
        "--permissions",
        "full",
      ], { cwd: root, env })).exitCode).toBe(0);
      const launched = await runCommand([process.execPath, CLI, "start", "--repo", root], { cwd: root, env });
      expect(launched.exitCode).toBe(0);
      expect(JSON.parse(launched.stdout)).toMatchObject({ status: "running", permissions: "workspace" });
      const call = JSON.parse((await Bun.file(log).text()).trim().split(/\r?\n/).at(-1)!) as { args: string[] };
      expect(call.args[call.args.indexOf("--permission-mode") + 1]).toBe("dontAsk");
    });
  });

  test("a second start while a session is active is rejected without reaching Claude", async () => {
    await withFixtureRepo("single session", async (root) => {
      const { script, log } = await fakeClaude(root);
      const env = cliEnv(script, log);
      await runCommand([process.execPath, CLI, "setup", "--repo", root, "--goal", "One implementer"], { cwd: root, env });
      expect((await runCommand([process.execPath, CLI, "start", "--repo", root], { cwd: root, env })).exitCode).toBe(0);
      const callsBefore = (await Bun.file(log).text()).trim().split(/\r?\n/).length;
      const second = await runCommand([process.execPath, CLI, "start", "--repo", root], { cwd: root, env });
      expect(second.exitCode).toBe(2);
      expect(JSON.parse(second.stderr)).toMatchObject({
        status: "invalid_arguments",
        message: "A NIGHT LOOP session is already active",
      });
      const callsAfter = (await Bun.file(log).text()).trim().split(/\r?\n/).length;
      expect(callsAfter).toBe(callsBefore);
    });
  });

  test("start without a prior contract fails fast and never reaches Claude or a supervisor", async () => {
    await withFixtureRepo("no contract", async (root) => {
      const { script, log } = await fakeClaude(root);
      const env = { ...cliEnv(script, log) };
      delete env.NIGHT_LOOP_DISABLE_WATCH;
      const result = await runCommand([process.execPath, CLI, "start", "--repo", root], { cwd: root, env });
      expect(result.exitCode).toBe(2);
      expect(JSON.parse(result.stderr)).toMatchObject({
        status: "invalid_arguments",
        message: "Run night-loop setup before start",
      });
      expect(existsSync(log)).toBe(false);
      expect(existsSync(join(root, ".night-loop", "state", "ACTIVE"))).toBe(false);
    });
  });

  test("status reports the seeded native session without asking a question", async () => {
    await withFixtureRepo("status", async (root) => {
      const { script, log } = await fakeClaude(root);
      const env = {
        ...cliEnv(script, log),
        FAKE_AGENTS_JSON: JSON.stringify([{ id: SESSION_ID, name: "night-loop", status: "running", cwd: root }]),
      };
      await runCommand([process.execPath, CLI, "setup", "--repo", root, "--goal", "Status"], { cwd: root, env });
      await runCommand([process.execPath, CLI, "start", "--repo", root], { cwd: root, env });
      const status = await runCommand([process.execPath, CLI, "status", "--repo", root], { cwd: root, env });
      expect(status.exitCode).toBe(0);
      const report = JSON.parse(status.stdout) as { status: string; native: { id: string }; active: boolean };
      expect(report.status).toBe("running");
      expect(report.native.id).toBe(SESSION_ID);
      expect(report.active).toBe(true);
      expect(status.stderr).toBe("");
    });
  });

  test("start records the contract and run before the spawned supervisor starts", async () => {
    await withFixtureRepo("watch order", async (root) => {
      const { script, log } = await fakeClaude(root);
      // A 60s first poll parks the supervisor in its initial sleep: it holds only its own
      // process (no claude children, no fixture file handles) until the direct kill below.
      const env: Record<string, string> = { ...cliEnv(script, log), NIGHT_LOOP_POLL_MS: "60000" };
      delete env.NIGHT_LOOP_DISABLE_WATCH;
      await runCommand([process.execPath, CLI, "setup", "--repo", root, "--goal", "Watch order"], { cwd: root, env });
      await runCommand([process.execPath, CLI, "start", "--repo", root], { cwd: root, env });
      const tape = (await Bun.file(join(root, ".night-loop", "state", "events.jsonl")).text())
        .trim().split(/\r?\n/).map((line) => JSON.parse(line) as { type: string; data: Record<string, unknown> });
      const contract = readJsonFile<{ goal: string }>(join(root, ".night-loop", "state", "contract.json"));
      expect(contract.goal).toBe("Watch order");
      const types = tape.map((event) => event.type);
      const supervisorIndex = types.indexOf("supervisor.started");
      expect(types.indexOf("contract.approved")).toBeGreaterThanOrEqual(0);
      expect(types.indexOf("run.starting")).toBeGreaterThanOrEqual(0);
      expect(supervisorIndex).toBeGreaterThan(types.indexOf("contract.approved"));
      expect(supervisorIndex).toBeGreaterThan(types.indexOf("run.starting"));
      const pid = tape[supervisorIndex]!.data.pid as number;
      expect(Number.isInteger(pid)).toBe(true);
      try { process.kill(pid); } catch {}
      for (let attempt = 0; attempt < 2000; attempt += 1) {
        try { process.kill(pid, 0); } catch { break; }
        await Bun.sleep(10);
      }
      expect(() => process.kill(pid, 0)).toThrow();
    });
  }, 30000);

  test("the fake Claude receives the seeded prompt and settings path verbatim", async () => {
    await withFixtureRepo("verbatim argv", async (root) => {
      const { script, log } = await fakeClaude(root);
      const env = cliEnv(script, log);
      const goal = "Handle spaces ' quotes \" Ω ; $(never-run) `backtick`";
      expect((await runCommand([
        process.execPath, CLI, "setup", "--repo", root, "--goal", goal,
      ], { cwd: root, env })).exitCode).toBe(0);
      expect((await runCommand([process.execPath, CLI, "start", "--repo", root], { cwd: root, env })).exitCode).toBe(0);
      const call = JSON.parse((await Bun.file(log).text()).trim().split(/\r?\n/).at(-1)!) as { args: string[] };
      expect(call.args.at(-1)).toContain(`/goal ${goal}`);
      const settingsPath = call.args[call.args.indexOf("--settings") + 1]!;
      expect(settingsPath).toBe(join(root, ".night-loop", "state", "claude-settings.json"));
      expect(settingsPath).toContain("Ω");
      expect(settingsPath).toContain(" ");
    });
  });

  const pwshAvailable = Boolean(Bun.which("pwsh"));
  const shAvailable = Boolean(Bun.which("sh"));

  test.if(pwshAvailable)("the documented PowerShell command drives setup and start to the fake Claude", async () => {
    await withFixtureRepo("pwsh start", async (root) => {
      const { script, log } = await fakeClaude(root);
      const env = cliEnv(script, log);
      const launcher = ["pwsh", "-NoProfile", "-File", POWERSHELL_LAUNCHER] as const;
      expect((await runCommand([
        ...launcher, "setup", "--repo", root, "--goal", "PowerShell native ' \" Ω",
      ], { cwd: root, env })).exitCode).toBe(0);
      const launched = await runCommand([...launcher, "start", "--repo", root], { cwd: root, env });
      expect(launched.exitCode).toBe(0);
      expect(JSON.parse(launched.stdout)).toMatchObject({
        status: "running",
        nativeSessionId: SESSION_ID,
        permissions: "workspace",
      });
      const call = JSON.parse((await Bun.file(log).text()).trim().split(/\r?\n/).at(-1)!) as { args: string[] };
      expect(call.args.at(-1)).toContain("/goal PowerShell native ' \" Ω");
    });
  }, 20000);

  test.if(pwshAvailable && shAvailable)("both launchers produce equivalent state transitions from the same seed", async () => {
    const transitions: Array<{ run: Record<string, unknown>; events: Array<[string, Record<string, unknown>]> }> = [];
    for (const kind of ["pwsh", "sh"] as const) {
      await withFixtureRepo(`parity ${kind}`, async (root) => {
        const { script, log } = await fakeClaude(root);
        const env = cliEnv(script, log);
        const launcher = kind === "pwsh"
          ? ["pwsh", "-NoProfile", "-File", POWERSHELL_LAUNCHER] as const
          : ["sh", POSIX_LAUNCHER] as const;
        expect((await runCommand([
          ...launcher, "setup", "--repo", root, "--goal", "Same seed ' \" Ω", "--workers", "2", "--max-steps", "120",
        ], { cwd: root, env })).exitCode).toBe(0);
        expect((await runCommand([...launcher, "start", "--repo", root], { cwd: root, env })).exitCode).toBe(0);
        expect((await runCommand([...launcher, "stop", "--repo", root], { cwd: root, env })).exitCode).toBe(0);
        const run = readJsonFile<Record<string, unknown>>(join(root, ".night-loop", "state", "run.json"));
        const events = (await Bun.file(join(root, ".night-loop", "state", "events.jsonl")).text())
          .trim().split(/\r?\n/)
          .map((line) => JSON.parse(line) as { type: string; data: Record<string, unknown> })
          .map((event) => [event.type, event.data] as [string, Record<string, unknown>]);
        transitions.push({ run, events });
      });
    }
    expect(transitions[0]!.run).toEqual(transitions[1]!.run);
    expect(transitions[0]!.events).toEqual(transitions[1]!.events);
  }, 30000);

  test("start classifies seeded Claude questions and exits without an active wait", async () => {
    await withFixtureRepo("start question", async (root) => {
      const { script, log } = await fakeClaude(root);
      const env = { ...cliEnv(script, log), FAKE_CLAUDE_OUTPUT: "Allow editing?" };
      await runCommand([process.execPath, CLI, "setup", "--repo", root, "--goal", "No questions"], { cwd: root, env });
      const result = await runCommand([process.execPath, CLI, "start", "--repo", root], { cwd: root, env });
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ status: "interaction_required" });
      expect(existsSync(join(root, ".night-loop", "state", "ACTIVE"))).toBe(false);
      expect(await Bun.file(join(root, ".night-loop", "state", "events.jsonl")).text()).toContain("terminate_without_waiting");
    });
  });

  test("stop and resume preserve full permissions and limits without prompting", async () => {
    await withFixtureRepo("resume", async (root) => {
      const { script, log } = await fakeClaude(root);
      const env = cliEnv(script, log);
      expect((await runCommand([
        process.execPath,
        CLI,
        "setup",
        "--repo",
        root,
        "--goal",
        "Resume safely",
        "--permissions",
        "full",
        "--workers",
        "3",
        "--max-steps",
        "91",
      ], { cwd: root, env })).exitCode).toBe(0);
      expect((await runCommand([process.execPath, CLI, "full", "--repo", root], { cwd: root, env })).exitCode).toBe(0);
      expect((await runCommand([process.execPath, CLI, "stop", "--repo", root], { cwd: root, env })).exitCode).toBe(0);
      expect((await runCommand([
        process.execPath,
        CLI,
        "setup",
        "--repo",
        root,
        "--goal",
        "Changed attended defaults",
        "--permissions",
        "workspace",
        "--workers",
        "1",
      ], { cwd: root, env })).exitCode).toBe(0);
      const resumed = await runCommand([process.execPath, CLI, "resume", "--repo", root], { cwd: root, env });
      expect(resumed.exitCode).toBe(0);
      expect(JSON.parse(resumed.stdout)).toMatchObject({
        status: "running",
        permissions: "full",
        limits: { workers: 3, maxSteps: 91 },
      });
      const calls = (await Bun.file(log).text()).trim().split(/\r?\n/).map((line) => JSON.parse(line) as { args: string[] });
      const resume = calls.at(-1)!.args;
      expect(resume.slice(0, 2)).toEqual(["--resume", SESSION_ID]);
      expect(resume[resume.indexOf("--permission-mode") + 1]).toBe("bypassPermissions");
    });
  });

  test("resume never upgrades a workspace run to a later full contract", async () => {
    await withFixtureRepo("no upgrade", async (root) => {
      const { script, log } = await fakeClaude(root);
      const env = cliEnv(script, log);
      await runCommand([
        process.execPath, CLI, "setup", "--repo", root, "--goal", "Workspace first",
        "--permissions", "workspace", "--workers", "1", "--max-steps", "50",
      ], { cwd: root, env });
      await runCommand([process.execPath, CLI, "start", "--repo", root], { cwd: root, env });
      await runCommand([process.execPath, CLI, "stop", "--repo", root], { cwd: root, env });
      await runCommand([
        process.execPath, CLI, "setup", "--repo", root, "--goal", "Attended upgrade attempt",
        "--permissions", "full", "--workers", "8", "--max-steps", "9000",
      ], { cwd: root, env });
      const resumed = await runCommand([process.execPath, CLI, "resume", "--repo", root], { cwd: root, env });
      expect(resumed.exitCode).toBe(0);
      expect(JSON.parse(resumed.stdout)).toMatchObject({
        status: "running",
        permissions: "workspace",
        limits: { workers: 1, maxSteps: 50 },
      });
      const resume = JSON.parse((await Bun.file(log).text()).trim().split(/\r?\n/).at(-1)!) as { args: string[] };
      expect(resume.args[resume.args.indexOf("--permission-mode") + 1]).toBe("dontAsk");
    });
  });

  test("morning emits a verifiable receipt from the event tape", async () => {
    await withFixtureRepo("morning", async (root) => {
      const { script, log } = await fakeClaude(root);
      const env = cliEnv(script, log);
      atomicWriteFile(join(root, ".night-loop", "backlog.yaml"), '- id: M1\n  acceptance:\n    - "A checkable result"\n');
      atomicWriteFile(join(root, ".night-loop", "progress.md"), "# Progress\n\n## Doing\nM1\n");
      await runCommand([process.execPath, CLI, "setup", "--repo", root, "--goal", "Receipt"], { cwd: root, env });
      await runCommand([process.execPath, CLI, "start", "--repo", root], { cwd: root, env });
      const morning = await runCommand([process.execPath, CLI, "morning", "--repo", root], { cwd: root, env });
      expect(morning.exitCode).toBe(0);
      const output = JSON.parse(morning.stdout) as { markdown: string; json: string; status: string };
      expect(existsSync(output.markdown)).toBe(true);
      expect(existsSync(output.json)).toBe(true);
      const digest = await Bun.file(output.markdown).text();
      expect(digest).toContain("Ledger: **VERIFIED**");
      const receipt = await Bun.file(output.json).text();
      const eventsLog = await Bun.file(join(root, ".night-loop", "state", "events.jsonl")).text();
      for (const capture of [digest, receipt, eventsLog]) {
        expect(capture).not.toContain("must-not-reach-child");
      }
    });
  });

  test("the supervisor deterministically resumes a missing native session", async () => {
    await withFixtureRepo("supervisor", async (root) => {
      const { script, log } = await fakeClaude(root);
      const env = cliEnv(script, log);
      await runCommand([process.execPath, CLI, "setup", "--repo", root, "--goal", "Recover"], { cwd: root, env });
      await runCommand([process.execPath, CLI, "start", "--repo", root], { cwd: root, env });
      const supervised = await runCommand([process.execPath, CLI, "_supervise", "--once", "--repo", root], { cwd: root, env });
      expect(supervised.exitCode).toBe(0);
      const calls = (await Bun.file(log).text()).trim().split(/\r?\n/).map((line) => JSON.parse(line) as { args: string[] });
      expect(calls.some((call) => call.args[0] === "agents" && call.args.includes("--json"))).toBe(true);
      const resume = calls.at(-1)!.args;
      expect(resume.slice(0, 2)).toEqual(["--resume", SESSION_ID]);
      expect(resume[resume.indexOf("--plugin-dir") + 1]).toBe(PRODUCT_ROOT);
      const events = await Bun.file(join(root, ".night-loop", "state", "events.jsonl")).text();
      expect(events).toContain("supervisor.recovery");
      expect(events).toContain('"backoffSeconds":20');
    });
  });

  test("stop removes ACTIVE, calls native claude stop, and preserves resumable state and logs", async () => {
    await withFixtureRepo("stop evidence", async (root) => {
      const { script, log } = await fakeClaude(root);
      const env = cliEnv(script, log);
      await runCommand([process.execPath, CLI, "setup", "--repo", root, "--goal", "Stop evidence"], { cwd: root, env });
      await runCommand([process.execPath, CLI, "start", "--repo", root], { cwd: root, env });
      const stopped = await runCommand([process.execPath, CLI, "stop", "--repo", root], { cwd: root, env });
      expect(stopped.exitCode).toBe(0);
      expect(JSON.parse(stopped.stdout)).toMatchObject({ status: "stopped", nativeSessionId: SESSION_ID });
      expect(existsSync(join(root, ".night-loop", "state", "ACTIVE"))).toBe(false);
      const run = readJsonFile<{ status: string; nativeSessionId: string }>(join(root, ".night-loop", "state", "run.json"));
      expect(run).toMatchObject({ status: "stopped", nativeSessionId: SESSION_ID });
      const calls = (await Bun.file(log).text()).trim().split(/\r?\n/).map((line) => JSON.parse(line) as { args: string[] });
      expect(calls.at(-1)!.args.slice(0, 2)).toEqual(["stop", SESSION_ID]);
      const tape = await Bun.file(join(root, ".night-loop", "state", "events.jsonl")).text();
      expect(tape).toContain("run.stopped");
      expect(tape).toContain("run.started");
    });
  });

  test("stop terminates the detached supervisor before returning", async () => {
    await withFixtureRepo("stop supervisor", async (root) => {
      const { script, log } = await fakeClaude(root);
      // A 60s first poll parks the supervisor in its initial sleep, so its death can
      // only come from stop terminating it, never from its own loop exit.
      const env: Record<string, string> = { ...cliEnv(script, log), NIGHT_LOOP_POLL_MS: "60000" };
      delete env.NIGHT_LOOP_DISABLE_WATCH;
      await runCommand([process.execPath, CLI, "setup", "--repo", root, "--goal", "Stop tree"], { cwd: root, env });
      await runCommand([process.execPath, CLI, "start", "--repo", root], { cwd: root, env });
      const pidFile = join(root, ".night-loop", "state", "SUPERVISOR_PID");
      const pid = Number((await Bun.file(pidFile).text()).trim());
      expect(Number.isInteger(pid) && pid > 0).toBe(true);
      expect(() => process.kill(pid, 0)).not.toThrow();
      const stopped = await runCommand([process.execPath, CLI, "stop", "--repo", root], { cwd: root, env });
      expect(stopped.exitCode).toBe(0);
      expect(() => process.kill(pid, 0)).toThrow();
      expect(existsSync(pidFile)).toBe(false);
    });
  }, 30000);

  test("the shipped plugin binds resume, loop, gate, and events hooks to their Claude events", async () => {
    const manifest = readJsonFile<{ hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> }>(
      join(PRODUCT_ROOT, "hooks", "hooks.json"),
    );
    const bindings: Record<string, string> = {
      SessionStart: "resume.ts",
      Stop: "loop.ts",
      PreToolUse: "gate.ts",
      PermissionRequest: "events.ts",
      Elicitation: "events.ts",
    };
    for (const [event, hookFile] of Object.entries(bindings)) {
      const commands = (manifest.hooks[event] ?? []).flatMap((entry) => entry.hooks.map((hook) => hook.command));
      expect(commands.some((command) =>
        command.includes("${CLAUDE_PLUGIN_ROOT}") && command.includes("with-bun.sh") && command.endsWith(hookFile))).toBe(true);
    }
  });

  test("the supervisor exits without touching Claude when no run is active", async () => {
    await withFixtureRepo("inactive supervisor", async (root) => {
      const { script, log } = await fakeClaude(root);
      const env = cliEnv(script, log);
      const supervised = await runCommand([process.execPath, CLI, "_supervise", "--once", "--repo", root], { cwd: root, env });
      expect(supervised.exitCode).toBe(0);
      expect(existsSync(log)).toBe(false);
    });
  });

  test("each HALTED reason stops the supervisor and records the final status", async () => {
    for (const reason of ["done", "blocked", "budget"] as const) {
      await withFixtureRepo(`halted ${reason}`, async (root) => {
        const { script, log } = await fakeClaude(root);
        const env = cliEnv(script, log);
        await runCommand([process.execPath, CLI, "setup", "--repo", root, "--goal", "Halt"], { cwd: root, env });
        await runCommand([process.execPath, CLI, "start", "--repo", root], { cwd: root, env });
        atomicWriteFile(join(root, ".night-loop", "state", "HALTED"), `${reason}\n`);
        const supervised = await runCommand([process.execPath, CLI, "_supervise", "--once", "--repo", root], { cwd: root, env });
        expect(supervised.exitCode).toBe(0);
        expect(readJsonFile<{ status: string }>(join(root, ".night-loop", "state", "run.json")).status).toBe(reason);
        expect(existsSync(join(root, ".night-loop", "state", "ACTIVE"))).toBe(false);
        const calls = (await Bun.file(log).text()).trim().split(/\r?\n/).map((line) => JSON.parse(line) as { args: string[] });
        expect(calls.at(-1)!.args.slice(0, 2)).toEqual(["stop", SESSION_ID]);
        expect(await Bun.file(join(root, ".night-loop", "state", "events.jsonl")).text()).toContain("supervisor.terminated_session");
      });
    }
  });

  test("exhausted relaunches halt the supervisor as budget without a live session", async () => {
    await withFixtureRepo("relaunch budget", async (root) => {
      const { script, log } = await fakeClaude(root);
      const env = cliEnv(script, log);
      await runCommand([
        process.execPath, CLI, "setup", "--repo", root, "--goal", "Bounded", "--max-relaunches", "1",
      ], { cwd: root, env });
      await runCommand([process.execPath, CLI, "start", "--repo", root], { cwd: root, env });
      expect((await runCommand([process.execPath, CLI, "_supervise", "--once", "--repo", root], { cwd: root, env })).exitCode).toBe(0);
      expect((await runCommand([process.execPath, CLI, "_supervise", "--once", "--repo", root], { cwd: root, env })).exitCode).toBe(0);
      expect(readJsonFile<{ status: string }>(join(root, ".night-loop", "state", "run.json")).status).toBe("budget");
      expect((await Bun.file(join(root, ".night-loop", "state", "HALTED")).text()).trim()).toBe("budget");
      expect(existsSync(join(root, ".night-loop", "state", "ACTIVE"))).toBe(false);
      const calls = (await Bun.file(log).text()).trim().split(/\r?\n/).map((line) => JSON.parse(line) as { args: string[] });
      expect(calls.at(-1)!.args.slice(0, 2)).toEqual(["stop", SESSION_ID]);
      const tape = await Bun.file(join(root, ".night-loop", "state", "events.jsonl")).text();
      expect(tape).toContain("supervisor.exhausted");
      expect(tape).toContain("supervisor.terminated_session");
    });
  });

  test("seeded inactivity raises the stall counter to the bound and triggers relaunch", async () => {
    await withFixtureRepo("stall path", async (root) => {
      const { script, log } = await fakeClaude(root);
      const env = {
        ...cliEnv(script, log),
        NIGHT_LOOP_STALL_TICKS: "2",
        FAKE_AGENTS_JSON: JSON.stringify([{ id: SESSION_ID, name: "night-loop", status: "running", cwd: root }]),
      };
      await runCommand([process.execPath, CLI, "setup", "--repo", root, "--goal", "Stall"], { cwd: root, env });
      await runCommand([process.execPath, CLI, "start", "--repo", root], { cwd: root, env });
      const supervisorState = join(root, ".night-loop", "state", "supervisor.json");
      await runCommand([process.execPath, CLI, "_supervise", "--once", "--repo", root], { cwd: root, env });
      expect(readJsonFile(supervisorState)).toMatchObject({ stalledTicks: 0, lastStep: 0, relaunches: 0 });
      await runCommand([process.execPath, CLI, "_supervise", "--once", "--repo", root], { cwd: root, env });
      expect(readJsonFile(supervisorState)).toMatchObject({ stalledTicks: 1, lastStep: 0, relaunches: 0 });
      await runCommand([process.execPath, CLI, "_supervise", "--once", "--repo", root], { cwd: root, env });
      expect(readJsonFile(supervisorState)).toMatchObject({ stalledTicks: 0, relaunches: 1 });
      const events = await Bun.file(join(root, ".night-loop", "state", "events.jsonl")).text();
      expect(events).toContain('"reason":"stalled"');
      const calls = (await Bun.file(log).text()).trim().split(/\r?\n/).map((line) => JSON.parse(line) as { args: string[] });
      expect(calls.at(-1)!.args.slice(0, 2)).toEqual(["--resume", SESSION_ID]);
      atomicWriteFile(join(root, ".night-loop", "state", "STEP"), "7\n");
      await runCommand([process.execPath, CLI, "_supervise", "--once", "--repo", root], { cwd: root, env });
      expect(readJsonFile(supervisorState)).toMatchObject({ stalledTicks: 0, lastStep: 7, relaunches: 1 });
    });
  });

  test("STEP progress resets the supervisor stall counter", async () => {
    await withFixtureRepo("progress reset", async (root) => {
      const { script, log } = await fakeClaude(root);
      const env = {
        ...cliEnv(script, log),
        FAKE_AGENTS_JSON: JSON.stringify([{ id: SESSION_ID, name: "night-loop", status: "running", cwd: root }]),
      };
      await runCommand([process.execPath, CLI, "setup", "--repo", root, "--goal", "Progress"], { cwd: root, env });
      await runCommand([process.execPath, CLI, "start", "--repo", root], { cwd: root, env });
      await runCommand([process.execPath, CLI, "_supervise", "--once", "--repo", root], { cwd: root, env });
      atomicWriteFile(join(root, ".night-loop", "state", "STEP"), "1\n");
      await runCommand([process.execPath, CLI, "_supervise", "--once", "--repo", root], { cwd: root, env });
      expect(readJsonFile(join(root, ".night-loop", "state", "supervisor.json"))).toMatchObject({
        lastStep: 1,
        stalledTicks: 0,
        relaunches: 0,
      });
    });
  });

  test("doctor is green in a clean project before attended setup", async () => {
    await withFixtureRepo("doctor", async (root) => {
      const { script, log } = await fakeClaude(root);
      const doctor = await runCommand([process.execPath, CLI, "doctor", "--repo", root], {
        cwd: root,
        env: cliEnv(script, log),
      });
      expect(doctor.exitCode).toBe(0);
      expect(JSON.parse(doctor.stdout)).toMatchObject({
        status: "green",
        configured: false,
        checks: { claude: true, git: true, bun: true, plugin: true, hooks: true },
      });
    });
  });
});

describe("portable install and CI", () => {
  const pwshHere = Boolean(Bun.which("pwsh"));
  const shHere = Boolean(Bun.which("sh"));

  test.if(pwshHere)("the PowerShell quick start reaches a green doctor in a clean fixture", async () => {
    await withFixtureRepo("pwsh doctor", async (root) => {
      const { script, log } = await fakeClaude(root);
      const doctor = await runCommand([
        "pwsh", "-NoProfile", "-File", POWERSHELL_LAUNCHER, "doctor", "--repo", root,
      ], { cwd: root, env: cliEnv(script, log) });
      expect(doctor.exitCode).toBe(0);
      expect(JSON.parse(doctor.stdout)).toMatchObject({
        status: "green",
        configured: false,
        checks: { claude: true, git: true, bun: true, plugin: true, hooks: true },
      });
    });
  }, 20000);

  test.if(process.platform === "win32")("the Windows quick start reaches a green doctor with stock PowerShell", async () => {
    // powershell.exe ships with every Windows install, so this spec can never
    // silently skip on the platform whose clean fixture it certifies.
    await withFixtureRepo("stock powershell doctor", async (root) => {
      const { script, log } = await fakeClaude(root);
      const doctor = await runCommand([
        "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", POWERSHELL_LAUNCHER, "doctor", "--repo", root,
      ], { cwd: root, env: cliEnv(script, log) });
      expect(doctor.exitCode).toBe(0);
      expect(JSON.parse(doctor.stdout)).toMatchObject({
        status: "green",
        configured: false,
        checks: { claude: true, git: true, bun: true, plugin: true, hooks: true },
      });
    });
  }, 30000);

  test.if(pwshHere && shHere)("both quick starts reach the same green doctor through the same Bun core", async () => {
    const reports: Array<Record<string, unknown>> = [];
    for (const kind of ["pwsh", "sh"] as const) {
      await withFixtureRepo(`doctor ${kind}`, async (root) => {
        const { script, log } = await fakeClaude(root);
        const launcher = kind === "pwsh"
          ? ["pwsh", "-NoProfile", "-File", POWERSHELL_LAUNCHER] as const
          : ["sh", POSIX_LAUNCHER] as const;
        const doctor = await runCommand([...launcher, "doctor", "--repo", root], { cwd: root, env: cliEnv(script, log) });
        expect(doctor.exitCode).toBe(0);
        reports.push(JSON.parse(doctor.stdout) as Record<string, unknown>);
      });
    }
    expect(reports[0]!.status).toBe("green");
    expect(reports[0]!.checks).toEqual(reports[1]!.checks);
    expect(reports[0]!.versions).toEqual(reports[1]!.versions);
  }, 30000);

  test("committed CI defines the three-OS matrix with the fixed toolchain and full suite", async () => {
    const ci = await Bun.file(join(PRODUCT_ROOT, ".github", "workflows", "ci.yml")).text();
    for (const os of ["windows-latest", "ubuntu-latest", "macos-latest"]) {
      expect(ci).toContain(os);
    }
    expect(ci).toContain("bun-version: 1.3.8");
    expect(ci).toContain("bun install --frozen-lockfile");
    for (const command of ["bun run build", "bun run typecheck", "bun run lint", "bun run test:unit", "bun run test:e2e"]) {
      expect(ci).toContain(command);
    }
    expect(ci).toContain("doctor");
  });

  test("the plugin manifest resolves every hook relative to the plugin root", async () => {
    const manifest = readJsonFile<{ hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> }>(
      join(PRODUCT_ROOT, "hooks", "hooks.json"),
    );
    const commands = Object.values(manifest.hooks)
      .flat()
      .flatMap((entry) => entry.hooks.map((hook) => hook.command));
    expect(commands.length).toBeGreaterThan(5);
    for (const command of commands) {
      expect(command.startsWith('sh "${CLAUDE_PLUGIN_ROOT}/.night-loop/hooks/with-bun.sh" ')).toBe(true);
      expect(/[A-Za-z]:[\\/]/.test(command)).toBe(false);
    }
  });

  test("project hook commands quote the project-relative script path", async () => {
    const settings = readJsonFile<{ hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> }>(
      join(PRODUCT_ROOT, ".claude", "settings.json"),
    );
    const commands = Object.values(settings.hooks)
      .flat()
      .flatMap((entry) => entry.hooks.map((hook) => hook.command));
    expect(commands.length).toBeGreaterThan(5);
    for (const command of commands) {
      expect(command.startsWith('sh "${CLAUDE_PROJECT_DIR}/.night-loop/hooks/with-bun.sh" ')).toBe(true);
      expect(/[A-Za-z]:[\\/]/.test(command)).toBe(false);
    }
    expect(settings).toMatchObject({ worktree: { bgIsolation: "none" } });
  });

  test.if(Boolean(Bun.which("sh")))("hooks still run when bun is missing from PATH", async () => {
    await withFixtureRepo("hook bun lookup", async (root) => {
      atomicWriteFile(join(root, ".night-loop", "progress.md"), "# Progress\n\n## Doing\n- bun lookup Ω\n");
      const sh = Bun.which("sh");
      if (!sh) throw new Error("sh required");
      const runner = join(PRODUCT_ROOT, ".night-loop", "hooks", "with-bun.sh");
      const child = Bun.spawn([sh, runner, "resume.ts"], {
        cwd: root,
        env: { ...process.env, PATH: dirname(sh), CLAUDE_PROJECT_DIR: root },
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
      expect(exitCode).toBe(0);
      expect(stderr).not.toContain("bun: command not found");
      expect(JSON.parse(stdout)).toMatchObject({
        hookSpecificOutput: { hookEventName: "SessionStart" },
      });
      expect(JSON.parse(stdout).hookSpecificOutput.additionalContext).toContain("bun lookup Ω");
    });
  }, 20000);

  test("the Linux container fixture pins the same Bun core and defaults to doctor", async () => {
    const dockerfile = await Bun.file(join(PRODUCT_ROOT, "Dockerfile")).text();
    expect(dockerfile).toContain('bash -s "bun-v1.3.8"');
    expect(dockerfile).toContain('CMD ["sh", "scripts/night-loop.sh", "doctor"]');
  });

  test("the public install footprint carries no apsolut-agents payload or runtime reference", async () => {
    const listed = await runCommand(["git", "ls-files"], { cwd: PRODUCT_ROOT });
    expect(listed.exitCode).toBe(0);
    const files = listed.stdout.split(/\r?\n/).filter(Boolean);
    expect(files.some((file) => file.includes("apsolut-agents"))).toBe(false);
    const runtimeFiles = files.filter((file) =>
      /^(src|scripts|hooks|skills|agents|\.claude-plugin|\.github)\//.test(file)
      || /^\.night-loop\/hooks\//.test(file)
      || file === "package.json"
      || file === "Dockerfile");
    expect(runtimeFiles.length).toBeGreaterThan(10);
    for (const file of runtimeFiles) {
      const contents = await Bun.file(join(PRODUCT_ROOT, file)).text();
      expect(contents.includes("apsolut-agents")).toBe(false);
    }
  });

  test("documentation presents one session, one arm command, and zero execution-time questions", async () => {
    const readme = await Bun.file(join(PRODUCT_ROOT, "README.md")).text();
    expect(readme).toContain("wraps one native Claude Code background session");
    expect(readme).toContain("scripts/night-loop.ps1 start");
    expect(readme).toContain("./scripts/night-loop.sh start");
    expect(readme).toContain("Every command after `setup` is noninteractive.");
    expect(readme).toContain("no production credentials");
    expect(readme).toContain("No WSL and no Git Bash are required.");
    expect(readme).toContain("blocks on push, publish, deploy");
  });
});

describe("Question Firewall and immutable gate", () => {
  test("auto-allows ordinary permissions, denies escape actions, and cancels elicitation", async () => {
    await withFixtureRepo("firewall", async (root) => {
      const env = { CLAUDE_PROJECT_DIR: root };
      const ordinaryChild = Bun.spawn([process.execPath, EVENT_HOOK], { cwd: root, env: { ...process.env, ...env }, stdin: "pipe", stdout: "pipe" });
      ordinaryChild.stdin.write(JSON.stringify({ hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "bun test" } }));
      ordinaryChild.stdin.end();
      expect(JSON.parse(await new Response(ordinaryChild.stdout).text())).toMatchObject({
        hookSpecificOutput: { decision: { behavior: "allow" } },
      });

      const blockedChild = Bun.spawn([process.execPath, EVENT_HOOK], { cwd: root, env: { ...process.env, ...env }, stdin: "pipe", stdout: "pipe" });
      blockedChild.stdin.write(JSON.stringify({ hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "git push origin main" } }));
      blockedChild.stdin.end();
      expect(JSON.parse(await new Response(blockedChild.stdout).text())).toMatchObject({
        hookSpecificOutput: { decision: { behavior: "deny", interrupt: false } },
      });

      const elicitationChild = Bun.spawn([process.execPath, EVENT_HOOK], { cwd: root, env: { ...process.env, ...env }, stdin: "pipe", stdout: "pipe" });
      elicitationChild.stdin.write(JSON.stringify({ hook_event_name: "Elicitation", mcp_server_name: "seed", message: "Choose a value" }));
      elicitationChild.stdin.end();
      expect(JSON.parse(await new Response(elicitationChild.stdout).text())).toMatchObject({
        hookSpecificOutput: { action: "cancel" },
      });
      expect(await elicitationChild.exited).toBe(0);
      const missingAuthority = (await Bun.file(join(root, ".night-loop", "state", "events.jsonl")).text())
        .trim().split(/\r?\n/).map((line) => JSON.parse(line) as { type: string; data: Record<string, unknown> })
        .find((event) => event.type === "blocked.missing_authority");
      expect(missingAuthority).toBeDefined();
      expect(missingAuthority!.data).toMatchObject({ server: "seed", action: "shelve_and_continue" });

      const gateChild = Bun.spawn([process.execPath, GATE_HOOK], { cwd: root, env: { ...process.env, ...env }, stdin: "pipe", stdout: "pipe" });
      gateChild.stdin.write(JSON.stringify({ tool_name: "Bash", tool_input: { command: "Remove-Item target -Recurse -Force" } }));
      gateChild.stdin.end();
      expect(JSON.parse(await new Response(gateChild.stdout).text())).toMatchObject({
        hookSpecificOutput: { permissionDecision: "deny" },
      });
    });
  });

  test("the worker cap denies implementer Agent calls while the judge ships without edit tools", async () => {
    await withFixtureRepo("agent lane", async (root) => {
      const child = Bun.spawn([process.execPath, GATE_HOOK], {
        cwd: root,
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
        stdin: "pipe",
        stdout: "pipe",
      });
      child.stdin.write(JSON.stringify({
        tool_name: "Agent",
        tool_input: { subagent_type: "general-purpose", prompt: "implement the next milestone" },
      }));
      child.stdin.end();
      expect(JSON.parse(await new Response(child.stdout).text())).toMatchObject({
        hookSpecificOutput: { permissionDecision: "deny" },
      });
      const tape = await Bun.file(join(root, ".night-loop", "state", "events.jsonl")).text();
      expect(tape).toContain('"category":"worker_cap"');
      const judgeDefinition = await Bun.file(join(PRODUCT_ROOT, "agents", "night-loop-judge.md")).text();
      const tools = judgeDefinition.match(/^tools:\s*(.+)$/m)?.[1] ?? "";
      expect(tools.split(",").map((tool) => tool.trim()).sort()).toEqual(["Bash", "Grep", "Read"]);
    });
  });

  test("no tracked repository file carries a credential value", async () => {
    const listed = await runCommand(["git", "ls-files"], { cwd: PRODUCT_ROOT });
    expect(listed.exitCode).toBe(0);
    const files = listed.stdout.split(/\r?\n/).filter(Boolean)
      .filter((file) => !/\.(png|jpg|jpeg|gif|ico|woff2?)$/i.test(file));
    expect(files.length).toBeGreaterThan(10);
    const credentialPatterns = [
      /sk-ant-[A-Za-z0-9_-]{16,}/,
      /AKIA[0-9A-Z]{16}/,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----\s*\r?\n[A-Za-z0-9+/=]{40,}/,
      /ghp_[A-Za-z0-9]{36}/,
    ];
    for (const file of files) {
      const contents = await Bun.file(join(PRODUCT_ROOT, file)).text();
      for (const pattern of credentialPatterns) {
        expect(pattern.test(contents)).toBe(false);
      }
    }
  }, 20000);

  test("a security-surface edit is allowed, flagged for review, and lands in the morning digest", async () => {
    await withFixtureRepo("security surface", async (root) => {
      const { script, log } = await fakeClaude(root);
      const env = cliEnv(script, log);
      const child = Bun.spawn([process.execPath, GATE_HOOK], {
        cwd: root,
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
        stdin: "pipe",
        stdout: "pipe",
      });
      child.stdin.write(JSON.stringify({
        tool_name: "Edit",
        tool_input: { file_path: join(root, "src", "auth", "login.ts") },
      }));
      child.stdin.end();
      const decision = JSON.parse(await new Response(child.stdout).text()) as {
        hookSpecificOutput: { permissionDecision: string; additionalContext?: string };
      };
      expect(decision.hookSpecificOutput.permissionDecision).toBe("allow");
      expect(decision.hookSpecificOutput.additionalContext).toContain("TEST credentials");
      expect(decision.hookSpecificOutput.additionalContext).toContain("human review before production cutover");
      const review = await Bun.file(join(root, ".night-loop", "state", "REVIEW")).text();
      expect(review).toContain("security surface touched");
      expect(review).toContain("login.ts");
      atomicWriteFile(join(root, ".night-loop", "backlog.yaml"), '- id: M4\n  acceptance:\n    - "Security note surfaces"\n');
      atomicWriteFile(join(root, ".night-loop", "progress.md"), "# Progress\n");
      await runCommand([process.execPath, CLI, "setup", "--repo", root, "--goal", "Digest"], { cwd: root, env });
      const morning = await runCommand([process.execPath, CLI, "morning", "--repo", root], { cwd: root, env });
      expect(morning.exitCode).toBe(0);
      const output = JSON.parse(morning.stdout) as { markdown: string; json: string };
      const digest = await Bun.file(output.markdown).text();
      expect(digest).toContain("## Review before production cutover");
      expect(digest).toContain("login.ts");
      const receipt = await Bun.file(output.json).text();
      expect(receipt).toContain("security surface touched");
    });
  });

  test("escape actions stay denied under a seeded full-permission contract", async () => {
    await withFixtureRepo("full still jailed", async (root) => {
      atomicWriteJson(join(root, ".night-loop", "state", "contract.json"), {
        schemaVersion: 1,
        goal: "Full permission run",
        permissions: "full",
        limits: { maxSteps: 2000, maxRelaunches: 20, workers: 1 },
        createdAt: "2026-08-13T20:00:00.000Z",
      });
      for (const command of ["git push origin main", "npm publish", "curl https://example.test/x"]) {
        const child = Bun.spawn([process.execPath, GATE_HOOK], {
          cwd: root,
          env: { ...process.env, CLAUDE_PROJECT_DIR: root },
          stdin: "pipe",
          stdout: "pipe",
        });
        child.stdin.write(JSON.stringify({ tool_name: "Bash", tool_input: { command } }));
        child.stdin.end();
        expect(JSON.parse(await new Response(child.stdout).text())).toMatchObject({
          hookSpecificOutput: { permissionDecision: "deny" },
        });
      }
      const tape = await Bun.file(join(root, ".night-loop", "state", "events.jsonl")).text();
      expect(tape).toContain('"action":"shelve_and_continue"');
    });
  });

  test("the gate records every seeded external action and continues", async () => {
    await withFixtureRepo("gate matrix", async (root) => {
      const commands = [
        "git push origin main",
        "npm publish",
        "vercel deploy --prod",
        "curl https://example.test/payload",
        "rm -rf output",
        "Remove-Item output -Recurse -Force",
        "DROP DATABASE production",
        "kubectl apply -f production.yaml",
        "bun -e \"writeFileSync('.night-loop/hooks/gate.ts','')\"",
      ];
      for (const command of commands) {
        const child = Bun.spawn([process.execPath, GATE_HOOK], {
          cwd: root,
          env: { ...process.env, CLAUDE_PROJECT_DIR: root },
          stdin: "pipe",
          stdout: "pipe",
        });
        child.stdin.write(JSON.stringify({ tool_name: "Bash", tool_input: { command } }));
        child.stdin.end();
        expect(JSON.parse(await new Response(child.stdout).text())).toMatchObject({
          hookSpecificOutput: { permissionDecision: "deny" },
        });
        expect(await child.exited).toBe(0);
      }
      const tape = await Bun.file(join(root, ".night-loop", "state", "events.jsonl")).text();
      expect(tape.match(/policy\.blocked/g)).toHaveLength(commands.length);
    });
  });
});
