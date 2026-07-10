// 每日进化引擎：归纳某一天各 Agent 在所有任务中的「对话 + 错误」，用 LLM 提炼成可复用的
// 经验 / 易错点，写入该 Agent 空间的 memory/LEARNINGS.md（会被 prompt 加载器注入，从而改变其行为）
// 与 memory/daily/YYYY-MM-DD.md（当天快照，审计留痕）。
//
// 设计取舍（记忆晋升需审阅、不盲写核心手册）：
//   - 只自动更新独立的 LEARNINGS.md（附加手册），核心 agent.md 保持稳定；
//   - 把某条经验「晋升」进 agent.md 属于人工审阅动作（此处不做）。
// 任务空间（workspace/tasks/{tid}/）是唯一真相源，本引擎只读它做归纳，产物落到各 Agent 空间。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CONFIG } from "../config.js";
import { chat, hasKey } from "../integrations/llm.js";
import { listTasks, readEvents, readThinking, agentMemoryDir } from "../domain/store.js";
import { ROSTER, getRosterEntry } from "../domain/roster.js";

const EVOLVE_MODEL = (CONFIG.evolve && CONFIG.evolve.model) || CONFIG.twinModel;
const MAX_LEARNINGS = (CONFIG.evolve && CONFIG.evolve.maxLearnings) || 15;
const NAME_HINT = { twin: "Twin", data: "数据", style: "样式" };

export function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const short = (s, n = 160) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);

// 该任务是否属于目标日期：优先用 tid 前缀（本地日期，与目录名一致），兜底看 createdAt。
function taskOnDate(meta, date) {
  const compact = date.replace(/-/g, "");
  return (meta.tid || "").startsWith(compact) || String(meta.createdAt || "").slice(0, 10) === date;
}

function eventLine(e) {
  if (e.kind === "query") return `· [query] ${short(e.purpose, 80)}｜SQL: ${short(e.sql, 220)}`;
  if (e.kind === "report") return `· [report] ${short(e.summary || e.text, 160)}${(e.findings || []).length ? "｜发现: " + short((e.findings || []).join("; "), 200) : ""}`;
  if (e.kind === "ask") return `· [ask] ${short((e.questions || []).map((q) => q.text).join("; ") || e.text, 200)}`;
  if (e.kind === "answer") return `· [answer] ${short((e.answers || []).map((a) => a.answer).join("; ") || e.text, 200)}`;
  return `· [${e.kind}] ${short(e.text || e.summary || e.message, 160)}`;
}

// 汇总某 Agent 当天的对话与错误（扫描当天所有任务空间）。
function collectDay(key, date) {
  const tasks = listTasks().filter((m) => taskOnDate(m, date));
  const utterances = [], errors = [];
  let nThinking = 0;
  const taskIds = [];
  for (const meta of tasks) {
    const tid = meta.tid;
    const events = readEvents(tid);
    const thinking = readThinking(tid);
    const mine = events.filter((e) => e.actor === key);
    const myThink = thinking.filter((t) => t.actor === key);
    if (!mine.length && !myThink.length) continue;
    taskIds.push(tid);
    utterances.push(...mine.map(eventLine));
    nThinking += myThink.length;
    // 错误 1：输出需多次重试才可解析（JSON 不稳定）
    myThink.filter((t) => (t.attempts || 1) > 1).forEach((t) => errors.push(`输出重试 ${t.attempts} 次才成功解析（模型 ${t.model || "-"}）`));
    // 错误 2（数据 Agent）：真实 SQL 执行失败
    if (key === "data") {
      const sqlByName = {};
      events.forEach((e) => { if (e.kind === "tool_call") sqlByName[e.name] = e.sql; });
      events.filter((e) => e.kind === "tool_result" && e.ok === false).forEach((e) =>
        errors.push(`SQL 失败 [${e.name}]（${e.code || "-"}）：${short(e.error, 160)}｜SQL: ${short(sqlByName[e.name], 160)}`));
    }
    // 错误 3：系统级报错事件（按名字归属到对应 Agent）
    events.filter((e) => e.actor === "system" && e.kind === "error" && String(e.text || "").includes(NAME_HINT[key]))
      .forEach((e) => errors.push(`系统报错：${short(e.text, 160)}`));
  }
  return { taskIds, utterances, errors, nThinking };
}

function readLearnings(memDir) {
  try { return readFileSync(join(memDir, "LEARNINGS.md"), "utf8").trim(); } catch { return ""; }
}

/** 对单个 Agent 做某天的进化。返回 {key, skipped?, reason?, taskIds, counts}. */
export async function evolveAgent(key, date = todayStr()) {
  const agent = getRosterEntry(key);
  const memDir = agentMemoryDir(key);
  if (!agent || !memDir) return { key, skipped: true, reason: "unknown agent" };
  if (!hasKey()) return { key, skipped: true, reason: "LLM_KEY_NOT_CONFIGURED" };

  const { taskIds, utterances, errors, nThinking } = collectDay(key, date);
  if (!utterances.length && !nThinking) return { key, skipped: true, reason: "当天无活动", date };

  const existing = readLearnings(memDir);
  const dialogueDigest = utterances.slice(0, 80).join("\n") || "（无）";
  const errorDigest = errors.length ? [...new Set(errors)].slice(0, 40).join("\n") : "（当天无明显错误）";

  const sys = `你是帮 AI Agent 做「每日复盘 / 进化」的教练。基于该 Agent 当天在各任务中的对话与错误，提炼可复用的经验与易错点，用于指导它以后做得更好、少犯同样的错。`;
  const user = `【Agent】${agent.name}｜定位：${agent.role}｜边界：${agent.boundary}

【它已有的经验沉淀（在此基础上更新：去重、合并、保留最有价值的，总条数 ≤ ${MAX_LEARNINGS}）】
${existing || "（暂无）"}

【当天对话摘要（${date}，共 ${utterances.length} 条发言 / ${nThinking} 次思考）】
${dialogueDigest}

【当天出现的错误 / 重试（共 ${errors.length} 条）】
${errorDigest}

请输出更新后的经验沉淀，Markdown 两节：
## 应坚持（做对的 / 高价值经验）
## 易错点（当天暴露的问题与规避方法）
要求：每条一句话、具体可执行、能直接指导下次行动；把当天的错误转成明确的规避条目；不要空话套话；总条数控制在 ${MAX_LEARNINGS} 条以内；只输出 Markdown 正文，不要代码块、不要额外解释。`;

  let learnings = "";
  try {
    const r = await chat({ model: EVOLVE_MODEL, messages: [{ role: "system", content: sys }, { role: "user", content: user }], maxTokens: 1800, temperature: 0.3, timeoutMs: CONFIG.llmTimeoutMs });
    learnings = (r.content || "").replace(/^```(?:markdown)?/i, "").replace(/```$/, "").trim();
  } catch (err) {
    return { key, skipped: true, reason: `LLM 失败：${String(err.message).slice(0, 120)}`, date, taskIds };
  }
  if (!learnings) return { key, skipped: true, reason: "LLM 空输出", date, taskIds };

  // 写 LEARNINGS.md（注入 prompt 的附加手册）+ 当天快照（审计留痕）
  mkdirSync(join(memDir, "daily"), { recursive: true });
  writeFileSync(join(memDir, "LEARNINGS.md"), `${learnings}\n\n_（由每日进化于 ${date} 自动归纳，可人工编辑覆盖）_\n`);
  const snapshot = [
    `# ${agent.name} · 每日进化 ${date}`, "",
    `- 覆盖任务：${taskIds.join(", ") || "（无）"}`,
    `- 当天发言 ${utterances.length} 条 · 思考 ${nThinking} 次 · 错误/重试 ${errors.length} 条`, "",
    "## 当天对话摘要", dialogueDigest, "",
    "## 当天错误 / 重试", errorDigest, "",
    "## 归纳出的经验（已并入 LEARNINGS.md）", learnings, "",
  ].join("\n");
  writeFileSync(join(memDir, "daily", `${date}.md`), snapshot);

  return { key, date, taskIds, counts: { utterances: utterances.length, thinking: nThinking, errors: errors.length } };
}

/** 对所有 Agent 做某天的进化。 */
export async function evolveAll(date = todayStr()) {
  const results = [];
  for (const a of ROSTER) results.push(await evolveAgent(a.key, date));
  return { date, results };
}
