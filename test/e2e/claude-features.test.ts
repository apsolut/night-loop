import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { atomicWriteFile, readJsonFile, runCommand, withFixtureRepo } from "../../src/core";

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
const SESSION_UUID = "d4e5f79a-8e27-4698-9c98-14e452c0d35a";
const SHORT_ID = "d4e5f79a";
// Assembled at runtime so the tracked repository never carries a credential-shaped literal.
const SECRET = ["sk-ant", "api03", "SEEDEDSECRETVALUE0000000000"].join("-");

interface Call { args: string[]; secretPresent: boolean }

// Fake Claude 2.1.303: prints the real `--bg` banner (short id only), answers `agents --json`
// from a seeded record, and serves `logs` with a credential-shaped line.
function fakeClaude(root: string): { script: string; log: string } {
  const script = join(root, "fake claude Ω.ts");
  const log = join(root, "claude calls.jsonl");
  atomicWriteFile(script, [
    "import { appendFileSync } from 'node:fs';",
    "const args = Bun.argv.slice(2);",
    "const secretPresent = Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.XAI_API_KEY);",
    "appendFileSync(process.env.FAKE_CLAUDE_LOG!, JSON.stringify({ args, secretPresent }) + '\\n');",
    "if (args.includes('--version')) console.log(process.env.FAKE_CLAUDE_VERSION || '2.1.303 (Claude Code)');",
    "else if (args[0] === 'agents') console.log(process.env.FAKE_AGENTS_JSON || '[]');",
    "else if (args[0] === 'stop') console.log('stopped ' + args[1]);",
    `else if (args[0] === 'logs') console.log('building M1\\ntoken: ${SECRET}\\napi_key=abc123secret\\nratchet green');`,
    `else console.log('backgrounded · ${SHORT_ID} · night-loop\\n  claude agents             list sessions\\n  claude stop ${SHORT_ID}      stop this session');`,
    "",
  ].join("\n"));
  return { script, log };
}

function agentsJson(extra: Record<string, unknown> = {}): string {
  return JSON.stringify([{
    id: SHORT_ID,
    sessionId: SESSION_UUID,
    name: "night-loop",
    kind: "background",
    state: "working",
    status: "busy",
    pid: 4242,
    ...extra,
  }]);
}

function cliEnv(script: string, log: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    NIGHT_LOOP_CLAUDE_BIN: process.execPath,
    NIGHT_LOOP_CLAUDE_SHIM: script,
    NIGHT_LOOP_NOW: "2026-10-19T22:00:00.000Z",
    NIGHT_LOOP_DISABLE_WATCH: "1",
    NIGHT_LOOP_TEST_BACKOFF_MS: "0",
    FAKE_CLAUDE_LOG: log,
    FAKE_AGENTS_JSON: agentsJson(),
    ANTHROPIC_API_KEY: "must-not-reach-child",
    ...extra,
  };
}

async function calls(log: string): Promise<Call[]> {
  return (await Bun.file(log).text()).trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Call);
}

async function cli(root: string, env: Record<string, string>, ...args: string[]) {
  return runCommand([process.execPath, CLI, ...args, "--repo", root], { cwd: root, env });
}

function statePath(root: string, name: string): string {
  return join(root, ".night-loop", "state", name);
}

describe("Claude Code current-feature adoption (M10)", () => {
  test("a short-id launch resolves the full sessionId from agents --json; stop uses the short id and resume the UUID", async () => {
    await withFixtureRepo("session identity", async (root) => {
      const { script, log } = fakeClaude(root);
      const env = cliEnv(script, log);
      await cli(root, env, "setup", "--goal", "Identity");
      const started = await cli(root, env, "start");
      expect(started.exitCode).toBe(0);
      expect(JSON.parse(started.stdout)).toMatchObject({ status: "running", nativeSessionId: SHORT_ID });
      const status = await cli(root, env, "status");
      expect(status.exitCode).toBe(0);
      expect(JSON.parse(status.stdout)).toMatchObject({ status: "working", native: { id: SHORT_ID, sessionId: SESSION_UUID } });
      const run = readJsonFile<{ nativeSessionId: string; nativeShortId: string }>(statePath(root, "run.json"));
      expect(run).toMatchObject({ nativeSessionId: SESSION_UUID, nativeShortId: SHORT_ID });
      expect((await cli(root, env, "stop")).exitCode).toBe(0);
      expect((await calls(log)).at(-1)!.args.slice(0, 2)).toEqual(["stop", SHORT_ID]);
      const resumed = await cli(root, env, "resume");
      expect(resumed.exitCode).toBe(0);
      expect(JSON.parse(resumed.stdout)).toMatchObject({ status: "running", nativeSessionId: SESSION_UUID });
      expect((await calls(log)).at(-1)!.args.slice(0, 2)).toEqual(["--resume", SESSION_UUID]);
    });
  });

  test("resume straight after a short-id launch resolves the UUID itself before relaunching", async () => {
    await withFixtureRepo("resume resolves", async (root) => {
      const { script, log } = fakeClaude(root);
      const env = cliEnv(script, log);
      await cli(root, env, "setup", "--goal", "Resolve");
      await cli(root, env, "start");
      await cli(root, env, "stop");
      const resumed = await cli(root, env, "resume");
      expect(resumed.exitCode).toBe(0);
      const sequence = (await calls(log)).map((call) => call.args[0]);
      expect(sequence.slice(-2)).toEqual(["agents", "--resume"]);
      expect((await calls(log)).at(-1)!.args[1]).toBe(SESSION_UUID);
    });
  });

  test("a waiting native session is recorded as interaction evidence exactly once per transition", async () => {
    await withFixtureRepo("waiting", async (root) => {
      const { script, log } = fakeClaude(root);
      const waiting = cliEnv(script, log, {
        FAKE_AGENTS_JSON: agentsJson({ state: "blocked", status: "waiting", waitingFor: "permission prompt" }),
      });
      await cli(root, waiting, "setup", "--goal", "Waiting");
      await cli(root, waiting, "start");
      const first = JSON.parse((await cli(root, waiting, "status")).stdout) as {
        status: string;
        native: { state: string; status: string; waitingFor: string };
      };
      expect(first.status).toBe("blocked");
      expect(first.native).toMatchObject({ state: "blocked", status: "waiting", waitingFor: "permission prompt" });
      await cli(root, waiting, "status");
      const tape = await Bun.file(statePath(root, "events.jsonl")).text();
      const recorded = tape.split(/\r?\n/).filter((line) => line.includes('"source":"native_status"'));
      expect(recorded.length).toBe(1);
      expect(JSON.parse(recorded[0]!)).toMatchObject({
        type: "interaction_required",
        data: { source: "native_status", waitingFor: "permission prompt" },
      });
      expect(readJsonFile<{ waitingFor: string }>(statePath(root, "run.json")).waitingFor).toBe("permission prompt");
      // The session resumes working: the transition clears and a later wait is recorded again.
      const busy = JSON.parse((await cli(root, cliEnv(script, log), "status")).stdout) as { native: { status: string } };
      expect(busy.native.status).toBe("busy");
      expect(readJsonFile<{ waitingFor: string | null }>(statePath(root, "run.json")).waitingFor).toBeNull();
      await cli(root, waiting, "status");
      const again = (await Bun.file(statePath(root, "events.jsonl")).text()).split(/\r?\n/)
        .filter((line) => line.includes('"source":"native_status"'));
      expect(again.length).toBe(2);
    });
  });

  test("doctor requires Claude Code 2.1.300 and names the floor in the remediation", async () => {
    await withFixtureRepo("doctor floor", async (root) => {
      const { script, log } = fakeClaude(root);
      const old = await cli(root, cliEnv(script, log, { FAKE_CLAUDE_VERSION: "2.1.299 (Claude Code)" }), "doctor");
      expect(old.exitCode).toBe(1);
      const report = JSON.parse(old.stdout) as { status: string; checks: { claude: boolean }; versions: { claude: string }; remediation: string[] };
      expect(report.status).toBe("red");
      expect(report.checks.claude).toBe(false);
      expect(report.versions.claude).toBe("2.1.299 (Claude Code)");
      expect(report.remediation.some((line) => line.includes("2.1.300"))).toBe(true);
      const current = await cli(root, cliEnv(script, log, { FAKE_CLAUDE_VERSION: "2.1.300 (Claude Code)" }), "doctor");
      expect(current.exitCode).toBe(0);
      expect(JSON.parse(current.stdout)).toMatchObject({ status: "green", checks: { claude: true }, floors: { claude: "2.1.300" } });
    });
  });

  test("generated settings harden the session and setup --model and --effort reach the launch and resume argv verbatim", async () => {
    await withFixtureRepo("model effort", async (root) => {
      const { script, log } = fakeClaude(root);
      const env = cliEnv(script, log);
      expect((await cli(root, env, "setup", "--goal", "Tuned", "--model", "opus", "--effort", "high")).exitCode).toBe(0);
      expect((await cli(root, env, "start")).exitCode).toBe(0);
      const launch = (await calls(log)).at(-1)!.args;
      expect(launch[launch.indexOf("--model") + 1]).toBe("opus");
      expect(launch[launch.indexOf("--effort") + 1]).toBe("high");
      expect(launch.at(-1)).toContain("/goal Tuned");
      const settings = readJsonFile<{ env: Record<string, string> }>(statePath(root, "claude-settings.json"));
      expect(settings.env.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP).toBe("64");
      expect(settings.env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN).toBe("1");
      await cli(root, env, "stop");
      await cli(root, env, "setup", "--goal", "Changed", "--model", "haiku", "--effort", "low");
      expect((await cli(root, env, "resume")).exitCode).toBe(0);
      const resume = (await calls(log)).at(-1)!.args;
      expect(resume[resume.indexOf("--model") + 1]).toBe("opus");
      expect(resume[resume.indexOf("--effort") + 1]).toBe("high");
      const rejected = await cli(root, env, "setup", "--goal", "Leak", "--model", `api_key=${SECRET}`);
      expect(rejected.exitCode).toBe(2);
    });
  });

  test("status and the morning receipt carry a redacted claude logs tail and the seeded secret reaches no durable state", async () => {
    await withFixtureRepo("logs tail", async (root) => {
      const { script, log } = fakeClaude(root);
      const env = cliEnv(script, log);
      atomicWriteFile(join(root, ".night-loop", "backlog.yaml"), '- id: M1\n  acceptance:\n    - "A checkable result"\n');
      atomicWriteFile(join(root, ".night-loop", "progress.md"), "# Progress\n");
      await cli(root, env, "setup", "--goal", "Logs");
      await cli(root, env, "start");
      const status = JSON.parse((await cli(root, env, "status")).stdout) as { run: { logsTail: string[] } };
      expect(status.run.logsTail).toContain("building M1");
      expect(status.run.logsTail).toContain("ratchet green");
      expect(status.run.logsTail.some((line) => line.includes("[REDACTED]"))).toBe(true);
      expect((await calls(log)).some((call) => call.args[0] === "logs" && call.args[1] === SHORT_ID)).toBe(true);
      const morning = JSON.parse((await cli(root, env, "morning")).stdout) as { markdown: string; json: string };
      const digest = await Bun.file(morning.markdown).text();
      expect(digest).toContain("## Session log tail");
      expect(digest).toContain("building M1");
      const receipt = readJsonFile<{ logsTail: string[]; provider: string }>(morning.json);
      expect(receipt.provider).toBe("claude");
      expect(receipt.logsTail).toContain("building M1");
      for (const capture of [
        digest,
        await Bun.file(morning.json).text(),
        await Bun.file(statePath(root, "run.json")).text(),
        await Bun.file(statePath(root, "events.jsonl")).text(),
      ]) {
        expect(capture).not.toContain(SECRET);
        expect(capture).not.toContain("abc123secret");
      }
    });
  });
});
