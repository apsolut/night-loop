import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  ALL_SECRET_ENV,
  PLUGIN_ROOT,
  bridgeCommand,
  codexHookOverrides,
  codexTurnArgs,
  grokHookFile,
  grokTurnArgs,
  parseCodexLastMessage,
  parseCodexSessionId,
  parseGrokResult,
  parseProvider,
  providerMode,
  turnOutput,
} from "../../src/providers";
import { parseBackgroundSessionId } from "../../src/night-loop";
import { redactSecrets } from "../../src/core";

const contract = {
  provider: "codex" as const,
  permissions: "workspace" as const,
  limits: { workers: 1 as const, maxSteps: 10 },
};

describe("provider surfaces", () => {
  test("parses provider ids and modes", () => {
    expect(parseProvider(undefined)).toBe("claude");
    expect(parseProvider("grok")).toBe("grok");
    expect(() => parseProvider("gemini")).toThrow("claude, codex, or grok");
    expect(providerMode("claude")).toBe("background");
    expect(providerMode("codex")).toBe("turn");
    expect(ALL_SECRET_ENV).toEqual(expect.arrayContaining(["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY", "XAI_API_KEY", "GROK_API_KEY"]));
  });

  test("Codex argv maps profiles to sandboxes and places the prompt last, verbatim", () => {
    const repo = join("C:", "work", "space Ω");
    const prompt = "Goal: quotes \" ' and $(never-run)";
    const workspace = codexTurnArgs(repo, contract, prompt);
    expect(workspace[0]).toBe("exec");
    expect(workspace[workspace.indexOf("--sandbox") + 1]).toBe("workspace-write");
    expect(workspace[workspace.indexOf("-C") + 1]).toBe(repo);
    expect(workspace.at(-1)).toBe(prompt);
    expect(workspace).not.toContain("resume");
    const full = codexTurnArgs(repo, { ...contract, permissions: "full", model: "gpt-6-sol", effort: "high" }, prompt, "thread-1");
    expect(full[full.indexOf("--sandbox") + 1]).toBe("danger-full-access");
    expect(full[full.indexOf("--model") + 1]).toBe("gpt-6-sol");
    expect(full).toContain('model_reasoning_effort="high"');
    expect(full.slice(-3)).toEqual(["resume", "thread-1", prompt]);
    expect(workspace).toContain("features.multi_agent=false");
    const capped = codexTurnArgs(repo, { ...contract, limits: { workers: "auto", maxSteps: 1 } }, prompt);
    expect(capped).toContain("agents.max_concurrent_threads_per_session=4");
    expect(codexTurnArgs(repo, { ...contract, limits: { workers: 3, maxSteps: 1 } }, prompt)).toContain("agents.max_concurrent_threads_per_session=3");
    const overrides = codexHookOverrides();
    expect(overrides.filter((arg) => arg === "-c").length).toBe(7);
    const stop = overrides.find((arg) => arg.startsWith("hooks.Stop="))!;
    expect(stop).toContain("hook-bridge.ts");
    expect(stop).toContain("loop --provider codex");
    expect(stop).toContain("timeout=1800");
    // TOML basic strings: the bridge path and bun path are quoted inside the override.
    expect(stop).toContain(`\\"${PLUGIN_ROOT.replaceAll("\\", "/")}/src/hook-bridge.ts\\"`);
  });

  test("Grok argv maps profiles to permission modes, rules, and session handling", () => {
    const repo = join("D:", "repo Ω");
    const workspace = grokTurnArgs(repo, { ...contract, provider: "grok" }, "Goal: x", { create: "11111111-2222-4333-8444-555555555555" });
    expect(workspace.slice(0, 2)).toEqual(["-p", "Goal: x"]);
    expect(workspace[workspace.indexOf("--permission-mode") + 1]).toBe("dontAsk");
    expect(workspace[workspace.indexOf("--cwd") + 1]).toBe(repo);
    expect(workspace).toContain("--trust");
    expect(workspace).toContain("--no-subagents");
    expect(workspace[workspace.indexOf("--session-id") + 1]).toBe("11111111-2222-4333-8444-555555555555");
    expect(workspace.filter((arg) => arg === "--allow").length).toBe(7);
    expect(workspace.filter((arg) => arg === "--deny").length).toBe(4);
    const full = grokTurnArgs(repo, { ...contract, provider: "grok", permissions: "full", limits: { workers: "auto", maxSteps: 1 }, effort: "max" }, "p", { resume: "abc" });
    expect(full[full.indexOf("--permission-mode") + 1]).toBe("bypassPermissions");
    expect(full).not.toContain("--allow");
    expect(full).not.toContain("--no-subagents");
    expect(full[full.indexOf("--resume") + 1]).toBe("abc");
    expect(full[full.indexOf("--reasoning-effort") + 1]).toBe("max");
    // Grok on Windows runs hooks through PowerShell: the call operator is required there
    // and only there. Codex never gets it.
    expect(bridgeCommand("gate", "grok", "win32").startsWith('& "')).toBe(true);
    expect(bridgeCommand("gate", "grok", "linux").startsWith('"')).toBe(true);
    expect(bridgeCommand("gate", "codex", "win32").startsWith('"')).toBe(true);
    const hooks = grokHookFile().hooks;
    expect(Object.keys(hooks)).toEqual(expect.arrayContaining(["PreToolUse", "Stop", "SessionStart", "Notification", "StopFailure"]));
  });

  test("parses the probed Codex JSONL stream and Grok JSON object", () => {
    const codex = [
      '{"type":"thread.started","thread_id":"01a15613-9c83-7521-b8c5-61183e2d5801"}',
      '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"hook trust bypassed"}}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"first"}}',
      '{"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"DONE"}}',
      '{"type":"turn.completed","usage":{"input_tokens":1}}',
    ].join("\n");
    expect(parseCodexSessionId(codex)).toBe("01a15613-9c83-7521-b8c5-61183e2d5801");
    expect(parseCodexLastMessage(codex)).toBe("DONE");
    expect(parseCodexSessionId("not json\n")).toBeUndefined();
    const grok = 'Updating...\n{\n  "text": "OK",\n  "stopReason": "end_turn",\n  "sessionId": "01a15614-ba03-7991-8810-b82b0c7dad2c",\n  "num_turns": 1\n}\n';
    expect(parseGrokResult(grok)).toEqual({ sessionId: "01a15614-ba03-7991-8810-b82b0c7dad2c", text: "OK" });
    expect(turnOutput("grok", grok)).toEqual({ sessionId: "01a15614-ba03-7991-8810-b82b0c7dad2c", lastMessage: "OK" });
    expect(parseGrokResult("")).toEqual({ sessionId: undefined, text: "" });
  });

  test("the Claude --bg banner yields the short id and UUIDs still win", () => {
    expect(parseBackgroundSessionId("backgrounded · d4e5f79a · night-loop\n  claude agents             list sessions")).toBe("d4e5f79a");
    expect(parseBackgroundSessionId("Session: 123e4567-e89b-12d3-a456-426614174000")).toBe("123e4567-e89b-12d3-a456-426614174000");
  });

  test("redaction removes credential-shaped values and keeps the surrounding evidence", () => {
    const key = ["sk-ant", "api03", "ABCDEFGHIJKLMNOP"].join("-");
    const line = `ratchet green token: ${key} ${"api_key"}=plain-value Bearer abcdefghijklmnop`;
    const redacted = redactSecrets(line);
    expect(redacted).toContain("ratchet green");
    expect(redacted).not.toContain(key);
    expect(redacted).not.toContain("plain-value");
    expect(redacted).not.toContain("abcdefghijklmnop");
    expect(redacted).toContain("[REDACTED]");
  });
});
