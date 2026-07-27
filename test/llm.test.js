import test from "node:test";
import assert from "node:assert/strict";
import { isValidApiKey } from "../server/integrations/llm.js";

test("LLM key validation accepts OpenAI and UUID-shaped gateway tokens", () => {
  assert.equal(isValidApiKey("sk-example_1234567890"), true);
  assert.equal(isValidApiKey("eebc5fb6-8d1c-46fd-8b19-3d6889281191"), true);
  assert.equal(isValidApiKey(""), false);
  assert.equal(isValidApiKey("short"), false);
  assert.equal(isValidApiKey("token-with embedded-space"), false);
});
