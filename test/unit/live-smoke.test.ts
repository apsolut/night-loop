import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  CREDENTIAL_SHAPE,
  FIXTURE_LINE,
  RECORD_SCHEMA,
  jailPath,
  lastAssistantText,
  renderRecord,
  scanRecord,
  transcriptDir,
  trustRequired,
  type ProbeRecord,
  type SmokeRecord,
} from "../../scripts/live-smoke";

function record(overrides: Partial<SmokeRecord> = {}): SmokeRecord {
  return {
    schemaVersion: RECORD_SCHEMA,
    recordedAt: "2026-10-20T03:00:00.000Z",
    platform: { os: "win32", arch: "x64" },
    claudeVersion: "2.1.304 (Claude Code)",
    floor: "2.1.300",
    workspace: { kind: "k", trust: "t" },
    probe: { state: "done", elapsedMs: 12000, reply: "PROBE-OK", interactionRequested: false, filesAfter: [], timeoutMs: 1, stoppedByTimeout: false },
    task: {
      permissions: "workspace",
      permissionMode: "dontAsk",
      workers: 1,
      maxSteps: 12,
      goalHash: "abc",
      runStatus: "done",
      haltReason: "done",
      steps: 3,
      elapsedMs: 90000,
      timeoutMs: 1,
      stoppedByTimeout: false,
      nativeState: "done",
      fixture: { path: "fixture/hello.txt", expected: FIXTURE_LINE, actual: FIXTURE_LINE, verified: true },
      remote: { headBefore: "a", headAfter: "a", unchanged: true },
      jailCommits: ["M1 fixture", "seed smoke jail"],
      gateDenials: [{ category: "external_or_irreversible_action", tool: "Bash" }],
      eventCounts: { "stop.continued": 2 },
      verifierReasons: ["Ratchet green (step 1/12)."],
      receiptStatus: "done",
    },
    secretScan: { hits: 0 },
    ...overrides,
  };
}

describe("live smoke runner (M7)", () => {
  test("the record is redacted and credential-shaped values are counted, so a dirty record is never written", () => {
    const clean = scanRecord(record());
    expect(clean.hits).toBe(0);
    const prefix = "sk-ant";
    const dirty = scanRecord(record({ probe: { ...record().probe, reply: `${prefix}-api03-abcdefghij` } }));
    // Redaction removed the key, so the scan of the redacted text is clean while the raw text is not.
    expect(CREDENTIAL_SHAPE.test(`${prefix}-api03-abcdefghij`)).toBe(true);
    expect(JSON.stringify(dirty.redacted)).not.toContain(`${prefix}-api03`);
    expect(dirty.hits).toBe(0);
    // A key-shaped line keeps its key after redaction, and the scan still counts it: the
    // runner refuses to write such a record at all rather than trust the redaction.
    const bare = scanRecord(record({ task: { ...record().task, verifierReasons: [`${"pass"}word = hunter2`] } }));
    expect(JSON.stringify(bare.redacted)).toContain("[REDACTED]");
    expect(JSON.stringify(bare.redacted)).not.toContain("hunter2");
    expect(bare.hits).toBe(1);
  });

  test("the Markdown rendering carries every acceptance field and no raw prompt", () => {
    const markdown = renderRecord(record());
    for (const field of ["Claude Code", "Probe state", "Probe files after", "Task permissions", "Task elapsed", "Fixture verified", "Remote unchanged", "Gate denials", "Secret scan hits"]) {
      expect(markdown).toContain(`| ${field} |`);
    }
    expect(markdown).toContain("| Probe files after | none |");
    expect(markdown).toContain("external_or_irreversible_action:Bash");
    expect(markdown).not.toContain("\u2014");
  });

  test("the assistant reply is read from the native transcript and the trust refusal is recognised", () => {
    const transcript = [
      JSON.stringify({ type: "user", message: { content: "Reply with PROBE-OK" } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Working on it." }] } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash" }, { type: "text", text: "PROBE-OK" }] } }),
      "not json",
    ].join("\n");
    expect(lastAssistantText(transcript)).toBe("PROBE-OK");
    expect(lastAssistantText("")).toBe("");
    expect(trustRequired("Workspace not trusted. Run `claude` in C:\\x once and accept the trust prompt, then retry.")).toBe(true);
    expect(trustRequired("backgrounded · d4e5f79a · night-loop")).toBe(false);
    expect(transcriptDir("D:\\sites\\git\\night-loop\\.night-loop\\state\\x")).toMatch(/D--sites-git-night-loop--night-loop-state-x$/);
    expect(jailPath("base")).toBe(join("base", "jail"));
  });

  test("the committed probe record was written by the runner: probe done, no files, no question, checkout untouched, secret-free", () => {
    const research = join(import.meta.dir, "..", "..", ".night-loop", "research");
    const records = readdirSync(research).filter((name) => /live-claude-smoke-probe\.json$/.test(name));
    expect(records.length).toBeGreaterThan(0);
    for (const name of records) {
      const parsed = JSON.parse(readFileSync(join(research, name), "utf8")) as ProbeRecord;
      expect(parsed.schemaVersion).toBe(RECORD_SCHEMA);
      expect(parsed.kind).toBe("probe-only");
      expect(parsed.claudeVersion).toMatch(/\d+\.\d+\.\d+/);
      expect(parsed.probe.state).toBe("done");
      expect(parsed.probe.filesAfter).toEqual([]);
      expect(parsed.probe.interactionRequested).toBe(false);
      expect(parsed.probe.stoppedByTimeout).toBe(false);
      expect(parsed.probe.elapsedMs).toBeGreaterThan(0);
      expect(parsed.probe.elapsedMs).toBeLessThan(parsed.probe.timeoutMs);
      expect(parsed.checkout.unchanged).toBe(true);
      expect(scanRecord(parsed).hits).toBe(0);
    }
  });

  test("a committed full smoke record, when present, satisfies the M7 acceptance fields and is secret-free", () => {
    const research = join(import.meta.dir, "..", "..", ".night-loop", "research");
    const records = existsSync(research) ? readdirSync(research).filter((name) => /live-claude-smoke\.json$/.test(name)) : [];
    for (const name of records) {
      const parsed = JSON.parse(readFileSync(join(research, name), "utf8")) as SmokeRecord;
      expect(parsed.schemaVersion).toBe(RECORD_SCHEMA);
      expect(parsed.claudeVersion).toMatch(/\d+\.\d+\.\d+/);
      expect(parsed.probe.state).toBe("done");
      expect(parsed.probe.filesAfter).toEqual([]);
      expect(parsed.probe.interactionRequested).toBe(false);
      expect(parsed.task.permissions).toBe("workspace");
      expect(parsed.task.permissionMode).toBe("dontAsk");
      expect(parsed.task.fixture.verified).toBe(true);
      expect(parsed.task.remote.unchanged).toBe(true);
      expect(["done", "blocked"]).toContain(parsed.task.haltReason ?? "none");
      expect(parsed.task.elapsedMs).toBeGreaterThan(0);
      expect(scanRecord(parsed).hits).toBe(0);
    }
  });
});
