#!/usr/bin/env bun
export {};

// 48 KiB since decision 013: the Codex and Grok adapters plus the turn supervisor are
// first-party code; the budget still trips on any accidental dependency bloat.
const BUNDLE_LIMIT_BYTES = 48 * 1024;
const build = await Bun.build({
  entrypoints: ["src/cli.ts"],
  minify: true,
  target: "bun",
});

if (!build.success) {
  for (const log of build.logs) console.error(log.message);
  process.exit(1);
}

const bundleBytes = build.outputs.reduce((sum, output) => sum + output.size, 0);
console.log(`CLI bundle: ${bundleBytes} bytes; budget: ${BUNDLE_LIMIT_BYTES} bytes`);
if (bundleBytes > BUNDLE_LIMIT_BYTES) process.exit(1);
