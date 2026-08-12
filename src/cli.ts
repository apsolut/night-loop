#!/usr/bin/env bun
import { join } from "node:path";
import { atomicWriteJson, isInteractionRequest, toRepoRelativePath } from "./core";

interface FixtureResult {
  status: "success" | "interaction_required";
  repo: string;
  payload: string;
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function fail(message: string): never {
  console.error(JSON.stringify({ status: "invalid_arguments", message }));
  process.exit(2);
}

const [command, ...args] = Bun.argv.slice(2);

if (command !== "fixture") {
  fail("Usage: night-loop fixture --repo <path> --payload <text> [--agent-output <text>]");
}

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
console.log(JSON.stringify(result));
if (result.status === "interaction_required") process.exit(42);
