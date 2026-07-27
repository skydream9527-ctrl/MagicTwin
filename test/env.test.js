import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadEnvFile } from "../server/env.js";

test(".env loader supports export, quotes, comments, and process precedence", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "magictwin-env-"));
  const path = join(dir, ".env");
  const keys = [
    "MAGICTWIN_TEST_PLAIN",
    "MAGICTWIN_TEST_QUOTED",
    "MAGICTWIN_TEST_EXISTING",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  t.after(async () => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await rm(dir, { recursive: true, force: true });
  });

  process.env.MAGICTWIN_TEST_EXISTING = "process-wins";
  await writeFile(path, [
    "MAGICTWIN_TEST_PLAIN=value # inline comment",
    'export MAGICTWIN_TEST_QUOTED="hello world\\nsecond line"',
    "MAGICTWIN_TEST_EXISTING=file-loses",
    "",
  ].join("\n"));

  const result = loadEnvFile(path);
  assert.equal(result.loaded, true);
  assert.equal(result.count, 2);
  assert.equal(process.env.MAGICTWIN_TEST_PLAIN, "value");
  assert.equal(process.env.MAGICTWIN_TEST_QUOTED, "hello world\nsecond line");
  assert.equal(process.env.MAGICTWIN_TEST_EXISTING, "process-wins");
});
