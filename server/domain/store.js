// 任务空间文件存储：文件是唯一真相源（G3 哲学）。
// workspace/tasks/{tid}/
//   meta.json           {tid, goal, status, createdAt, updatedAt, models, seq}
//   conversation.jsonl  每行一个事件（用户下达的指令、Twin⇄数据/样式 Agent 对话、工具调用…）
//   decisions.jsonl     Twin 代替用户做的决定
//   thinking.jsonl      每次 LLM 调用的 reasoning + 原始输出（Agent 思考过程）
//   sql/T{n}_*.sql      真实执行过的 SQL 原文（过程产物）
//   data/*.json         数据查询返回的真实结果（过程产物）
//   STATE.md            人类可读的状态快照
//
// 除任务空间外，Agent 自己的「历史对话 / 历史思考」还会被镜像到各 Agent 空间的 memory/ 下
// （workspace/agents/{aid}/memory/ 或 workspace/users/u_local/twin/memory/），供跨任务回看与每日进化。
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  mkdirSync, writeFileSync, appendFileSync, readFileSync, readdirSync, existsSync, statSync,
} from "node:fs";
import { ROSTER } from "./roster.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// 运行时任务空间：workspace/tasks/{tid}/（四层空间之一，gitignored）
export const TASKS_DIR = join(ROOT, "workspace", "tasks");

function ensureDir(d) { mkdirSync(d, { recursive: true }); }
function taskDir(tid) { return join(TASKS_DIR, tid); }

// —— 各 Agent 空间下的 memory/ 目录（跨任务的历史对话与思考、进化产物）——
// actor(key) -> 绝对路径 {空间}/memory ；actor 为 user/system 时无对应空间。
const AGENT_MEMORY = Object.fromEntries(
  ROSTER.map((a) => [a.key, join(ROOT, ...a.space.split("/"), "memory")])
);
export function agentMemoryDir(key) { return AGENT_MEMORY[key] || null; }

// 把一条 Agent 自己产生的记录追加到它 memory/ 下的某个 jsonl（附带 tid 以便回溯到具体任务）。
function mirrorToAgent(actor, file, record, tid) {
  const dir = AGENT_MEMORY[actor];
  if (!dir) return; // user / system 不镜像
  try { ensureDir(dir); appendFileSync(join(dir, file), JSON.stringify({ ...record, tid }) + "\n"); } catch {}
}

function newTid() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

export function createTask(goal, models = {}) {
  const tid = newTid();
  const dir = taskDir(tid);
  ensureDir(join(dir, "sql"));
  ensureDir(join(dir, "data"));
  const now = new Date().toISOString();
  const meta = { tid, goal, status: "执行中", createdAt: now, updatedAt: now, models, seq: 0 };
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  writeFileSync(join(dir, "conversation.jsonl"), "");
  writeFileSync(join(dir, "decisions.jsonl"), "");
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

/** 追加一个事件到 conversation.jsonl，回填 seq + ts，返回完整事件（供 SSE 推送）。
 *  若事件出自某个 Agent（twin/data/style），同时镜像到该 Agent 的 memory/dialogue.jsonl（历史对话）。 */
export function appendEvent(tid, event) {
  const meta = getMeta(tid);
  const seq = (meta?.seq || 0) + 1;
  const full = { seq, ts: new Date().toISOString(), ...event };
  appendFileSync(join(taskDir(tid), "conversation.jsonl"), JSON.stringify(full) + "\n");
  if (meta) updateMeta(tid, { seq });
  mirrorToAgent(full.actor, "dialogue.jsonl", full, tid); // 仅 twin/data/style 命中
  return full;
}

export function readEvents(tid) {
  try {
    return readFileSync(join(taskDir(tid), "conversation.jsonl"), "utf8")
      .split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}

export function appendDecision(tid, decision) {
  const full = { ts: new Date().toISOString(), ...decision };
  appendFileSync(join(taskDir(tid), "decisions.jsonl"), JSON.stringify(full) + "\n");
  return full;
}

export function readDecisions(tid) {
  try {
    return readFileSync(join(taskDir(tid), "decisions.jsonl"), "utf8")
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

/** 写人类可读的状态快照。decisions 可选。 */
export function writeState(tid, meta, decisions = []) {
  const m = meta || getMeta(tid);
  if (!m) return;
  const lines = [
    `# 任务状态：${m.tid}`,
    "",
    `- 目标：${m.goal}`,
    `- 状态：${m.status}`,
    `- 创建：${m.createdAt}`,
    `- 更新：${m.updatedAt}`,
    `- 模型：Twin=${m.models?.twin || "-"} / 数据Agent=${m.models?.data || "-"} / 样式Agent=${m.models?.style || "-"}`,
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

// —— Agent 思考过程日志（reasoning + 原始输出），供产物页回看 ——
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

// —— Agent 模型配置（持久化「记忆」）——
// 存到项目根 agent-config.json：{ twin, data, style }。新任务默认用它；无文件返回 null（回退 CONFIG 默认）。
export const AGENT_CONFIG_PATH = join(ROOT, "agent-config.json");

export function getAgentConfig() {
  try {
    const c = JSON.parse(readFileSync(AGENT_CONFIG_PATH, "utf8"));
    return { twin: c.twin || "", data: c.data || "", style: c.style || "" };
  } catch { return null; }
}

export function saveAgentConfig(models = {}) {
  const cur = getAgentConfig() || {};
  const next = {
    twin: (models.twin || cur.twin || "").trim(),
    data: (models.data || cur.data || "").trim(),
    style: (models.style || cur.style || "").trim(),
  };
  writeFileSync(AGENT_CONFIG_PATH, JSON.stringify(next, null, 2));
  return next;
}
