import "../server/env.js";
import { chat } from "../server/integrations/llm.js";

const models = String(process.env.VOLCENGINE_MODELS || "")
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean)
  .map((model) => `volcengine/${model.replace(/^volcengine\//, "")}`);

const results = new Array(models.length);
let cursor = 0;
const workers = new Array(Math.min(3, models.length)).fill(null).map(async () => {
  while (cursor < models.length) {
    const index = cursor++;
    const model = models[index];
    try {
      const response = await chat({
        model,
        messages: [{ role: "user", content: "只回复 OK" }],
        maxTokens: 32,
        temperature: 1,
        timeoutMs: 60_000,
      });
      results[index] = { model, ok: true, returnedModel: response.model };
    } catch (error) {
      results[index] = {
        model,
        ok: false,
        code: error.code || error.name || "ERROR",
        detail: String(error.body || error.message || "").slice(0, 240),
      };
    }
  }
});

await Promise.all(workers);
for (const result of results) console.log(JSON.stringify(result));
if (results.some((result) => !result.ok)) process.exitCode = 1;
