import test from "node:test";
import assert from "node:assert/strict";
import { extractThinking, isValidApiKey, parseRoutedModel } from "../server/integrations/llm.js";

test("LLM key validation accepts OpenAI and UUID-shaped gateway tokens", () => {
  assert.equal(isValidApiKey("sk-example_1234567890"), true);
  assert.equal(isValidApiKey("123e4567-e89b-42d3-a456-426614174000"), true);
  assert.equal(isValidApiKey(""), false);
  assert.equal(isValidApiKey("short"), false);
  assert.equal(isValidApiKey("token-with embedded-space"), false);
});

test("namespaced model IDs route to the matching provider", () => {
  assert.deepEqual(parseRoutedModel("minimax/MiniMax-M2.7"), {
    providerId: "minimax",
    model: "MiniMax-M2.7",
  });
  assert.deepEqual(parseRoutedModel("volcengine/doubao-seed-2-0-lite-260215"), {
    providerId: "volcengine",
    model: "doubao-seed-2-0-lite-260215",
  });
  assert.deepEqual(parseRoutedModel("gpt-4o"), { providerId: "", model: "gpt-4o" });
});

test("MiniMax think blocks are separated from the deliverable content", () => {
  assert.deepEqual(extractThinking("<think>internal plan</think>\nFinal answer", "prior"), {
    content: "Final answer",
    reasoning: "prior\n\ninternal plan",
  });
});
