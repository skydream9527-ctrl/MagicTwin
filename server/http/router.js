// HTTP 路由：任务 API + SSE 事件流 + 插话/私聊端点 + 静态前端兜底。
// 端点：
//   GET  /api/health              → {hasKey, models, dataQuery, sandbox}
//   GET  /api/models              → {recommended, all, defaults}  供前端为各 Agent 选模型
//   GET  /api/agents              → 全部 Agent 概要
//   GET  /api/agent/:key          → 单个 Agent 详情 + 关联文件
//   GET  /api/agent-config        → 读当前模型配置（记忆，按 Agent key 的映射）
//   POST /api/agent-config        → 保存模型配置（任意数量 Agent）
//   GET  /api/tasks               → 历史任务列表（可回溯）
//   POST /api/task {goal, models?, team?} → 创建任务，返回 {tid}
//   GET  /api/task/:tid           → {meta, events, decisions, thinking}（回放/审计/思考）
//   GET  /api/task/:tid/stream    → SSE：连接即启动编排，实时推事件
//   POST /api/task/:tid/reply   {text}      → 回复 Twin 升级上来的问题（→ 注入到 twin）
//   POST /api/task/:tid/inject  {to,text}   → 用户在主对话区 @ 某方插话（to = twin 或任一工具 Agent key）
//   POST /api/task/:tid/inquiry {question}  → 在「与 Twin 私聊」侧栏问进度（走 side 频道）
//   POST /api/task/:tid/pause     → 暂停任务
//   POST /api/task/:tid/resume    → 恢复任务
//   POST /api/task/:tid/abort     → 终止任务
//   GET  /api/task/:tid/download  → 下载任务产物包
//   GET  /api/twin/distill        → 查询 Twin 画像蒸馏状态
//   POST /api/twin/distill        → 手动触发 Twin 画像蒸馏
//   GET  /api/twin/trust          → 信任等级仪表盘
//   GET  /api/twin/experience     → 经验包列表（L2 已生效 + L1 候选）
//   POST /api/twin/experience     → 创建经验包
//   POST /api/twin/experience/promote → 候选经验包晋升为 L2
//   GET  /api/risk-config         → 读取风险分级矩阵配置
//   POST /api/risk-config         → 保存风险分级矩阵配置
//   POST /api/task/:tid/feedback  → 对 Twin 决策的反馈（用于信任校准）
import { CONFIG, RECOMMENDED_MODELS } from "../config.js";
import { hasKey, listModels } from "../integrations/llm.js";
import { hasRealBackend } from "../integrations/data-query.js";
import { isSandboxEnabled } from "../integrations/sandbox.js";
import { createTask, getMeta, updateMeta, readEvents, readDecisions, readThinking, listTasks, getAgentConfig, saveAgentConfig, getTaskBundle, appendFeedback } from "../domain/store.js";
import { getAgentList, getAgentDetail } from "../domain/agents.js";
import { ROSTER, isToolAgentKey, defaultModelFor, getDispatchableAgents, AGENT_KEYS } from "../domain/roster.js";
import { runTwinInquiry } from "../engine/orchestrator.js";
import { rt, peek, ssePush, enqueueInjection, startOrchestration } from "./runtime.js";
import { serveStatic } from "./static.js";
import { getDistillStatus, runDistill } from "../engine/distill.js";
import { getRiskConfig, saveRiskConfig } from "../domain/risk.js";
import { getTrust, dashboard as trustDashboard } from "../domain/trust.js";
import { list, create, promote, listCandidates, countL2 } from "../domain/experience.js";
const listExpPacks = list;
const createExpPack = create;
const promoteExpPack = promote;

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

// 组装「每个 Agent 当前使用的模型」映射：保存的配置 > 该 Agent 默认模型。
function resolvedConfigMap() {
  const saved = getAgentConfig() || {};
  const out = {};
  for (const a of ROSTER) out[a.key] = saved[a.key] || defaultModelFor(a.key);
  return out;
}

export async function handleRequest(req, res) {
  const { url, method } = req;
  const path = url.split("?")[0];

  if (path === "/api/health" && method === "GET") {
    return sendJson(res, 200, {
      hasKey: hasKey(),
      models: resolvedConfigMap(),
      dataQuery: { backend: CONFIG.dataQuery.backend, real: hasRealBackend() },
      sandbox: { enabled: isSandboxEnabled() },
    });
  }
  if (path === "/api/models" && method === "GET") {
    const all = await listModels();
    return sendJson(res, 200, { recommended: RECOMMENDED_MODELS, all, defaults: resolvedConfigMap() });
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
  // Agent 模型配置（记忆）：GET 读当前配置（按 Agent key 的映射，无文件则回退默认），POST 保存
  if (path === "/api/agent-config" && method === "GET") {
    return sendJson(res, 200, resolvedConfigMap());
  }
  if (path === "/api/agent-config" && method === "POST") {
    const body = await readBody(req);
    const patch = {};
    for (const a of ROSTER) if (typeof body[a.key] === "string") patch[a.key] = body[a.key];
    saveAgentConfig(patch);
    return sendJson(res, 200, { ok: true, config: resolvedConfigMap() });
  }
  if (path === "/api/tasks" && method === "GET") {
    return sendJson(res, 200, { tasks: listTasks() });
  }
  if (path === "/api/task" && method === "POST") {
    const body = await readBody(req);
    const goal = (body.goal || "").trim();
    if (!goal) return sendJson(res, 400, { error: "goal 不能为空" });
    if (!hasKey()) return sendJson(res, 503, { error: "LLM_KEY_NOT_CONFIGURED：未找到 LLM key" });
    // 本任务各 Agent 使用的模型：默认/记忆配置为底，请求体 models 映射覆盖，兼容旧版单键字段。
    const models = resolvedConfigMap();
    if (body.models && typeof body.models === "object") {
      for (const [k, v] of Object.entries(body.models)) if (typeof v === "string" && v.trim()) models[k] = v.trim();
    }
    if (body.twinModel) models.twin = String(body.twinModel).trim();
    if (body.dataModel) models.data = String(body.dataModel).trim();
    if (body.styleModel) models.style = String(body.styleModel).trim();
    // 本次协作团队：前端从「你的 Agent 团队」挑选的工具 Agent（Twin 恒为编排者，不计入）。
    // 只接受可调度（已发布的工具）Agent 的 key，去重；为空则不限制，Twin 可调度全部团队。
    const dispatchable = new Set(getDispatchableAgents().map((a) => a.key));
    const team = Array.isArray(body.team)
      ? [...new Set(body.team)].filter((k) => typeof k === "string" && k !== "twin" && dispatchable.has(k))
      : [];
    const meta = createTask(goal, models, team);
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

  // 用户在主对话区 @ 某一方插话（补充要求 / 纠偏）。to 可为 twin 或任一工具 Agent 的 key。
  const mInject = path.match(/^\/api\/task\/([^/]+)\/inject$/);
  if (mInject && method === "POST") {
    const tid = mInject[1];
    const body = await readBody(req);
    const text = (body.text || "").trim();
    if (!text) return sendJson(res, 400, { error: "text 不能为空" });
    const to = (body.to === "twin" || isToolAgentKey(body.to)) ? body.to : "twin";
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

  // ─── 任务控制：暂停 / 恢复 / 终止 ───
  const mPause = path.match(/^\/api\/task\/([^/]+)\/pause$/);
  if (mPause && method === "POST") {
    const tid = mPause[1];
    const r = peek(tid);
    if (r) r.paused = true;
    updateMeta(tid, { status: "已暂停" });
    return sendJson(res, 200, { ok: true });
  }
  const mResume = path.match(/^\/api\/task\/([^/]+)\/resume$/);
  if (mResume && method === "POST") {
    const tid = mResume[1];
    const r = peek(tid);
    if (r) r.paused = false;
    updateMeta(tid, { status: "执行中" });
    return sendJson(res, 200, { ok: true });
  }
  const mAbort = path.match(/^\/api\/task\/([^/]+)\/abort$/);
  if (mAbort && method === "POST") {
    const tid = mAbort[1];
    const r = peek(tid);
    if (r) { r.aborted = true; r.paused = false; }
    updateMeta(tid, { status: "已终止" });
    return sendJson(res, 200, { ok: true });
  }

  // ─── 产物下载（打包任务空间文件）───
  const mDownload = path.match(/^\/api\/task\/([^/]+)\/download$/);
  if (mDownload && method === "GET") {
    const tid = mDownload[1];
    const meta = getMeta(tid);
    if (!meta) return sendJson(res, 404, { error: "task not found" });
    const bundle = getTaskBundle(tid);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="task-${tid}.json"` });
    return res.end(JSON.stringify(bundle, null, 2));
  }

  // ─── Twin 画像蒸馏 ───
  if (path === "/api/twin/distill" && method === "GET") {
    return sendJson(res, 200, getDistillStatus());
  }
  if (path === "/api/twin/distill" && method === "POST") {
    try {
      const result = await runDistill();
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 500, { error: err.message || "蒸馏失败" });
    }
  }

  // ─── 信任等级仪表盘 ───
  if (path === "/api/twin/trust" && method === "GET") {
    const expCount = countL2("u_local");
    return sendJson(res, 200, trustDashboard("u_local", expCount));
  }

  // ─── 经验包管理 ───
  if (path === "/api/twin/experience" && method === "GET") {
    const strip = (arr) => (arr || []).map(({ path, ...rest }) => rest);
    const packs = strip(listExpPacks("u_local"));
    const candidates = strip(listCandidates("u_local"));
    return sendJson(res, 200, { packs, candidates });
  }
  if (path === "/api/twin/experience" && method === "POST") {
    const body = await readBody(req);
    try {
      const expPath = createExpPack("u_local", body);
      return sendJson(res, 200, { ok: true, path: expPath });
    } catch (err) {
      return sendJson(res, 400, { error: err.message || "创建失败" });
    }
  }
  if (path === "/api/twin/experience/promote" && method === "POST") {
    const body = await readBody(req);
    try {
      const expPath = promoteExpPack("u_local", body.candidate_id);
      if (!expPath) return sendJson(res, 404, { error: "candidate not found" });
      return sendJson(res, 200, { ok: true, path: expPath });
    } catch (err) {
      return sendJson(res, 400, { error: err.message || "晋升失败" });
    }
  }

  // ─── 风险分级矩阵配置 ───
  if (path === "/api/risk-config" && method === "GET") {
    return sendJson(res, 200, getRiskConfig());
  }
  if (path === "/api/risk-config" && method === "POST") {
    const body = await readBody(req);
    try {
      saveRiskConfig(body);
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, 400, { error: err.message || "保存失败" });
    }
  }

  // ─── 决策反馈（用于信任校准）───
  const mFeedback = path.match(/^\/api\/task\/([^/]+)\/feedback$/);
  if (mFeedback && method === "POST") {
    const tid = mFeedback[1];
    const meta = getMeta(tid);
    if (!meta) return sendJson(res, 404, { error: "task not found" });
    const body = await readBody(req);
    appendFeedback(tid, { decisionIndex: body.decisionIndex, vote: body.vote, comment: body.comment || "", ts: new Date().toISOString() });
    if (body.decision_id) {
      try {
        const { readFileSync, writeFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        const decisionsPath = join(process.cwd(), "workspace", "tasks", tid, "decisions.jsonl");
        const lines = readFileSync(decisionsPath, "utf8").split("\n").filter(Boolean);
        const updated = lines.map(l => {
          const d = JSON.parse(l);
          if (d.decision_id === body.decision_id) {
            d.user_feedback = body.vote === "up" ? "approved" : "corrected";
            d.corrected_value = body.corrected_value || null;
          }
          return JSON.stringify(d);
        }).join("\n") + "\n";
        writeFileSync(decisionsPath, updated);
      } catch {}
    }
    return sendJson(res, 200, { ok: true });
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
