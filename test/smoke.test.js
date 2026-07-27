import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(baseUrl, logs) {
  let lastError;
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`服务未就绪：${lastError?.message || "unknown"}\n${logs()}`);
}

async function waitForTaskStatus(baseUrl, tid, status) {
  for (let i = 0; i < 100; i++) {
    const response = await fetch(`${baseUrl}/api/task/${tid}`);
    const body = await response.json();
    if (body.meta?.status === status) return body;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`任务 ${tid} 未进入状态 ${status}`);
}

async function readUntilDeliver(response, controller) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() || "";
      for (const frame of frames) {
        const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
        if (!dataLine) continue;
        const event = JSON.parse(dataLine.slice(6));
        if (event.actor === "twin" && event.kind === "deliver") {
          controller.abort();
          return event;
        }
      }
    }
  } catch (error) {
    if (error.name !== "AbortError") throw error;
  }
  throw new Error("SSE 在 deliver 前结束");
}

test("offline mock smoke: health, frontend assets, and full delivery", { timeout: 20_000 }, async (t) => {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let output = "";
  let tid = null;
  let discussionTid = null;

  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      LLM_BACKEND: "mock",
      QUERY_BACKEND: "sample",
      EVOLVE_ENABLED: "0",
      POST_DELIVERY_LEARNING_ENABLED: "0",
      MIRROR_AGENT_MEMORY: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });

  t.after(async () => {
    child.kill("SIGTERM");
    if (tid) {
      await rm(join(ROOT, "workspace", "tasks", tid), { recursive: true, force: true });
    }
    if (discussionTid) {
      await rm(join(ROOT, "workspace", "tasks", discussionTid), { recursive: true, force: true });
    }
  });

  const health = await waitForHealth(baseUrl, () => output);
  assert.equal(health.hasKey, true);
  assert.equal(health.llm.backend, "mock");
  assert.equal(health.dataQuery.backend, "sample");
  assert.ok(Object.values(health.models).every((model) => model === "mock/magictwin"));

  const assets = [
    "/",
    "/config.html",
    "/agent.html?key=twin",
    "/artifacts.html",
    "/favicon.svg",
    "/styles.css",
    "/js/shared/dom.js",
    "/js/shared/markdown.js",
    "/js/shared/roster.js",
    "/js/shared/shell.js",
    "/js/app.js",
    "/js/config.js",
    "/js/agent.js",
    "/js/artifacts.js",
  ];
  for (const asset of assets) {
    const response = await fetch(`${baseUrl}${asset}`);
    assert.equal(response.status, 200, `${asset} should load`);
  }

  const indexHtml = await (await fetch(`${baseUrl}/`)).text();
  assert.match(indexHtml, /\/js\/shared\/dom\.js/);
  assert.match(indexHtml, /\/js\/shared\/roster\.js/);
  assert.match(indexHtml, /\/js\/shared\/shell\.js/);
  assert.match(indexHtml, /\/js\/app\.js/);
  assert.match(indexHtml, /id="tokenUsageChip"/);
  assert.match(indexHtml, /id="drawerUsagePane"/);
  assert.match(indexHtml, /id="drawerDragHandle"/);
  assert.match(indexHtml, /id="drawerResizeHandle"/);
  const stylesCss = await (await fetch(`${baseUrl}/styles.css`)).text();
  assert.match(stylesCss, /\.drawer-scrim\s*\{[^}]*display:\s*none\s*!important/s);

  const createResponse = await fetch(`${baseUrl}/api/task`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      goal: "运行离线 smoke test，分析最近 7 日示例指标",
      models: {
        twin: "mock/magictwin",
        data: "mock/magictwin",
        style: "mock/magictwin",
      },
    }),
  });
  assert.equal(createResponse.status, 200);
  ({ tid } = await createResponse.json());
  assert.ok(tid);

  const controller = new AbortController();
  const streamResponse = await fetch(`${baseUrl}/api/task/${tid}/stream`, { signal: controller.signal });
  assert.equal(streamResponse.status, 200);
  const deliver = await readUntilDeliver(streamResponse, controller);
  assert.match(deliver.text, /離線演示已完成/);

  const task = await waitForTaskStatus(baseUrl, tid, "已交付");
  assert.ok(task.events.some((event) => event.kind === "tool_result" && event.ok));
  assert.ok(task.events.some((event) => event.kind === "styled"));
  assert.ok(task.decisions.length >= 1);
  assert.ok(task.usage.total.totalTokens > 0);
  assert.ok(task.usage.total.calls >= 3);
  assert.ok(task.usage.byAgent.some((item) => item.actor === "twin"));

  const usageResponse = await fetch(`${baseUrl}/api/task/${tid}/usage`);
  assert.equal(usageResponse.status, 200);
  const usage = await usageResponse.json();
  assert.equal(usage.total.totalTokens, task.usage.total.totalTokens);

  const discussionResponse = await fetch(`${baseUrl}/api/task`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      goal: "讨论多 Agent 系统什么时候优于单 Agent",
      mode: "discussion",
      team: ["researcher", "concept", "critic", "style"],
      models: {
        twin: "mock/magictwin",
        researcher: "mock/magictwin",
        concept: "mock/magictwin",
        critic: "mock/magictwin",
        style: "mock/magictwin",
      },
    }),
  });
  assert.equal(discussionResponse.status, 200);
  ({ tid: discussionTid } = await discussionResponse.json());
  assert.ok(discussionTid);

  const discussionController = new AbortController();
  const discussionStream = await fetch(`${baseUrl}/api/task/${discussionTid}/stream`, { signal: discussionController.signal });
  assert.equal(discussionStream.status, 200);
  const discussionDeliver = await readUntilDeliver(discussionStream, discussionController);
  assert.match(discussionDeliver.text, /多模型圆桌已完成/);
  assert.match(discussionDeliver.synthesis?.summary || "", /总体结论/);

  const discussionTask = await waitForTaskStatus(baseUrl, discussionTid, "已交付");
  assert.equal(discussionTask.meta.mode, "discussion");
  assert.deepEqual(discussionTask.meta.team, ["researcher", "concept", "critic", "style"]);
  const reportActors = new Set(discussionTask.events.filter((event) => event.kind === "report").map((event) => event.actor));
  assert.ok(reportActors.has("researcher"));
  assert.ok(reportActors.has("concept"));
  assert.ok(reportActors.has("critic"));
  const parallelAssignments = discussionTask.events.filter((event) => event.kind === "assign" && event.parallel);
  assert.equal(parallelAssignments.length, 3);
  assert.equal(new Set(parallelAssignments.map((event) => event.batchId)).size, 1);
  assert.ok(discussionTask.events.some((event) => event.kind === "parallel_start"));
  assert.ok(discussionTask.events.some((event) => event.kind === "parallel_done"));
  assert.ok(discussionTask.events.filter((event) => event.kind === "report").every((event) => event.parallel));
  const synthesisIndex = discussionTask.events.findIndex((event) => event.actor === "twin" && event.kind === "synthesis");
  const styledIndex = discussionTask.events.findIndex((event) => event.kind === "styled");
  const deliverIndex = discussionTask.events.findIndex((event) => event.kind === "deliver");
  assert.ok(synthesisIndex > -1);
  assert.ok(styledIndex > synthesisIndex);
  assert.ok(deliverIndex > styledIndex);
  const synthesis = discussionTask.events[synthesisIndex].synthesis;
  assert.ok(synthesis.summary);
  assert.ok(synthesis.consensus.length >= 2);
  assert.ok(synthesis.risks.length >= 1);
  assert.ok(discussionTask.events.some((event) => event.kind === "styled"));
  assert.ok(discussionTask.usage.total.totalTokens > 0);
  assert.ok(discussionTask.usage.byAgent.some((item) => item.actor === "researcher"));
  assert.ok(discussionTask.usage.byAgent.some((item) => item.actor === "concept"));
  assert.ok(discussionTask.usage.byAgent.some((item) => item.actor === "critic"));
});
