// 任务空间文件存储：文件是唯一真相源（G3 哲学）。
// workspace/tasks/{tid}/
//   meta.json           {tid, goal, status, createdAt, updatedAt, models, team, seq}
//   conversation.jsonl  每行一个事件（用户下达的指令、Twin⇄各工具Agent对话、工具调用…）
//   decisions.jsonl     Twin 代替用户做的决定
//   thinking.jsonl      每次 LLM 调用的 reasoning + 原始输出（Agent 思考过程）
//   feedback.jsonl      用户对 Twin 决策的反馈（用于信任校准）
//   sql/T{n}_*.sql      真实执行过的 SQL 原文（过程产物）
//   data/*.json         数据查询/代码返回的真实结果（过程产物）
//   STATE.md            人类可读的状态快照
//
// 除任务空间外，Agent 自己的「历史对话 / 历史思考」还会被镜像到各 Agent 空间的 memory/ 下
// （workspace/agents/{aid}/memory/ 或 workspace/users/u_local/twin/memory/），供跨任务回看与每日进化。
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  mkdirSync, writeFileSync, appendFileSync, readFileSync, readdirSync, existsSync, statSync,
  readdirSync as readdir,
} from "node:fs";
import { ROSTER } from "./roster.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const TASKS_DIR = join(ROOT, "workspace", "tasks");

function ensureDir(d) { mkdirSync(d, { recursive: true }); }
function taskDir(tid) { return join(TASKS_DIR, tid); }

export function agentMemoryDir(key) {
  const agent = ROSTER.find((a) => a.key === key);
  return agent ? join(ROOT, ...agent.space.split("/"), "memory") : null;
}

function mirrorToAgent(actor, file, record, tid) {
  if (process.env.MIRROR_AGENT_MEMORY === "0") return;
  const dir = agentMemoryDir(actor);
  if (!dir) return;
  try { ensureDir(dir); appendFileSync(join(dir, file), JSON.stringify({ ...record, tid }) + "\n"); } catch {}
}

function newTid() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

export function createTask(goal, models = {}, team = [], mode = "task", participants = []) {
  const tid = newTid();
  const dir = taskDir(tid);
  ensureDir(join(dir, "sql"));
  ensureDir(join(dir, "data"));
  ensureDir(join(dir, "artifacts"));
  const now = new Date().toISOString();
  const meta = {
    tid,
    goal,
    mode: mode === "discussion" ? "discussion" : "task",
    status: "执行中",
    createdAt: now,
    updatedAt: now,
    models,
    team,
    participants,
    seq: 0,
  };
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  writeFileSync(join(dir, "conversation.jsonl"), "");
  writeFileSync(join(dir, "decisions.jsonl"), "");
  writeFileSync(join(dir, "feedback.jsonl"), "");
  writeState(tid, meta, []);
  return meta;
}

export function getMeta(tid) {
  try { return JSON.parse(readFileSync(join(taskDir(tid), "meta.json"), "utf8")); }
  catch { return null; }
}

export function updateMeta(tid, patch) {
  const meta = getMeta(tid);
  if (!meta) return null;
  Object.assign(meta, patch, { updatedAt: new Date().toISOString() });
  writeFileSync(join(taskDir(tid), "meta.json"), JSON.stringify(meta, null, 2));
  return meta;
}

export function appendEvent(tid, event) {
  const meta = getMeta(tid);
  const seq = (meta?.seq || 0) + 1;
  const full = { seq, ts: new Date().toISOString(), ...event };
  appendFileSync(join(taskDir(tid), "conversation.jsonl"), JSON.stringify(full) + "\n");
  if (meta) updateMeta(tid, { seq });
  mirrorToAgent(full.agentKey || full.actor, "dialogue.jsonl", full, tid);
  return full;
}

export function readEvents(tid) {
  try {
    return readFileSync(join(taskDir(tid), "conversation.jsonl"), "utf8")
      .split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}

export function appendDecision(tid, decision) {
  const full = { decision_id: `D-${Date.now()}-${Math.random().toString(36).slice(2, 4)}`, ts: new Date().toISOString(), ...decision };
  appendFileSync(join(taskDir(tid), "decisions.jsonl"), JSON.stringify(full) + "\n");
  return full;
}

export function readDecisions(tid) {
  try {
    return readFileSync(join(taskDir(tid), "decisions.jsonl"), "utf8")
      .split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}

export function appendFeedback(tid, feedback) {
  const full = { ts: new Date().toISOString(), ...feedback };
  try { appendFileSync(join(taskDir(tid), "feedback.jsonl"), JSON.stringify(full) + "\n"); } catch {}
  return full;
}

export function readFeedback(tid) {
  try {
    return readFileSync(join(taskDir(tid), "feedback.jsonl"), "utf8")
      .split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}

export function saveSql(tid, name, sql) {
  const safe = name.replace(/[^\w.\-]/g, "_");
  const rel = join("sql", safe.endsWith(".sql") ? safe : `${safe}.sql`);
  writeFileSync(join(taskDir(tid), rel), sql);
  return rel;
}

export function saveData(tid, name, payload) {
  const safe = name.replace(/[^\w.\-]/g, "_");
  const rel = join("data", safe.endsWith(".json") ? safe : `${safe}.json`);
  writeFileSync(join(taskDir(tid), rel), JSON.stringify(payload, null, 2));
  return rel;
}

export function writeState(tid, meta, decisions = []) {
  const m = meta || getMeta(tid);
  if (!m) return;
  const modelLines = ROSTER.map((a) => `${a.name}=${m.models?.[a.key] || "-"}`).join(" / ");
  const participantLines = (m.participants || []).map((p) =>
    `${p.name || p.id} [${p.agentKey}] = ${p.model || m.models?.[p.agentKey] || "-"}`
  );
  const lines = [
    `# 任务状态：${m.tid}`,
    "",
    `- 目标：${m.goal}`,
    `- 状态：${m.status}`,
    `- 创建：${m.createdAt}`,
    `- 更新：${m.updatedAt}`,
    `- 团队：${(m.team && m.team.length) ? m.team.join(", ") : "全部Agent"}`,
    `- 模型：${modelLines}`,
    ...(participantLines.length ? [`- 讨论分身：${participantLines.join(" / ")}`] : []),
    "",
    "## Twin 替用户做的决定",
    ...(decisions.length ? decisions.map((d, i) => `${i + 1}. ${d.question || d.summary || ""} → ${d.answer || ""}${d.reason ? `（理由：${d.reason}）` : ""}`) : ["（暂无）"]),
    "",
  ];
  writeFileSync(join(taskDir(tid), "STATE.md"), lines.join("\n"));
}

export function listTasks() {
  if (!existsSync(TASKS_DIR)) return [];
  return readdirSync(TASKS_DIR)
    .filter((n) => { try { return statSync(join(TASKS_DIR, n)).isDirectory(); } catch { return false; } })
    .map((tid) => getMeta(tid))
    .filter(Boolean)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function appendThinking(tid, entry) {
  const full = { ts: new Date().toISOString(), ...entry };
  try { appendFileSync(join(taskDir(tid), "thinking.jsonl"), JSON.stringify(full) + "\n"); } catch {}
  return full;
}

export function readThinking(tid) {
  try {
    return readFileSync(join(taskDir(tid), "thinking.jsonl"), "utf8")
      .split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}

function usageNumbers(usage = {}) {
  const promptTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
  const completionTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
  const totalTokens = Number(usage.total_tokens ?? (promptTokens + completionTokens)) || 0;
  const cachedTokens = Number(
    usage.prompt_tokens_details?.cached_tokens
    ?? usage.input_tokens_details?.cached_tokens
    ?? usage.cached_tokens
    ?? 0
  ) || 0;
  const reasoningTokens = Number(
    usage.completion_tokens_details?.reasoning_tokens
    ?? usage.output_tokens_details?.reasoning_tokens
    ?? usage.reasoning_tokens
    ?? 0
  ) || 0;
  return { promptTokens, completionTokens, totalTokens, cachedTokens, reasoningTokens };
}

function addUsage(target, values, ms = 0) {
  target.calls += 1;
  target.promptTokens += values.promptTokens;
  target.completionTokens += values.completionTokens;
  target.totalTokens += values.totalTokens;
  target.cachedTokens += values.cachedTokens;
  target.reasoningTokens += values.reasoningTokens;
  target.latencyMs += Number(ms) || 0;
  if (values.totalTokens === 0) target.unmeteredCalls += 1;
}

function emptyUsageGroup(extra = {}) {
  return {
    ...extra,
    calls: 0,
    unmeteredCalls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    latencyMs: 0,
  };
}

// 聚合单个任务的模型用量。兼容 Chat Completions 与 Responses 风格的 usage 字段。
export function summarizeUsage(tid) {
  const records = readThinking(tid);
  const total = emptyUsageGroup();
  const agentMap = new Map();
  const modelMap = new Map();
  let updatedAt = null;

  for (const record of records) {
    const actor = record.actor || "unknown";
    const model = record.model || "unknown";
    const values = usageNumbers(record.usage || {});
    if (!agentMap.has(actor)) agentMap.set(actor, emptyUsageGroup({ actor }));
    if (!modelMap.has(model)) modelMap.set(model, emptyUsageGroup({ model }));
    addUsage(total, values, record.ms);
    addUsage(agentMap.get(actor), values, record.ms);
    addUsage(modelMap.get(model), values, record.ms);
    if (record.ts && (!updatedAt || record.ts > updatedAt)) updatedAt = record.ts;
  }

  const byAgent = [...agentMap.values()].sort((a, b) => b.totalTokens - a.totalTokens);
  const byModel = [...modelMap.values()].sort((a, b) => b.totalTokens - a.totalTokens);
  return { total, byAgent, byModel, updatedAt };
}

export const AGENT_CONFIG_PATH = join(ROOT, "agent-config.json");

export function getAgentConfig() {
  try {
    return JSON.parse(readFileSync(AGENT_CONFIG_PATH, "utf8"));
  } catch { return null; }
}

export function saveAgentConfig(models = {}) {
  const cur = getAgentConfig() || {};
  const next = { ...cur };
  for (const a of ROSTER) {
    const key = a.key;
    if (typeof models[key] === "string" && models[key].trim()) {
      next[key] = models[key].trim();
    }
  }
  writeFileSync(AGENT_CONFIG_PATH, JSON.stringify(next, null, 2));
  return next;
}

export function getTaskBundle(tid) {
  const dir = taskDir(tid);
  const meta = getMeta(tid);
  if (!meta || !existsSync(dir)) return null;
  const readFileSafe = (rel) => {
    try { return readFileSync(join(dir, rel), "utf8"); } catch { return null; }
  };
  const readDirSafe = (sub) => {
    try { return readdirSync(join(dir, sub)); } catch { return []; }
  };
  const sqlFiles = readDirSafe("sql");
  const dataFiles = readDirSafe("data");
  const sql = {};
  for (const f of sqlFiles) {
    sql[f] = readFileSafe(join("sql", f));
  }
  const data = {};
  for (const f of dataFiles) {
    try { data[f] = JSON.parse(readFileSafe(join("data", f))); } catch {}
  }
  return {
    meta,
    events: readEvents(tid),
    decisions: readDecisions(tid),
    feedback: readFeedback(tid),
    thinking: readThinking(tid),
    usage: summarizeUsage(tid),
    sql,
    data,
    state_md: readFileSafe("STATE.md"),
  };
}

export function saveFile(tid, relPath, content) {
  const dir = taskDir(tid);
  const full = join(dir, "artifacts", relPath);
  ensureDir(dirname(full));
  writeFileSync(full, content, "utf8");
  return full;
}

export function listArtifacts(tid) {
  const dir = join(taskDir(tid), "artifacts");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .filter(f => statSync(join(dir, f)).isFile())
    .map(f => ({ path: f, size: statSync(join(dir, f)).size }));
}

export function readArtifact(tid, relPath) {
  try {
    return readFileSync(join(taskDir(tid), "artifacts", relPath), "utf8");
  } catch { return null; }
}
