import test from "node:test";
import assert from "node:assert/strict";
import { normalizeParticipants } from "../server/domain/participants.js";

test("same Agent persona can keep multiple independent model avatars", () => {
  const participants = normalizeParticipants([
    { id: "research-a", agentKey: "researcher", name: "趋势 · 豆包", model: "volcengine/doubao-seed-2.1-turbo" },
    { id: "research-b", agentKey: "researcher", name: "趋势 · GLM", model: "volcengine/glm-5.2" },
  ], {
    dispatchable: new Set(["researcher"]),
    availableModels: new Set(["volcengine/doubao-seed-2.1-turbo", "volcengine/glm-5.2"]),
    models: {},
  });

  assert.equal(participants.length, 2);
  assert.deepEqual(participants.map((item) => item.agentKey), ["researcher", "researcher"]);
  assert.deepEqual(participants.map((item) => item.model), ["volcengine/doubao-seed-2.1-turbo", "volcengine/glm-5.2"]);
  assert.notEqual(participants[0].id, participants[1].id);
});

test("participant models must come from the active provider catalog", () => {
  assert.throws(() => normalizeParticipants([
    { id: "bad", agentKey: "researcher", model: "unknown/model" },
  ], {
    dispatchable: new Set(["researcher"]),
    availableModels: new Set(["mock/magictwin"]),
  }), /模型不在当前可用清单/);
});
