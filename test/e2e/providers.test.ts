import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFile, isUuid, processAlive, readJsonFile, runCommand, withFixtureRepo } from "../../src/core";

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
const PRODUCT_ROOT = join(import.meta.dir, "..", "..");
const BRIDGE = join(PRODUCT_ROOT, "src", "hook-bridge.ts");
const LOOP_HOOK = join(PRODUCT_ROOT, ".night-loop", "hooks", "loop.ts");
const THREAD_ID = "01a15613-9c83-7521-b8c5-61183e2d5801";
const GROK_ID = "01a15614-ba03-7991-8810-b82b0c7dad2c";

interface Call { args: string[]; secretPresent: boolean }

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

// The seeded harness: one hard-tier command that passes, plus the advisory layers the
// full harness runs after CLAIM_DONE.
function seedHarness(root: string): void {
  atomicWriteFile(join(root, "pass.ts"), "process.exit(0);\n");
  atomicWriteFile(join(root, "package.json"), `${JSON.stringify({
    scripts: { "test:screenshot": "bun pass.ts", perf: "bun pass.ts" },
  }, null, 2)}\n`);
  atomicWriteFile(join(root, ".night-loop", "ratchet.json"), `${JSON.stringify({
    hard: [{ display: "seed pass", argv: ["bun", "pass.ts"] }],
    acceptedE2e: [],
  }, null, 2)}\n`);
}

// Fake Codex: records argv and the credential environment, then emits the exec JSONL
// stream probed on 2026-10-19 (thread.started, agent_message, turn.completed).
function fakeCodex(root: string): { script: string; log: string } {
  const script = join(root, "fake codex Ω.ts");
  const log = join(root, "codex calls.jsonl");
  atomicWriteFile(script, [
    "import { appendFileSync } from 'node:fs';",
    "const args = Bun.argv.slice(2);",
    "const secretPresent = Boolean(process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY || process.env.ANTHROPIC_API_KEY);",
    "appendFileSync(process.env.FAKE_CODEX_LOG!, JSON.stringify({ args, secretPresent }) + '\\n');",
    "if (args.includes('--version')) { console.log(process.env.FAKE_CODEX_VERSION || 'codex-cli 0.162.0'); process.exit(0); }",
    "if (args[0] === 'login') { console.log('Logged in using ChatGPT'); process.exit(0); }",
    `console.log(JSON.stringify({ type: 'thread.started', thread_id: '${THREAD_ID}' }));`,
    "console.log(JSON.stringify({ type: 'turn.started' }));",
    "if (process.env.FAKE_SLEEP_MS) await Bun.sleep(Number(process.env.FAKE_SLEEP_MS));",
    "if (process.env.FAKE_EXIT_CODE) { console.error('seeded provider failure'); process.exit(Number(process.env.FAKE_EXIT_CODE)); }",
    "console.log(JSON.stringify({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: process.env.FAKE_MESSAGE || 'Implemented the next step.' } }));",
    "console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }));",
    "",
  ].join("\n"));
  return { script, log };
}

// Fake Grok: records argv and emits the headless JSON object probed on 2026-10-19.
function fakeGrok(root: string): { script: string; log: string } {
  const script = join(root, "fake grok Ω.ts");
  const log = join(root, "grok calls.jsonl");
  atomicWriteFile(script, [
    "import { appendFileSync } from 'node:fs';",
    "const args = Bun.argv.slice(2);",
    "const secretPresent = Boolean(process.env.XAI_API_KEY || process.env.GROK_API_KEY || process.env.ANTHROPIC_API_KEY);",
    "appendFileSync(process.env.FAKE_GROK_LOG!, JSON.stringify({ args, secretPresent }) + '\\n');",
    "if (args.includes('--version')) { console.log(process.env.FAKE_GROK_VERSION || 'grok 1.0.46 (2765805b9442) [stable]'); process.exit(0); }",
    "const created = args[args.indexOf('--session-id') + 1];",
    "const resumed = args[args.indexOf('--resume') + 1];",
    `const sessionId = args.includes('--resume') ? resumed : args.includes('--session-id') ? created : '${GROK_ID}';`,
    "if (process.env.FAKE_EXIT_CODE) { console.error('seeded provider failure'); process.exit(Number(process.env.FAKE_EXIT_CODE)); }",
    "console.log(JSON.stringify({ text: process.env.FAKE_MESSAGE || 'Implemented the next step.', stopReason: 'end_turn', sessionId, num_turns: 1 }, null, 2));",
    "",
  ].join("\n"));
  return { script, log };
}

function providerEnv(provider: "codex" | "grok", script: string, log: string): Record<string, string> {
  const upper = provider.toUpperCase();
  return {
    [`NIGHT_LOOP_${upper}_BIN`]: process.execPath,
    [`NIGHT_LOOP_${upper}_SHIM`]: script,
    [`FAKE_${upper}_LOG`]: log,
    NIGHT_LOOP_NOW: "2026-10-19T22:00:00.000Z",
    NIGHT_LOOP_DISABLE_WATCH: "1",
    NIGHT_LOOP_TEST_BACKOFF_MS: "0",
    NIGHT_LOOP_POLL_MS: "50",
    NIGHT_LOOP_STALL_TICKS: "4",
    OPENAI_API_KEY: "must-not-reach-child",
    CODEX_API_KEY: "must-not-reach-child",
    XAI_API_KEY: "must-not-reach-child",
    GROK_API_KEY: "must-not-reach-child",
    ANTHROPIC_API_KEY: "must-not-reach-child",
  };
}

async function cli(root: string, env: Record<string, string>, ...args: string[]) {
  return runCommand([process.execPath, CLI, ...args, "--repo", root], { cwd: root, env });
}

describe("provider-neutral turn supervisor (M8)", () => {
  test("setup records the provider, start keeps it, and an unknown provider is rejected before any launch", async () => {
    await withFixtureRepo("provider contract", async (root) => {
      const { script, log } = fakeCodex(root);
      const env = providerEnv("codex", script, log);
      const rejected = await cli(root, env, "setup", "--goal", "Nope", "--provider", "nope");
      expect(rejected.exitCode).toBe(2);
      expect(JSON.parse(rejected.stderr)).toMatchObject({ status: "invalid_arguments" });
      expect(existsSync(statePath(root, "contract.json"))).toBe(false);
      for (const provider of ["claude", "grok", "codex"]) {
        expect((await cli(root, env, "setup", "--goal", "Codex night", "--provider", provider)).exitCode).toBe(0);
        expect(readJsonFile<{ provider: string }>(statePath(root, "contract.json")).provider).toBe(provider);
      }
      const started = await cli(root, env, "start");
      expect(started.exitCode).toBe(0);
      expect(JSON.parse(started.stdout)).toMatchObject({ status: "running", provider: "codex", nativeSessionId: null });
      // The turn runs in the detached supervisor, never inside the start command.
      expect(await calls(log)).toEqual([]);
      expect(await Bun.file(statePath(root, "NEXT_PROMPT")).text()).toContain("Goal: Codex night");
    });
  });

  test("one seeded Codex turn records the thread id, runs the verifier, and persists its block reason as the next prompt", async () => {
    await withFixtureRepo("codex turn", async (root) => {
      const { script, log } = fakeCodex(root);
      const env = providerEnv("codex", script, log);
      seedHarness(root);
      const goal = "Handle spaces ' quotes \" Ω ; $(never-run) `backtick`";
      await cli(root, env, "setup", "--goal", goal, "--provider", "codex");
      await cli(root, env, "start");
      expect((await cli(root, env, "_supervise", "--once")).exitCode).toBe(0);
      const run = readJsonFile<{ nativeSessionId: string; sessionEstablished: boolean; turns: number }>(statePath(root, "run.json"));
      expect(run).toMatchObject({ nativeSessionId: THREAD_ID, sessionEstablished: true, turns: 1 });
      const events = await tape(root);
      for (const type of ["turn.started", "turn.session", "turn.completed", "stop.continued", "turn.next_prompt"]) {
        expect(events).toContain(`"type":"${type}"`);
      }
      const next = await Bun.file(statePath(root, "NEXT_PROMPT")).text();
      expect(next).toContain("Ratchet green");
      const first = (await calls(log)).at(-1)!;
      expect(first.secretPresent).toBe(false);
      expect(first.args.slice(0, 2)).toEqual(["exec", "--json"]);
      expect(first.args[first.args.indexOf("--sandbox") + 1]).toBe("workspace-write");
      expect(first.args).toContain('approval_policy="never"');
      expect(first.args).toContain("--dangerously-bypass-hook-trust");
      expect(first.args).toContain("features.multi_agent=false");
      expect(first.args.at(-1)).toContain(`Goal: ${goal}`);
      // The persisted prompt is the verifier's exact block reason, not a paraphrase: the
      // direct Stop hook on the same repository yields the same text (step number aside).
      const direct = Bun.spawn([process.execPath, LOOP_HOOK], {
        cwd: root,
        env: { ...process.env, CLAUDE_PROJECT_DIR: root, NIGHT_LOOP_MAX_STEPS: "2000" },
        stdin: "pipe",
        stdout: "pipe",
      });
      direct.stdin.write("{}");
      direct.stdin.end();
      const directReason = (JSON.parse(await new Response(direct.stdout).text()) as { reason: string }).reason;
      const stepless = (text: string) => text.replace(/step \d+\/\d+/, "step N");
      expect(stepless(next)).toBe(stepless(directReason));
      const overrides = first.args.filter((arg) => arg.startsWith("hooks."));
      expect(overrides.some((arg) => arg.startsWith("hooks.PreToolUse=") && arg.includes("hook-bridge.ts") && arg.includes("gate --provider codex"))).toBe(true);
      expect(overrides.some((arg) => arg.startsWith("hooks.Stop=") && arg.includes("loop --provider codex") && arg.includes("timeout=1800"))).toBe(true);
      expect(overrides.some((arg) => arg.startsWith("hooks.SessionStart=") && arg.includes("resume --provider codex"))).toBe(true);
      expect(first.args).not.toContain("resume");
      expect((await cli(root, env, "_supervise", "--once")).exitCode).toBe(0);
      const second = (await calls(log)).at(-1)!.args;
      const resumeIndex = second.indexOf("resume");
      expect(resumeIndex).toBeGreaterThan(0);
      expect(second[resumeIndex + 1]).toBe(THREAD_ID);
      expect(second[resumeIndex + 2]).toBe(next);
    });
  });

  test("full maps Codex to danger-full-access with approval never and the same hook overrides", async () => {
    await withFixtureRepo("codex full", async (root) => {
      const { script, log } = fakeCodex(root);
      const env = providerEnv("codex", script, log);
      seedHarness(root);
      await cli(root, env, "setup", "--goal", "Full Ω", "--provider", "codex");
      expect((await cli(root, env, "full")).exitCode).toBe(0);
      await cli(root, env, "_supervise", "--once");
      const call = (await calls(log)).at(-1)!;
      expect(call.args[call.args.indexOf("--sandbox") + 1]).toBe("danger-full-access");
      expect(call.args).toContain('approval_policy="never"');
      expect(call.args.some((arg) => arg.startsWith("hooks.PreToolUse="))).toBe(true);
      expect(call.secretPresent).toBe(false);
    });
  });

  test("CLAIM_DONE with a green full harness halts as done and no further turn is launched", async () => {
    await withFixtureRepo("codex done", async (root) => {
      const { script, log } = fakeCodex(root);
      const env = providerEnv("codex", script, log);
      seedHarness(root);
      await cli(root, env, "setup", "--goal", "Finish", "--provider", "codex");
      await cli(root, env, "start");
      atomicWriteFile(statePath(root, "CLAIM_DONE"), "");
      expect((await cli(root, env, "_supervise", "--once")).exitCode).toBe(0);
      expect((await Bun.file(statePath(root, "HALTED")).text()).trim()).toBe("done");
      expect(readJsonFile<{ status: string }>(statePath(root, "run.json")).status).toBe("done");
      expect(existsSync(statePath(root, "ACTIVE"))).toBe(false);
      expect((await calls(log)).length).toBe(1);
      expect((await cli(root, env, "_supervise", "--once")).exitCode).toBe(0);
      expect((await calls(log)).length).toBe(1);
      const events = await tape(root);
      expect(events).toContain('"type":"run.halted"');
      expect(events).toContain('"type":"supervisor.halted"');
    });
  });

  test("a non-zero provider exit relaunches with resume and deterministic backoff, then halts as budget", async () => {
    await withFixtureRepo("codex relaunch", async (root) => {
      const { script, log } = fakeCodex(root);
      const env = { ...providerEnv("codex", script, log), FAKE_EXIT_CODE: "3" };
      seedHarness(root);
      await cli(root, env, "setup", "--goal", "Bounded", "--provider", "codex", "--max-relaunches", "1");
      await cli(root, env, "start");
      expect((await cli(root, env, "_supervise", "--once")).exitCode).toBe(0);
      expect(readJsonFile<{ relaunches: number }>(statePath(root, "supervisor.json")).relaunches).toBe(1);
      let events = await tape(root);
      expect(events).toContain('"type":"turn.failed"');
      expect(events).toContain('"reason":"provider_exit"');
      expect(events).toContain('"backoffSeconds":20');
      expect((await cli(root, env, "_supervise", "--once")).exitCode).toBe(0);
      const second = (await calls(log)).at(-1)!.args;
      expect(second[second.indexOf("resume") + 1]).toBe(THREAD_ID);
      expect(readJsonFile<{ status: string }>(statePath(root, "run.json")).status).toBe("budget");
      expect((await Bun.file(statePath(root, "HALTED")).text()).trim()).toBe("budget");
      expect(existsSync(statePath(root, "ACTIVE"))).toBe(false);
      events = await tape(root);
      expect(events).toContain('"type":"supervisor.exhausted"');
      expect(events).not.toContain("must-not-reach-child");
    });
  });

  test("a stalled turn is killed, counted as a relaunch, and resumed", async () => {
    await withFixtureRepo("codex stall", async (root) => {
      const { script, log } = fakeCodex(root);
      const env = { ...providerEnv("codex", script, log), FAKE_SLEEP_MS: "20000", NIGHT_LOOP_STALL_TICKS: "3" };
      seedHarness(root);
      await cli(root, env, "setup", "--goal", "Stall", "--provider", "codex");
      await cli(root, env, "start");
      const supervised = await cli(root, env, "_supervise", "--once");
      expect(supervised.exitCode).toBe(0);
      const events = await tape(root);
      expect(events).toContain('"killed":"stalled"');
      expect(events).toContain('"reason":"stalled"');
      expect(existsSync(statePath(root, "PROVIDER_PID"))).toBe(false);
      expect(readJsonFile<{ nativeSessionId: string }>(statePath(root, "run.json")).nativeSessionId).toBe(THREAD_ID);
    });
  }, 20000);

  test("stop kills the provider tree and supervisor, and resume relaunches the same provider without upgrading", async () => {
    await withFixtureRepo("codex stop resume", async (root) => {
      const { script, log } = fakeCodex(root);
      // The stall watchdog must not fire here (it would kill and relaunch the turn on its
      // own); only stop may end this turn.
      const env: Record<string, string> = { ...providerEnv("codex", script, log), FAKE_SLEEP_MS: "60000", NIGHT_LOOP_STALL_TICKS: "1000000" };
      delete env.NIGHT_LOOP_DISABLE_WATCH;
      seedHarness(root);
      await cli(root, env, "setup", "--goal", "Stop tree", "--provider", "codex", "--permissions", "full", "--workers", "3", "--max-steps", "91");
      expect((await cli(root, env, "full")).exitCode).toBe(0);
      // Wait on state, not time: the turn is live once its pid is recorded and the streamed
      // thread id has reached run.json.
      let providerPid = 0;
      for (let attempt = 0; attempt < 400 && !providerPid; attempt += 1) {
        const streamed = existsSync(statePath(root, "run.json"))
          && readJsonFile<{ nativeSessionId?: string }>(statePath(root, "run.json")).nativeSessionId === THREAD_ID;
        if (streamed && existsSync(statePath(root, "PROVIDER_PID"))) {
          providerPid = Number((await Bun.file(statePath(root, "PROVIDER_PID")).text()).trim());
        } else {
          await Bun.sleep(25);
        }
      }
      expect(providerPid).toBeGreaterThan(0);
      expect(processAlive(providerPid)).toBe(true);
      const supervisorPid = Number((await Bun.file(statePath(root, "SUPERVISOR_PID")).text()).trim());
      const stopped = await cli(root, env, "stop");
      expect(stopped.exitCode).toBe(0);
      expect(JSON.parse(stopped.stdout)).toMatchObject({ status: "stopped", provider: "codex", nativeSessionId: THREAD_ID });
      expect(processAlive(providerPid)).toBe(false);
      expect(processAlive(supervisorPid)).toBe(false);
      expect(existsSync(statePath(root, "PROVIDER_PID"))).toBe(false);
      expect(existsSync(statePath(root, "SUPERVISOR_PID"))).toBe(false);
      expect(existsSync(statePath(root, "ACTIVE"))).toBe(false);
      expect(await tape(root)).toContain('"type":"provider.terminated"');
      await cli(root, env, "setup", "--goal", "Attended upgrade attempt", "--provider", "codex", "--permissions", "workspace", "--workers", "1", "--max-steps", "9");
      const resumed = await cli(root, { ...env, NIGHT_LOOP_DISABLE_WATCH: "1" }, "resume");
      expect(resumed.exitCode).toBe(0);
      expect(JSON.parse(resumed.stdout)).toMatchObject({
        status: "running",
        provider: "codex",
        permissions: "full",
        limits: { workers: 3, maxSteps: 91 },
        nativeSessionId: THREAD_ID,
      });
      expect(existsSync(statePath(root, "ACTIVE"))).toBe(true);
      expect(await tape(root)).toContain('"type":"run.resumed"');
      await cli(root, { ...env, NIGHT_LOOP_DISABLE_WATCH: "1", FAKE_SLEEP_MS: "0" }, "_supervise", "--once");
      const call = (await calls(log)).at(-1)!.args;
      expect(call[call.indexOf("--sandbox") + 1]).toBe("danger-full-access");
      expect(call[call.indexOf("resume") + 1]).toBe(THREAD_ID);
      // The in-turn Stop hook enforces the armed step limit (91), not the re-setup's (9):
      // at STEP 50 it must keep blocking, never halt as budget.
      atomicWriteFile(statePath(root, "STEP"), "50\n");
      const bridged = Bun.spawn([process.execPath, BRIDGE, "loop", "--provider", "codex"], {
        cwd: root,
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
        stdin: "pipe",
        stdout: "pipe",
      });
      bridged.stdin.write(JSON.stringify({ hook_event_name: "Stop", stop_hook_active: false }));
      bridged.stdin.end();
      const verdict = JSON.parse(await new Response(bridged.stdout).text()) as { decision: string; reason: string };
      expect(verdict.decision).toBe("block");
      expect(verdict.reason).toContain("step 51/91");
      expect(existsSync(statePath(root, "HALTED"))).toBe(false);
    });
  }, 30000);

  test("resume keeps the armed Codex worker cap when a later setup raises it", async () => {
    await withFixtureRepo("codex worker cap", async (root) => {
      const { script, log } = fakeCodex(root);
      const env = providerEnv("codex", script, log);
      seedHarness(root);
      await cli(root, env, "setup", "--goal", "Workers", "--provider", "codex", "--workers", "1");
      await cli(root, env, "start");
      await cli(root, env, "_supervise", "--once");
      expect((await calls(log)).at(-1)!.args).toContain("features.multi_agent=false");
      await cli(root, env, "stop");
      await cli(root, env, "setup", "--goal", "Workers", "--provider", "codex", "--workers", "8");
      expect((await cli(root, env, "resume")).exitCode).toBe(0);
      await cli(root, env, "_supervise", "--once");
      const resumed = (await calls(log)).at(-1)!.args;
      expect(resumed).toContain("features.multi_agent=false");
      expect(resumed.some((arg) => arg.startsWith("agents.max_concurrent_threads_per_session="))).toBe(false);
      // Resume wrote the armed contract back, so the on-disk file the gate reads says 1 again.
      expect(readJsonFile<{ limits: { workers: number } }>(statePath(root, "run.json")).limits.workers).toBe(1);
      expect(readJsonFile<{ limits: { workers: number } }>(statePath(root, "contract.json")).limits.workers).toBe(1);
      expect(await tape(root)).toContain('"type":"contract.restored"');
    });
  });

  test("a verifier that prints nothing halts the run instead of launching an unverified turn", async () => {
    await withFixtureRepo("codex verifier crash", async (root) => {
      const { script, log } = fakeCodex(root);
      const env = providerEnv("codex", script, log);
      seedHarness(root);
      atomicWriteFile(join(root, ".night-loop", "ratchet.json"), "{ not json\n");
      await cli(root, env, "setup", "--goal", "Crash", "--provider", "codex");
      await cli(root, env, "start");
      expect((await cli(root, env, "_supervise", "--once")).exitCode).toBe(0);
      expect((await Bun.file(statePath(root, "HALTED")).text()).trim()).toBe("verifier_failed");
      expect(existsSync(statePath(root, "ACTIVE"))).toBe(false);
      expect(await tape(root)).toContain('"type":"supervisor.verifier_failed"');
      expect((await cli(root, env, "_supervise", "--once")).exitCode).toBe(0);
      expect((await calls(log)).length).toBe(1);
    });
  });

  test("a question in the final message is recorded and the loop continues; five in a row halt as interaction_required", async () => {
    await withFixtureRepo("codex question", async (root) => {
      const { script, log } = fakeCodex(root);
      const env = { ...providerEnv("codex", script, log), FAKE_MESSAGE: "Should I proceed with the migration? Please confirm." };
      seedHarness(root);
      await cli(root, env, "setup", "--goal", "Questions", "--provider", "codex");
      await cli(root, env, "start");
      expect((await cli(root, env, "_supervise", "--once")).exitCode).toBe(0);
      let events = await tape(root);
      expect(events).toContain('"source":"turn_output"');
      expect(events).toContain('"consecutive":1');
      expect(events).toContain('"type":"turn.next_prompt"');
      expect(existsSync(statePath(root, "ACTIVE"))).toBe(true);
      for (let turn = 2; turn <= 5; turn += 1) {
        expect((await cli(root, env, "_supervise", "--once")).exitCode).toBe(0);
      }
      expect((await Bun.file(statePath(root, "HALTED")).text()).trim()).toBe("interaction_required");
      expect(readJsonFile<{ status: string }>(statePath(root, "run.json")).status).toBe("interaction_required");
      expect(existsSync(statePath(root, "ACTIVE"))).toBe(false);
      events = await tape(root);
      expect(events).toContain('"type":"supervisor.interaction_loop"');
      expect((await calls(log)).length).toBe(5);
    });
  }, 20000);
});

describe("Grok adapter and hook bridge (M9)", () => {
  test("workspace maps Grok to dontAsk with allow and deny rules, a pre-assigned session id, and resume on the next turn", async () => {
    await withFixtureRepo("grok argv", async (root) => {
      const { script, log } = fakeGrok(root);
      const env = providerEnv("grok", script, log);
      seedHarness(root);
      const goal = "Grok ' quotes \" Ω ; $(never-run)";
      await cli(root, env, "setup", "--goal", goal, "--provider", "grok");
      await cli(root, env, "start");
      expect((await cli(root, env, "_supervise", "--once")).exitCode).toBe(0);
      const first = (await calls(log)).at(-1)!;
      expect(first.secretPresent).toBe(false);
      expect(first.args[0]).toBe("-p");
      expect(first.args[1]).toContain(`Goal: ${goal}`);
      expect(first.args[first.args.indexOf("--permission-mode") + 1]).toBe("dontAsk");
      expect(first.args[first.args.indexOf("--output-format") + 1]).toBe("json");
      expect(first.args[first.args.indexOf("--cwd") + 1]).toBe(root);
      for (const flag of ["--trust", "--no-plan", "--disable-web-search", "--no-subagents"]) expect(first.args).toContain(flag);
      expect(first.args[first.args.indexOf("--max-turns") + 1]).toBe("100");
      const allowed = first.args.flatMap((arg, index) => (arg === "--allow" ? [first.args[index + 1]] : []));
      expect(allowed).toEqual(expect.arrayContaining(["Read", "Edit", "Write", "Bash"]));
      const denied = first.args.flatMap((arg, index) => (arg === "--deny" ? [first.args[index + 1]] : []));
      expect(denied).toEqual(expect.arrayContaining(["Bash(git push *)", "Bash(npm publish *)"]));
      const created = first.args[first.args.indexOf("--session-id") + 1]!;
      expect(isUuid(created)).toBe(true);
      expect(first.args).not.toContain("--resume");
      const run = readJsonFile<{ nativeSessionId: string; sessionEstablished: boolean }>(statePath(root, "run.json"));
      expect(run).toMatchObject({ nativeSessionId: created, sessionEstablished: true });
      expect((await cli(root, env, "_supervise", "--once")).exitCode).toBe(0);
      const second = (await calls(log)).at(-1)!.args;
      expect(second[second.indexOf("--resume") + 1]).toBe(created);
      expect(second).not.toContain("--session-id");
      expect(second[1]).toContain("Ratchet green");
    });
  });

  test("full maps Grok to bypassPermissions with the same deny rules and no allow list", async () => {
    await withFixtureRepo("grok full", async (root) => {
      const { script, log } = fakeGrok(root);
      const env = providerEnv("grok", script, log);
      seedHarness(root);
      await cli(root, env, "setup", "--goal", "Grok full", "--provider", "grok", "--workers", "auto");
      expect((await cli(root, env, "full")).exitCode).toBe(0);
      await cli(root, env, "_supervise", "--once");
      const call = (await calls(log)).at(-1)!.args;
      expect(call[call.indexOf("--permission-mode") + 1]).toBe("bypassPermissions");
      expect(call).not.toContain("--allow");
      expect(call).not.toContain("--no-subagents");
      const denied = call.flatMap((arg, index) => (arg === "--deny" ? [call[index + 1]] : []));
      expect(denied).toEqual(["Bash(git push *)", "Bash(npm publish *)", "Bash(bun publish *)", "Bash(rm -rf *)"]);
    });
  });

  async function bridge(root: string, hook: string, provider: string, payload: Record<string, unknown>) {
    const child = Bun.spawn([process.execPath, BRIDGE, hook, "--provider", provider], {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, exitCode };
  }

  test("the bridge rewrites Grok and Codex tool payloads so the unchanged gate denies escapes and flags security surfaces", async () => {
    await withFixtureRepo("bridge gate", async (root) => {
      const push = await bridge(root, "gate", "grok", {
        hookEventName: "pre_tool_use",
        hook_event_name: "PreToolUse",
        toolName: "run_terminal_command",
        tool_name: "run_terminal_command",
        tool_input: { command: "git push origin main" },
      });
      expect(push.exitCode).toBe(0);
      expect(JSON.parse(push.stdout)).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
      const edit = await bridge(root, "gate", "grok", {
        hook_event_name: "PreToolUse",
        tool_name: "search_replace",
        tool_input: { file_path: join(root, "src", "auth", "login.ts"), old_string: "", new_string: "x" },
      });
      const decision = JSON.parse(edit.stdout) as { hookSpecificOutput: { permissionDecision: string; additionalContext: string } };
      expect(decision.hookSpecificOutput.permissionDecision).toBe("allow");
      expect(decision.hookSpecificOutput.additionalContext).toContain("Security-surface");
      const patch = await bridge(root, "gate", "codex", {
        hook_event_name: "PreToolUse",
        tool_name: "apply_patch",
        tool_input: { command: "*** Begin Patch\n*** Add File: src/billing/stripe.ts\n+export {}\n*** Update File: README.md\n@@\n-a\n+b\n*** End Patch" },
      });
      const patched = JSON.parse(patch.stdout) as { hookSpecificOutput: { permissionDecision: string; additionalContext: string } };
      expect(patched.hookSpecificOutput.permissionDecision).toBe("allow");
      expect(patched.hookSpecificOutput.additionalContext).toContain("src/billing/stripe.ts");
      const escape = await bridge(root, "gate", "codex", {
        hook_event_name: "PreToolUse",
        tool_name: "apply_patch",
        tool_input: { command: "*** Begin Patch\n*** Add File: ../outside Ω.txt\n+x\n*** End Patch" },
      });
      expect(JSON.parse(escape.stdout)).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
      // Every touched path is gated, not only the first: an escape hidden behind an
      // ordinary path is still denied.
      const second = await bridge(root, "gate", "codex", {
        hook_event_name: "PreToolUse",
        tool_name: "apply_patch",
        tool_input: { command: "*** Begin Patch\n*** Add File: src/ok.ts\n+x\n*** Update File: ../../escape Ω.txt\n@@\n-a\n+b\n*** End Patch" },
      });
      expect(JSON.parse(second.stdout)).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
      const plain = await bridge(root, "gate", "grok", {
        hook_event_name: "PreToolUse",
        tool_name: "run_terminal_command",
        tool_input: { command: "bun test" },
      });
      expect(plain.stdout.trim()).toBe("");
      const review = await Bun.file(statePath(root, "REVIEW")).text();
      expect(review).toContain("login.ts");
      expect(review).toContain("stripe.ts");
      const events = await tape(root);
      expect(events).toContain('"category":"external_or_irreversible_action"');
      expect(events).toContain('"category":"control_plane_write"');
    });
  });

  test("start writes the Grok project hook file through the bridge, and the bridged Stop hook matches loop.ts", async () => {
    await withFixtureRepo("grok hooks", async (root) => {
      const { script, log } = fakeGrok(root);
      const env = providerEnv("grok", script, log);
      seedHarness(root);
      await cli(root, env, "setup", "--goal", "Hook file", "--provider", "grok");
      await cli(root, env, "start");
      const hookFile = join(root, ".grok", "hooks", "night-loop.json");
      const manifest = readJsonFile<{ hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string; timeout: number }> }>> }>(hookFile);
      const bindings: Record<string, string> = {
        PreToolUse: "gate",
        Stop: "loop",
        SessionStart: "resume",
        UserPromptSubmit: "events",
        Notification: "events",
        StopFailure: "events",
        SubagentStart: "events",
        SubagentStop: "events",
      };
      const bridgePath = BRIDGE.replaceAll("\\", "/");
      for (const [event, hook] of Object.entries(bindings)) {
        const handlers = (manifest.hooks[event] ?? []).flatMap((entry) => entry.hooks);
        expect(handlers.length).toBe(1);
        expect(handlers[0]!.command).toContain(`"${bridgePath}" ${hook} --provider grok`);
        // Grok's Windows hook runner is PowerShell: a quoted path only executes behind `&`.
        expect(handlers[0]!.command.startsWith("& ")).toBe(process.platform === "win32");
      }
      expect(manifest.hooks.Stop![0]!.hooks[0]!.timeout).toBe(1800);
      expect(manifest.hooks.PreToolUse![0]!.matcher).toContain("run_terminal_command");
      // Same seeded repository, same verdict: the bridge only translates.
      const bridged = await bridge(root, "loop", "grok", { hook_event_name: "Stop", reason: "end_turn", stopHookActive: false });
      const direct = Bun.spawn([process.execPath, LOOP_HOOK], {
        cwd: root,
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
        stdin: "pipe",
        stdout: "pipe",
      });
      direct.stdin.write("{}");
      direct.stdin.end();
      const directOut = await new Response(direct.stdout).text();
      const normalize = (text: string) => (JSON.parse(text) as { reason: string }).reason.replace(/step \d+\/\d+/, "step N");
      expect(normalize(bridged.stdout)).toBe(normalize(directOut));
      expect(normalize(bridged.stdout)).toContain("Ratchet green");
      const stepBefore = (await Bun.file(statePath(root, "STEP")).text()).trim();
      const shutdown = await bridge(root, "loop", "grok", { hook_event_name: "Stop", reason: "shutdown" });
      expect(shutdown.stdout.trim()).toBe("");
      expect((await Bun.file(statePath(root, "STEP")).text()).trim()).toBe(stepBefore);
    });
  });

  test("resume passes the recorded Grok session id and never upgrades the armed profile", async () => {
    await withFixtureRepo("grok resume", async (root) => {
      const { script, log } = fakeGrok(root);
      const env = providerEnv("grok", script, log);
      seedHarness(root);
      await cli(root, env, "setup", "--goal", "Grok resume", "--provider", "grok", "--workers", "1", "--max-steps", "40");
      await cli(root, env, "start");
      await cli(root, env, "_supervise", "--once");
      const sessionId = readJsonFile<{ nativeSessionId: string }>(statePath(root, "run.json")).nativeSessionId;
      expect(isUuid(sessionId)).toBe(true);
      expect((await cli(root, env, "stop")).exitCode).toBe(0);
      await cli(root, env, "setup", "--goal", "Upgrade attempt", "--provider", "grok", "--permissions", "full", "--workers", "8");
      const resumed = await cli(root, env, "resume");
      expect(resumed.exitCode).toBe(0);
      expect(JSON.parse(resumed.stdout)).toMatchObject({
        status: "running",
        provider: "grok",
        permissions: "workspace",
        limits: { workers: 1, maxSteps: 40 },
        nativeSessionId: sessionId,
      });
      await cli(root, env, "_supervise", "--once");
      const call = (await calls(log)).at(-1)!.args;
      expect(call[call.indexOf("--resume") + 1]).toBe(sessionId);
      expect(call[call.indexOf("--permission-mode") + 1]).toBe("dontAsk");
      expect(call).toContain("--no-subagents");
    });
  });

  test("a Grok run armed at two workers keeps its in-turn worker cap after a raised setup and resume", async () => {
    await withFixtureRepo("grok worker cap", async (root) => {
      const { script, log } = fakeGrok(root);
      const env = providerEnv("grok", script, log);
      seedHarness(root);
      await cli(root, env, "setup", "--goal", "Two workers", "--provider", "grok", "--workers", "2");
      await cli(root, env, "start");
      await cli(root, env, "_supervise", "--once");
      await cli(root, env, "stop");
      await cli(root, env, "setup", "--goal", "Two workers", "--provider", "grok", "--workers", "8");
      expect((await cli(root, env, "resume")).exitCode).toBe(0);
      expect(readJsonFile<{ limits: { workers: number } }>(statePath(root, "contract.json")).limits.workers).toBe(2);
      // Two subagents are already running; the third spawn must be denied by the unchanged gate.
      atomicWriteFile(statePath(root, "ACTIVE"), "run\n");
      for (let index = 0; index < 2; index += 1) {
        await bridge(root, "events", "grok", { hook_event_name: "SubagentStart", agent_id: `worker-${index}`, agent_type: "general-purpose" });
      }
      const spawn = await bridge(root, "gate", "grok", {
        hook_event_name: "PreToolUse",
        tool_name: "spawn_subagent",
        tool_input: { subagent_type: "general-purpose", prompt: "more" },
      });
      expect(JSON.parse(spawn.stdout)).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
      expect(spawn.stdout).toContain("worker cap is 2");
      const events = await tape(root);
      expect(events).toContain('"type":"contract.restored"');
      expect(events).toContain('"superseded":{"provider":"grok","permissions":"workspace","limits":{"maxSteps":2000,"maxRelaunches":20,"workers":8}');
    });
  });
});
