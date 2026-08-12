#!/usr/bin/env bun
export {};

const BUNDLE_LIMIT_BYTES = 32 * 1024;
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
