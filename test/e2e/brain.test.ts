import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFile, readJsonFile, runCommand, withFixtureRepo } from "../../src/core";

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
const LOOP_HOOK = join(import.meta.dir, "..", "..", ".night-loop", "hooks", "loop.ts");
const THREAD_ID = "01a15613-9c83-7521-b8c5-61183e2d5801";
const SESSION_UUID = "d4e5f79a-8e27-4698-9c98-14e452c0d35a";

interface Call { args: string[]; secretPresent: boolean; think: string | null }

async function calls(log: string): Promise<Call[]> {
  if (!existsSync(log)) return [];
  return (await Bun.file(log).text()).trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Call);
}

async function tape(root: string): Promise<string> {
  return Bun.file(join(root, ".night-loop", "state", "events.jsonl")).text();
}

function statePath(root: string, name: string): string {
  return join(root, ".night-loop", "state", name);
}

function seedHarness(root: string, hardPasses: boolean): void {
  atomicWriteFile(join(root, "pass.ts"), "process.exit(0);\n");
  atomicWriteFile(join(root, "fail.ts"), "console.log('seeded failure'); process.exit(1);\n");
  atomicWriteFile(join(root, "package.json"), `${JSON.stringify({
    scripts: { "test:screenshot": "bun pass.ts", perf: "bun pass.ts" },
  }, null, 2)}\n`);
  atomicWriteFile(join(root, ".night-loop", "ratchet.json"), `${JSON.stringify({
    hard: [{ display: "seed check", argv: ["bun", hardPasses ? "pass.ts" : "fail.ts"] }],
    acceptedE2e: [],
  }, null, 2)}\n`);
}

function fakeCodex(root: string): { script: string; log: string } {
  const script = join(root, "fake codex Ω.ts");
  const log = join(root, "codex calls.jsonl");
  atomicWriteFile(script, [
    "import { appendFileSync } from 'node:fs';",
    "const args = Bun.argv.slice(2);",
    "const secretPresent = Boolean(process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY || process.env.XAI_API_KEY);",
    "appendFileSync(process.env.FAKE_CODEX_LOG!, JSON.stringify({ args, secretPresent, think: process.env.NIGHT_LOOP_THINK ?? null }) + '\\n');",
    "if (process.env.FAKE_TOUCH) appendFileSync(process.env.FAKE_TOUCH, 'work\\n');",
    // FAKE_PUSH: the turn tries a push through the real hook bridge, as Codex's in-turn PreToolUse would.
    "if (process.env.FAKE_PUSH && !process.env.NIGHT_LOOP_THINK) {",
    "  const gate = Bun.spawnSync([process.execPath, process.env.FAKE_PUSH, 'gate', '--provider', 'codex'], { cwd: process.cwd(), env: { ...process.env, CLAUDE_PROJECT_DIR: process.cwd() }, stdin: new TextEncoder().encode(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git push origin main' } })) });",
    "  if (!gate.stdout.toString().includes('deny')) process.exit(9);",
    "}",
    `console.log(JSON.stringify({ type: 'thread.started', thread_id: '${THREAD_ID}' }));`,
    "const text = args.includes('read-only') ? (process.env.FAKE_THINK || 'ROOT CAUSE: seed.\\nALTERNATIVES: a, b, c.\\nPLAN: swap the seed to pass.ts') : (process.env.FAKE_MESSAGE || 'Tried again.');",
    "console.log(JSON.stringify({ type: 'item.completed', item: { id: 'i', type: 'agent_message', text } }));",
    "console.log(JSON.stringify({ type: 'turn.completed', usage: {} }));",
    "",
  ].join("\n"));
  return { script, log };
}

function fakeGrok(root: string): { script: string; log: string } {
  const script = join(root, "fake grok Ω.ts");
  const log = join(root, "grok calls.jsonl");
  atomicWriteFile(script, [
    "import { appendFileSync } from 'node:fs';",
    "const args = Bun.argv.slice(2);",
    "const secretPresent = Boolean(process.env.XAI_API_KEY || process.env.GROK_API_KEY || process.env.OPENAI_API_KEY);",
    "appendFileSync(process.env.FAKE_GROK_LOG!, JSON.stringify({ args, secretPresent, think: process.env.NIGHT_LOOP_THINK ?? null }) + '\\n');",
    "const text = process.env.FAKE_GROK_MESSAGE || 'ROOT CAUSE: the seed fails.\\nALTERNATIVES: x, y, z.\\nPLAN: consultant says swap the seed';",
    "console.log(JSON.stringify({ text, stopReason: 'end_turn', sessionId: args.includes('--session-id') ? args[args.indexOf('--session-id') + 1] : 'c0ffee00-0000-4000-8000-000000000000' }));",
    "",
  ].join("\n"));
  return { script, log };
}

function fakeClaude(root: string): { script: string; log: string } {
  const script = join(root, "fake claude Ω.ts");
  const log = join(root, "claude calls.jsonl");
  atomicWriteFile(script, [
    "import { appendFileSync } from 'node:fs';",
    "const args = Bun.argv.slice(2);",
    "appendFileSync(process.env.FAKE_CLAUDE_LOG!, JSON.stringify({ args, secretPresent: Boolean(process.env.ANTHROPIC_API_KEY), think: null }) + '\\n');",
    "if (args.includes('--version')) console.log('2.1.303 (Claude Code)');",
    "else if (args[0] === 'agents') console.log(process.env.FAKE_AGENTS_JSON || '[]');",
    "else if (args[0] === 'stop' || args[0] === 'logs') console.log('ok');",
    "else if (args[0] === '--resume' && process.env.FAKE_RESUME_EXIT) { console.error('seeded resume failure'); process.exit(Number(process.env.FAKE_RESUME_EXIT)); }",
    `else console.log('backgrounded · d4e5f79a · night-loop');`,
    "",
  ].join("\n"));
  return { script, log };
}

function baseEnv(): Record<string, string> {
  return {
    NIGHT_LOOP_NOW: "2026-10-20T03:00:00.000Z",
    NIGHT_LOOP_DISABLE_WATCH: "1",
    NIGHT_LOOP_TEST_BACKOFF_MS: "0",
    NIGHT_LOOP_POLL_MS: "50",
    NIGHT_LOOP_STALL_TICKS: "100000",
    OPENAI_API_KEY: "must-not-reach-child",
    XAI_API_KEY: "must-not-reach-child",
    ANTHROPIC_API_KEY: "must-not-reach-child",
  };
}

function codexEnv(script: string, log: string): Record<string, string> {
  return { ...baseEnv(), NIGHT_LOOP_CODEX_BIN: process.execPath, NIGHT_LOOP_CODEX_SHIM: script, FAKE_CODEX_LOG: log };
}

async function cli(root: string, env: Record<string, string>, ...args: string[]) {
  return runCommand([process.execPath, CLI, ...args, "--repo", root], { cwd: root, env });
}

async function once(root: string, env: Record<string, string>, times = 1): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    expect((await cli(root, env, "_supervise", "--once")).exitCode).toBe(0);
  }
}

describe("stuck detection, think turns, consult, lessons, and shelving (M11)", () => {
  test("three identical red turns schedule a read-only think turn whose plan feeds the next build prompt", async () => {
    await withFixtureRepo("think codex", async (root) => {
      const { script, log } = fakeCodex(root);
      const env = codexEnv(script, log);
      seedHarness(root, false);
      await cli(root, env, "setup", "--goal", "Stuck night", "--provider", "codex");
      await cli(root, env, "start");
      await once(root, env, 2);
      expect(await tape(root)).not.toContain('"type":"stuck.detected"');
      await once(root, env);
      let events = await tape(root);
      expect(events).toContain('"type":"stuck.detected"');
      expect(events).toContain('"reason":"repeated_red"');
      expect(events).toContain('"type":"think.scheduled"');
      expect(readJsonFile<{ pendingThink: { reason: string; episode: number } }>(statePath(root, "run.json")).pendingThink)
        .toMatchObject({ reason: "repeated_red", episode: 1 });
      const thinkPrompt = await Bun.file(statePath(root, "NEXT_PROMPT")).text();
      expect(thinkPrompt).toContain("THINK TURN");
      expect(thinkPrompt).toContain("seed check");
      expect(thinkPrompt).toContain("three alternatives");
      expect(thinkPrompt).toContain("Lessons recorded so far:");
      expect(thinkPrompt).toContain("stuck(repeated_red) episode 1");
      const lessons = await Bun.file(join(root, ".night-loop", "lessons.md")).text();
      expect(lessons).toContain("stuck(repeated_red) episode 1");
      // The think turn itself: read-only, no Stop or resume hook overrides, flagged for the bridge.
      await once(root, env);
      const think = (await calls(log)).at(-1)!;
      expect(think.args[think.args.indexOf("--sandbox") + 1]).toBe("read-only");
      expect(think.args.some((arg) => arg.startsWith("hooks."))).toBe(false);
      expect(think.args[think.args.indexOf("resume") + 1]).toBe(THREAD_ID);
      expect(think.args.at(-1)).toContain("THINK TURN");
      expect(think.think).toBe("1");
      expect(think.secretPresent).toBe(false);
      events = await tape(root);
      expect(events).toContain('"type":"think.completed"');
      expect(events).toContain('"plan":"PLAN: swap the seed to pass.ts"');
      expect(await Bun.file(statePath(root, "THINK.md")).text()).toContain("ROOT CAUSE");
      expect(await Bun.file(join(root, ".night-loop", "lessons.md")).text()).toContain("think(repeated_red): PLAN: swap the seed to pass.ts");
      const next = await Bun.file(statePath(root, "NEXT_PROMPT")).text();
      expect(next).toContain("Ratchet is RED");
      expect(next).toContain("Apply the plan from your think turn:\nPLAN: swap the seed to pass.ts");
      expect(readJsonFile<{ pendingThink?: unknown }>(statePath(root, "run.json")).pendingThink).toBeUndefined();
      // Back to building, with the armed sandbox, and the think turn's own red verdict does not count twice.
      await once(root, env);
      const build = (await calls(log)).at(-1)!;
      expect(build.args[build.args.indexOf("--sandbox") + 1]).toBe("workspace-write");
      expect(build.think).toBeNull();
      expect((await tape(root)).split('"type":"stuck.detected"').length - 1).toBe(1);
      // A stop and resume keeps the queued verifier prompt and refreshes the lessons on it.
      await cli(root, env, "stop");
      expect((await cli(root, env, "resume")).exitCode).toBe(0);
      const resumed = await Bun.file(statePath(root, "NEXT_PROMPT")).text();
      expect(resumed).toContain("Ratchet is RED");
      expect(resumed).toContain("Lessons recorded so far:");
      expect(resumed).toContain("think(repeated_red): PLAN: swap the seed to pass.ts");
      expect(resumed.split("Lessons recorded so far:").length - 1).toBe(1);
    });
  }, 60000);

  test("recoveries append lessons for turn-based and Claude runs, and think turns run without the verifier hooks", async () => {
    await withFixtureRepo("recovery lessons", async (root) => {
      const codex = fakeCodex(root);
      const env = { ...codexEnv(codex.script, codex.log), FAKE_EXIT_CODE: "3" };
      atomicWriteFile(codex.script, `${await Bun.file(codex.script).text()}\n`.replace(
        "if (process.env.FAKE_TOUCH)",
        "if (process.env.FAKE_EXIT_CODE) process.exit(Number(process.env.FAKE_EXIT_CODE));\nif (process.env.FAKE_TOUCH)",
      ));
      seedHarness(root, true);
      await cli(root, env, "setup", "--goal", "Recovery lessons", "--provider", "codex");
      await cli(root, env, "start");
      await once(root, env);
      const lessons = await Bun.file(join(root, ".night-loop", "lessons.md")).text();
      expect(lessons).toContain("recovery(provider_exit) relaunch 1 on turn 1: exit 3");
      // The bridge skips the verifier and event hooks inside a think turn but still gates.
      const run = (hook: string, extra: Record<string, string>, payload: Record<string, unknown>) => {
        const child = Bun.spawn([process.execPath, join(import.meta.dir, "..", "..", "src", "hook-bridge.ts"), hook, "--provider", "codex"], {
          cwd: root,
          env: { ...process.env, CLAUDE_PROJECT_DIR: root, ...extra },
          stdin: "pipe",
          stdout: "pipe",
        });
        child.stdin.write(JSON.stringify(payload));
        child.stdin.end();
        return new Response(child.stdout).text();
      };
      const stepBefore = (await Bun.file(statePath(root, "STEP")).text()).trim();
      expect((await run("loop", { NIGHT_LOOP_THINK: "1" }, { hook_event_name: "Stop" })).trim()).toBe("");
      expect((await Bun.file(statePath(root, "STEP")).text()).trim()).toBe(stepBefore);
      const gated = await run("gate", { NIGHT_LOOP_THINK: "1" }, { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git push origin main" } });
      expect(JSON.parse(gated)).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
      expect((await run("loop", {}, { hook_event_name: "Stop" })).trim()).not.toBe("");
    });
    await withFixtureRepo("claude recovery lesson", async (root) => {
      const { script, log } = fakeClaude(root);
      const env = { ...baseEnv(), NIGHT_LOOP_CLAUDE_BIN: process.execPath, NIGHT_LOOP_CLAUDE_SHIM: script, FAKE_CLAUDE_LOG: log, FAKE_AGENTS_JSON: "[]" };
      seedHarness(root, true);
      await cli(root, env, "setup", "--goal", "Claude recovery");
      await cli(root, env, "start");
      await once(root, env);
      expect(await Bun.file(join(root, ".night-loop", "lessons.md")).text()).toContain("recovery(session_missing) relaunch 1 at step 0");
    });
  }, 60000);

  test("a second identical episode gets one more think turn and the third shelves the path", async () => {
    await withFixtureRepo("shelve codex", async (root) => {
      const { script, log } = fakeCodex(root);
      const env = codexEnv(script, log);
      seedHarness(root, false);
      await cli(root, env, "setup", "--goal", "Shelve night", "--provider", "codex");
      await cli(root, env, "start");
      await once(root, env, 4); // 3 red builds, 1 think
      await once(root, env, 3); // 3 more reds after the think turn
      let events = await tape(root);
      expect(events).toContain('"episode":2');
      await once(root, env, 1); // second think
      expect((events = await tape(root)).split('"type":"think.completed"').length - 1).toBe(2);
      await once(root, env, 3); // third episode
      events = await tape(root);
      expect(events).toContain('"type":"stuck.shelved"');
      expect(events).toContain('"episode":3');
      expect(events.split('"type":"think.scheduled"').length - 1).toBe(2);
      const progress = await Bun.file(join(root, ".night-loop", "progress.md")).text();
      expect(progress).toContain("## Blocked / needs human");
      expect(progress).toContain("SHELVED by the supervisor");
      expect(progress).toContain("Last plan: PLAN: swap the seed to pass.ts");
      const next = await Bun.file(statePath(root, "NEXT_PROMPT")).text();
      expect(next).toContain("SHELVED the current path");
      expect(next).toContain("Pick a different buildable milestone");
      expect(existsSync(statePath(root, "ACTIVE"))).toBe(true);
      expect(readJsonFile<{ status: string }>(statePath(root, "run.json")).status).toBe("running");
      // A fresh episode after the shelve starts counting from zero again.
      await once(root, env, 2);
      expect((await tape(root)).split('"type":"stuck.detected"').length - 1).toBe(3);
    });
  }, 90000);

  test("a healthy run that changes the tree each turn is never classified as stuck, and an unchanged tree is", async () => {
    await withFixtureRepo("progress codex", async (root) => {
      const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
      expect((await runCommand(["git", "init", "-q"], { cwd: root, env: gitEnv })).exitCode).toBe(0);
      seedHarness(root, true);
      atomicWriteFile(join(root, ".gitignore"), ".night-loop/state/\n*.jsonl\n");
      await runCommand(["git", "add", "-A"], { cwd: root, env: gitEnv });
      await runCommand(["git", "commit", "-q", "-m", "seed"], { cwd: root, env: gitEnv });
      const { script, log } = fakeCodex(root);
      const busy = { ...codexEnv(script, log), FAKE_TOUCH: join(root, "work.txt") };
      await cli(root, busy, "setup", "--goal", "Healthy night", "--provider", "codex");
      await cli(root, busy, "start");
      await once(root, busy, 4);
      expect(await tape(root)).not.toContain('"type":"stuck.detected"');
      const idle = codexEnv(script, log);
      await once(root, idle, 3);
      const events = await tape(root);
      expect(events).toContain('"reason":"no_progress"');
      expect(events).toContain('"type":"think.scheduled"');
    });
  }, 60000);

  test("a configured consultant gives a read-only second opinion that the think prompt quotes", async () => {
    await withFixtureRepo("consult", async (root) => {
      const codex = fakeCodex(root);
      const grok = fakeGrok(root);
      const env = {
        ...codexEnv(codex.script, codex.log),
        NIGHT_LOOP_GROK_BIN: process.execPath,
        NIGHT_LOOP_GROK_SHIM: grok.script,
        FAKE_GROK_LOG: grok.log,
      };
      const rejected = await cli(root, env, "setup", "--goal", "x", "--provider", "codex", "--consult", "claude");
      expect(rejected.exitCode).toBe(2);
      expect(rejected.stderr).toContain("decision 001");
      seedHarness(root, false);
      await cli(root, env, "setup", "--goal", "Consult night", "--provider", "codex", "--consult", "grok");
      expect(readJsonFile<{ consult: string }>(statePath(root, "contract.json")).consult).toBe("grok");
      await cli(root, env, "start");
      await once(root, env, 3);
      const consult = (await calls(grok.log)).at(-1)!;
      expect(consult.args[0]).toBe("-p");
      expect(consult.args[1]).toContain("read-only consultant");
      expect(consult.args[1]).toContain("seed check");
      expect(consult.args[consult.args.indexOf("--permission-mode") + 1]).toBe("dontAsk");
      const allowed = consult.args.flatMap((arg, index) => (arg === "--allow" ? [consult.args[index + 1]] : []));
      expect(allowed).toEqual(["Read", "Grep", "Glob"]);
      expect(consult.args).toContain("--no-subagents");
      expect(consult.args).not.toContain("--resume");
      expect(consult.args).not.toContain("--session-id");
      expect(consult.secretPresent).toBe(false);
      expect(consult.think).toBe("1");
      expect(await Bun.file(statePath(root, "CONSULT.md")).text()).toContain("consultant says swap the seed");
      const events = await tape(root);
      expect(events).toContain('"type":"consult.completed"');
      expect(events).toContain('"consult":"grok"');
      const prompt = await Bun.file(statePath(root, "NEXT_PROMPT")).text();
      expect(prompt).toContain("Second opinion from a read-only grok consultant");
      expect(prompt).toContain("PLAN: consultant says swap the seed");
      expect(await Bun.file(join(root, ".night-loop", "lessons.md")).text()).toContain("consult(grok): PLAN: consultant says swap the seed");
    });
  }, 60000);

  test("a Codex consultant for a Grok implementer runs ephemeral, read-only, without hooks or a resume", async () => {
    await withFixtureRepo("consult codex", async (root) => {
      const codex = fakeCodex(root);
      const grok = fakeGrok(root);
      const env = {
        ...baseEnv(),
        NIGHT_LOOP_GROK_BIN: process.execPath,
        NIGHT_LOOP_GROK_SHIM: grok.script,
        FAKE_GROK_LOG: grok.log,
        NIGHT_LOOP_CODEX_BIN: process.execPath,
        NIGHT_LOOP_CODEX_SHIM: codex.script,
        FAKE_CODEX_LOG: codex.log,
      };
      seedHarness(root, false);
      await cli(root, env, "setup", "--goal", "Grok with codex consult", "--provider", "grok", "--consult", "codex");
      await cli(root, env, "start");
      await once(root, env, 3);
      const consult = (await calls(codex.log)).at(-1)!;
      expect(consult.args).toContain("--ephemeral");
      expect(consult.args[consult.args.indexOf("--sandbox") + 1]).toBe("read-only");
      expect(consult.args).not.toContain("resume");
      expect(consult.args.some((arg) => arg.startsWith("hooks."))).toBe(false);
      expect(consult.secretPresent).toBe(false);
      // The think turn then runs on Grok with read-only allow rules.
      await once(root, env);
      const think = (await calls(grok.log)).at(-1)!;
      const allowed = think.args.flatMap((arg, index) => (arg === "--allow" ? [think.args[index + 1]] : []));
      expect(allowed).toEqual(["Read", "Grep", "Glob"]);
      expect(think.args[1]).toContain("THINK TURN");
      expect(think.args[think.args.indexOf("--resume") + 1]).toBeDefined();
      expect(think.think).toBe("1");
    });
  }, 60000);

  test("three turns denied on the same category are stuck as repeated_block and get a think turn", async () => {
    await withFixtureRepo("block codex", async (root) => {
      const { script, log } = fakeCodex(root);
      const env = { ...codexEnv(script, log), FAKE_PUSH: join(import.meta.dir, "..", "..", "src", "hook-bridge.ts") };
      seedHarness(root, true);
      await cli(root, env, "setup", "--goal", "Push night", "--provider", "codex");
      await cli(root, env, "start");
      await once(root, env, 2);
      let events = await tape(root);
      expect(events.split('"category":"external_or_irreversible_action"').length - 1).toBe(2);
      expect(events).not.toContain('"type":"stuck.detected"');
      await once(root, env);
      events = await tape(root);
      expect(events).toContain('"reason":"repeated_block"');
      expect(events).toContain('"fingerprint":"block:external_or_irreversible_action:Bash"');
      expect(events).toContain('"type":"think.scheduled"');
      const prompt = await Bun.file(statePath(root, "NEXT_PROMPT")).text();
      expect(prompt).toContain("THINK TURN");
      expect(prompt).toContain("external_or_irreversible_action:Bash");
      // The think turn itself runs read-only and does not try the push again.
      await once(root, env);
      const think = (await calls(log)).at(-1)!;
      expect(think.think).toBe("1");
      expect(think.args[think.args.indexOf("--sandbox") + 1]).toBe("read-only");
      expect((await tape(root)).split('"category":"external_or_irreversible_action"').length - 1).toBe(3);
      expect(await tape(root)).toContain('"type":"think.completed"');
    });
  }, 60000);

  test("a failed think delivery to Claude is recorded, leaves nothing pending, and is retried on the next poll", async () => {
    await withFixtureRepo("inject failed", async (root) => {
      const { script, log } = fakeClaude(root);
      const env = {
        ...baseEnv(),
        NIGHT_LOOP_CLAUDE_BIN: process.execPath,
        NIGHT_LOOP_CLAUDE_SHIM: script,
        FAKE_CLAUDE_LOG: log,
        FAKE_AGENTS_JSON: JSON.stringify([{ id: "d4e5f79a", sessionId: SESSION_UUID, name: "night-loop", state: "working", status: "busy" }]),
      };
      seedHarness(root, false);
      await cli(root, env, "setup", "--goal", "Claude inject failure");
      await cli(root, env, "start");
      for (let turn = 0; turn < 3; turn += 1) {
        const hook = Bun.spawn([process.execPath, LOOP_HOOK], {
          cwd: root,
          env: { ...process.env, CLAUDE_PROJECT_DIR: root, NIGHT_LOOP_MAX_STEPS: "2000" },
          stdin: "pipe",
          stdout: "pipe",
        });
        hook.stdin.write("{}");
        hook.stdin.end();
        expect(await new Response(hook.stdout).text()).toContain("Ratchet is RED");
      }
      await once(root, { ...env, FAKE_RESUME_EXIT: "7" });
      let events = await tape(root);
      expect(events).toContain('"type":"think.inject_failed"');
      expect(events).toContain('"exitCode":7');
      expect(events).not.toContain('"type":"think.injected"');
      expect(readJsonFile<{ pendingThink?: unknown }>(statePath(root, "run.json")).pendingThink).toBeUndefined();
      expect((await calls(log)).at(-1)!.args.slice(0, 2)).toEqual(["--resume", SESSION_UUID]);
      // The same evidence is still there, so the next healthy poll delivers the think turn.
      await once(root, env);
      events = await tape(root);
      expect(events.split('"type":"stuck.detected"').length - 1).toBe(2);
      expect(events).toContain('"type":"think.injected"');
      expect(readJsonFile<{ pendingThink: { episode: number; injectedStep: number } }>(statePath(root, "run.json")).pendingThink)
        .toMatchObject({ episode: 2, injectedStep: 3 });
    });
  }, 60000);

  test("a Claude session whose steps advance without changing the tree is stuck as no_progress", async () => {
    await withFixtureRepo("claude tree", async (root) => {
      const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
      expect((await runCommand(["git", "init", "-q"], { cwd: root, env: gitEnv })).exitCode).toBe(0);
      seedHarness(root, true);
      atomicWriteFile(join(root, ".gitignore"), ".night-loop/state/\n*.jsonl\n");
      await runCommand(["git", "add", "-A"], { cwd: root, env: gitEnv });
      await runCommand(["git", "commit", "-q", "-m", "seed"], { cwd: root, env: gitEnv });
      const { script, log } = fakeClaude(root);
      const env = {
        ...baseEnv(),
        NIGHT_LOOP_CLAUDE_BIN: process.execPath,
        NIGHT_LOOP_CLAUDE_SHIM: script,
        FAKE_CLAUDE_LOG: log,
        FAKE_AGENTS_JSON: JSON.stringify([{ id: "d4e5f79a", sessionId: SESSION_UUID, name: "night-loop", state: "working", status: "busy" }]),
      };
      await cli(root, env, "setup", "--goal", "Claude idle tree");
      await cli(root, env, "start");
      // Steps advance (the Stop hook ran) but the tree never changes.
      for (let step = 1; step <= 3; step += 1) {
        atomicWriteFile(statePath(root, "STEP"), `${step}\n`);
        await once(root, env);
      }
      let events = await tape(root);
      expect(events).toContain('"reason":"no_progress"');
      expect(events).toContain('"type":"think.injected"');
      expect((await calls(log)).at(-1)!.args.at(-1)).toContain("working tree unchanged for 3 turns");
      // A tree that changes between steps is never called stuck.
      await withFixtureRepo("claude busy tree", async (busyRoot) => {
        expect((await runCommand(["git", "init", "-q"], { cwd: busyRoot, env: gitEnv })).exitCode).toBe(0);
        seedHarness(busyRoot, true);
        atomicWriteFile(join(busyRoot, ".gitignore"), ".night-loop/state/\n*.jsonl\n");
        await runCommand(["git", "add", "-A"], { cwd: busyRoot, env: gitEnv });
        await runCommand(["git", "commit", "-q", "-m", "seed"], { cwd: busyRoot, env: gitEnv });
        const busy = fakeClaude(busyRoot);
        const busyEnv = { ...env, NIGHT_LOOP_CLAUDE_SHIM: busy.script, FAKE_CLAUDE_LOG: busy.log };
        await cli(busyRoot, busyEnv, "setup", "--goal", "Claude busy tree");
        await cli(busyRoot, busyEnv, "start");
        for (let step = 1; step <= 4; step += 1) {
          atomicWriteFile(statePath(busyRoot, "STEP"), `${step}\n`);
          atomicWriteFile(join(busyRoot, "work.txt"), `step ${step}\n`);
          await once(busyRoot, busyEnv);
        }
        events = await tape(busyRoot);
        expect(events).not.toContain('"type":"stuck.detected"');
      });
    });
  }, 90000);

  test("a stuck Claude session receives the think prompt through native resume and completes on STEP progress", async () => {
    await withFixtureRepo("think claude", async (root) => {
      const { script, log } = fakeClaude(root);
      const env = {
        ...baseEnv(),
        NIGHT_LOOP_CLAUDE_BIN: process.execPath,
        NIGHT_LOOP_CLAUDE_SHIM: script,
        FAKE_CLAUDE_LOG: log,
        FAKE_AGENTS_JSON: JSON.stringify([{ id: "d4e5f79a", sessionId: SESSION_UUID, name: "night-loop", state: "working", status: "busy" }]),
      };
      seedHarness(root, false);
      await cli(root, env, "setup", "--goal", "Claude stuck");
      await cli(root, env, "start");
      for (let turn = 0; turn < 3; turn += 1) {
        const hook = Bun.spawn([process.execPath, LOOP_HOOK], {
          cwd: root,
          env: { ...process.env, CLAUDE_PROJECT_DIR: root, NIGHT_LOOP_MAX_STEPS: "2000" },
          stdin: "pipe",
          stdout: "pipe",
        });
        hook.stdin.write("{}");
        hook.stdin.end();
        expect(await new Response(hook.stdout).text()).toContain("Ratchet is RED");
      }
      await once(root, env);
      const injected = (await calls(log)).at(-1)!;
      expect(injected.args.slice(0, 2)).toEqual(["--resume", SESSION_UUID]);
      expect(injected.args).toContain("--bg");
      expect(injected.args.at(-1)).toContain("THINK TURN");
      expect(injected.args.at(-1)).toContain("seed check");
      let events = await tape(root);
      expect(events).toContain('"type":"think.injected"');
      expect(readJsonFile<{ pendingThink: { injectedStep: number } }>(statePath(root, "run.json")).pendingThink.injectedStep).toBe(3);
      await once(root, env);
      events = await tape(root);
      expect(events.split('"type":"think.injected"').length - 1).toBe(1);
      // No STEP progress yet, so the think turn is still pending.
      expect(events).not.toContain('"type":"think.completed"');
      expect(readJsonFile<{ pendingThink?: unknown }>(statePath(root, "run.json")).pendingThink).toBeDefined();
      atomicWriteFile(statePath(root, "STEP"), "5\n");
      await once(root, env);
      events = await tape(root);
      expect(events).toContain('"type":"think.completed"');
      expect(readJsonFile<{ pendingThink?: unknown }>(statePath(root, "run.json")).pendingThink).toBeUndefined();
      expect(await Bun.file(join(root, ".night-loop", "lessons.md")).text()).toContain("delivered to claude at step 3");
      // Resume prompts now carry the lessons.
      await cli(root, env, "stop");
      await cli(root, env, "resume");
      expect((await calls(log)).at(-1)!.args.at(-1)).toContain("Lessons recorded so far:");
    });
  }, 60000);
});
