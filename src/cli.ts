#!/usr/bin/env bun
import { join } from "node:path";
import { atomicWriteJson, isInteractionRequest, toRepoRelativePath } from "./core";
import {
  doctorNightLoop,
  morningReceipt,
  normalizeCommand,
  parseWorkers,
  publicState,
  repoContext,
  resumeNightLoop,
  startNightLoop,
  statusNightLoop,
  stopNightLoop,
  superviseNightLoop,
  writeContract,
  type PermissionProfile,
} from "./night-loop";
import { parseProvider } from "./providers";

interface FixtureResult {
  status: "success" | "interaction_required";
  repo: string;
  payload: string;
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function integerOption(args: string[], name: string, fallback: number): number {
  const raw = option(args, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function permissionOption(args: string[]): PermissionProfile | undefined {
  const value = option(args, "--permissions");
  if (value === undefined) return undefined;
  if (value !== "workspace" && value !== "full") throw new Error("--permissions must be workspace or full");
  return value;
}

function emit(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function fail(message: string, exitCode = 2): never {
  process.stderr.write(`${JSON.stringify({ status: "invalid_arguments", message })}\n`);
  process.exit(exitCode);
}

function help(): void {
  console.log([
    "NIGHT LOOP: a subscription coding agent does the work. NIGHT LOOP proves it was safe to leave alone and actually done.",
    "",
    "Commands:",
    "  night-loop setup --goal <text> [--provider claude|codex|grok] [--permissions workspace|full]",
    "                   [--workers 1|auto|N] [--model <id>] [--effort <level>] [--max-steps N] [--max-relaunches N]",
    "  night-loop start [--permissions workspace|full]",
    "  night-loop full",
    "  night-loop status",
    "  night-loop stop",
    "  night-loop resume",
    "  night-loop morning",
    "  night-loop doctor",
    "",
    "Only setup is attended. Every other command is noninteractive.",
  ].join("\n"));
}

async function fixture(args: string[]): Promise<void> {
  const repo = option(args, "--repo");
  const payload = option(args, "--payload");
  const agentOutput = option(args, "--agent-output") ?? "";
  if (!repo || payload === undefined) fail("Both --repo and --payload are required");
  const result: FixtureResult = {
    status: isInteractionRequest(agentOutput) ? "interaction_required" : "success",
    repo: toRepoRelativePath(repo, repo),
    payload,
  };
  atomicWriteJson(join(repo, ".night-loop", "state", "fixture.json"), result);
  emit(result);
  if (result.status === "interaction_required") process.exit(42);
}

async function main(): Promise<void> {
  const raw = Bun.argv.slice(2);
  const normalized = normalizeCommand(raw[0], raw.slice(1));
  const command = normalized.command;
  const args = normalized.args;
  if (command === "help" || command === "--help" || command === "-h") {
    help();
    return;
  }
  if (command === "fixture") {
    await fixture(args);
    return;
  }
  const repo = option(args, "--repo") ?? process.cwd();
  const context = repoContext(repo, { claudeBin: option(args, "--claude-bin") });

  if (command === "setup") {
    const goal = option(args, "--goal");
    if (goal === undefined) fail("setup requires --goal <text>");
    const contract = writeContract(context, {
      goal,
      provider: parseProvider(option(args, "--provider")),
      permissions: permissionOption(args),
      model: option(args, "--model"),
      effort: option(args, "--effort"),
      maxSteps: integerOption(args, "--max-steps", 2000),
      maxRelaunches: integerOption(args, "--max-relaunches", 20),
      workers: parseWorkers(option(args, "--workers")),
    });
    emit({ status: "configured", contract });
    return;
  }
  if (command === "start") {
    const state = await startNightLoop(context, permissionOption(args) ?? "workspace");
    emit(publicState(state));
    if (state.status === "provider_error") process.exitCode = 70;
    return;
  }
  if (command === "status") {
    emit(await statusNightLoop(context, { logs: true }));
    return;
  }
  if (command === "stop") {
    emit(publicState(await stopNightLoop(context)));
    return;
  }
  if (command === "resume") {
    const state = await resumeNightLoop(context);
    emit(publicState(state));
    if (state.status === "provider_error") process.exitCode = 70;
    return;
  }
  if (command === "morning") {
    emit(morningReceipt(context));
    return;
  }
  if (command === "doctor") {
    const report = await doctorNightLoop(context);
    emit(report);
    if (report.status !== "green") process.exitCode = 1;
    return;
  }
  if (command === "_supervise") {
    await superviseNightLoop(context, { once: args.includes("--once") });
    return;
  }
  fail(`Unknown command: ${command}`);
}

try {
  await main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
