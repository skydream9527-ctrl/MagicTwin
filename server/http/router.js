// HTTP 路由：任务 API + SSE 事件流 + 插话/私聊端点 + 静态前端兜底。
// 端点：
//   GET  /api/health              → {hasKey, models(默认), dataQuery}
//   GET  /api/models              → {recommended, all, defaults}  供前端为三个 Agent 选模型
//   GET  /api/agents              → 三个 Agent 概要
//   GET  /api/agent/:key          → 单个 Agent 详情 + 关联文件
//   GET  /api/agent-config        → 读当前模型配置（记忆）
//   POST /api/agent-config        → 保存模型配置
//   GET  /api/tasks               → 历史任务列表（可回溯）
//   POST /api/task {goal,twinModel,dataModel,styleModel} → 创建任务，返回 {tid}
//   GET  /api/task/:tid           → {meta, events, decisions, thinking}（回放/审计/思考）
//   GET  /api/task/:tid/stream    → SSE：连接即启动编排，实时推事件
//   POST /api/task/:tid/reply   {text}      → 回复 Twin 升级上来的问题（→ 注入到 twin）
//   POST /api/task/:tid/inject  {to,text}   → 用户在主对话区 @ 某方插话（to = twin|data|style）
//   POST /api/task/:tid/inquiry {question}  → 在「与 Twin 私聊」侧栏问进度（走 side 频道）
import { CONFIG, RECOMMENDED_MODELS } from "../config.js";
import { hasKey, listModels } from "../integrations/llm.js";
import { hasRealBackend } from "../integrations/data-query.js";
import { createTask, getMeta, readEvents, readDecisions, readThinking, listTasks, getAgentConfig, saveAgentConfig } from "../domain/store.js";
import { getAgentList, getAgentDetail } from "../domain/agents.js";
import { runTwinInquiry } from "../engine/orchestrator.js";
import { rt, peek, ssePush, enqueueInjection, startOrchestration } from "./runtime.js";
import { serveStatic } from "./static.js";

function sendJson(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
  });
}

export async function handleRequest(req, res) {
  const { url, method } = req;
  const path = url.split("?")[0];

  if (path === "/api/health" && method === "GET") {
    return sendJson(res, 200, { hasKey: hasKey(), models: { twin: CONFIG.twinModel, data: CONFIG.dataModel, style: CONFIG.styleModel }, dataQuery: { backend: CONFIG.dataQuery.backend, real: hasRealBackend() } });
  }
  if (path === "/api/models" && method === "GET") {
    const all = await listModels();
    return sendJson(res, 200, { recommended: RECOMMENDED_MODELS, all, defaults: { twin: CONFIG.twinModel, data: CONFIG.dataModel, style: CONFIG.styleModel } });
  }
  // Agent 详情：概览列表 + 单个 Agent 的元信息与关联文件（人设 Prompt / 知识库 / 技能包）
  if (path === "/api/agents" && method === "GET") {
    return sendJson(res, 200, { agents: getAgentList() });
  }
  const mAgent = path.match(/^\/api\/agent\/([^/]+)$/);
  if (mAgent && method === "GET") {
    const detail = getAgentDetail(mAgent[1]);
    if (!detail) return sendJson(res, 404, { error: "agent not found" });
    return sendJson(res, 200, detail);
  }
  // Agent 模型配置（记忆）：GET 读当前配置（无文件则回退 CONFIG 默认），POST 保存
  if (path === "/api/agent-config" && method === "GET") {
    const saved = getAgentConfig() || {};
    return sendJson(res, 200, { twin: saved.twin || CONFIG.twinModel, data: saved.data || CONFIG.dataModel, style: saved.style || CONFIG.styleModel });
  }
  if (path === "/api/agent-config" && method === "POST") {
    const body = await readBody(req);
    const s = saveAgentConfig({ twin: body.twin, data: body.data, style: body.style });
    return sendJson(res, 200, { ok: true, config: { twin: s.twin || CONFIG.twinModel, data: s.data || CONFIG.dataModel, style: s.style || CONFIG.styleModel } });
  }
  if (path === "/api/tasks" && method === "GET") {
    return sendJson(res, 200, { tasks: listTasks() });
  }
  if (path === "/api/task" && method === "POST") {
    const body = await readBody(req);
    const goal = (body.goal || "").trim();
    if (!goal) return sendJson(res, 400, { error: "goal 不能为空" });
    if (!hasKey()) return sendJson(res, 503, { error: "LLM_KEY_NOT_CONFIGURED：未找到 LLM key" });
    const models = {
      twin: (body.twinModel || CONFIG.twinModel).trim(),
      data: (body.dataModel || CONFIG.dataModel).trim(),
      style: (body.styleModel || CONFIG.styleModel).trim(),
    };
    const meta = createTask(goal, models);
    rt(meta.tid).fresh = true; // 仅本进程新建的任务才允许启动编排
    return sendJson(res, 200, { tid: meta.tid });
  }

  const mTask = path.match(/^\/api\/task\/([^/]+)$/);
  if (mTask && method === "GET") {
    const tid = mTask[1];
    const meta = getMeta(tid);
    if (!meta) return sendJson(res, 404, { error: "task not found" });
    return sendJson(res, 200, { meta, events: readEvents(tid), decisions: readDecisions(tid), thinking: readThinking(tid) });
  }

  // 回复 Twin 升级上来的高风险问题 → 作为一条 reply 注入到 twin
  const mReply = path.match(/^\/api\/task\/([^/]+)\/reply$/);
  if (mReply && method === "POST") {
    const tid = mReply[1];
    const body = await readBody(req);
    const r = peek(tid);
    if (!r || !r.started) return sendJson(res, 409, { error: "任务未在运行" });
    enqueueInjection(tid, { kind: "reply", to: "twin", text: (body.text || "").trim() || "（用户未填写，按你的推荐处理）" });
    return sendJson(res, 200, { ok: true });
  }

  // 用户在主对话区 @ 某一方插话（补充要求 / 纠偏）
  const mInject = path.match(/^\/api\/task\/([^/]+)\/inject$/);
  if (mInject && method === "POST") {
    const tid = mInject[1];
    const body = await readBody(req);
    const text = (body.text || "").trim();
    if (!text) return sendJson(res, 400, { error: "text 不能为空" });
    const to = ["twin", "data", "style"].includes(body.to) ? body.to : "twin";
    const r = peek(tid);
    if (!r || !r.started) return sendJson(res, 409, { error: "任务未在运行" });
    enqueueInjection(tid, { kind: "inject", to, text });
    return sendJson(res, 200, { ok: true });
  }

  // 「与 Twin 私聊」侧栏：随时问进度 / 问它替你做了什么（走 side 频道，不打断主编排）
  const mInquiry = path.match(/^\/api\/task\/([^/]+)\/inquiry$/);
  if (mInquiry && method === "POST") {
    const tid = mInquiry[1];
    const meta = getMeta(tid);
    if (!meta) return sendJson(res, 404, { error: "task not found" });
    const body = await readBody(req);
    const question = (body.question || "").trim();
    if (!question) return sendJson(res, 400, { error: "question 不能为空" });
    if (!hasKey()) return sendJson(res, 503, { error: "LLM_KEY_NOT_CONFIGURED：未找到 LLM key" });
    const answer = await runTwinInquiry({ tid, models: meta.models, question, ssePush: (e) => ssePush(tid, e) });
    return sendJson(res, 200, { answer });
  }

  const mStream = path.match(/^\/api\/task\/([^/]+)\/stream$/);
  if (mStream && method === "GET") {
    const tid = mStream[1];
    const meta = getMeta(tid);
    if (!meta) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(`retry: 3000\n\n`);
    const r = rt(tid);
    for (const e of readEvents(tid)) res.write(`data: ${JSON.stringify(e)}\n\n`); // 回放已持久化事件
    r.clients.add(res);
    req.on("close", () => r.clients.delete(res));
    startOrchestration(tid); // 首次连接且是本进程新建的任务才启动
    return;
  }

  if (method === "GET") return serveStatic(req, res);
  res.writeHead(405); res.end("Method Not Allowed");
}
