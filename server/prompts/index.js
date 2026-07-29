// system prompt 分发器：使用三层上下文组装器构建 Agent 的系统提示。
// 编排引擎统一调用 buildSystemFor(key, uid, taskContext)，对任意数量已登记 Agent 一视同仁。
import { assemble, assembleLight, extractSceneKeywords } from "../domain/context-assembler.js";
import { search } from "../domain/experience.js";
import { buildTwinSystem } from "./twin.js";
import { buildDataAgentSystem } from "./data-agent.js";
import { buildStyleAgentSystem } from "./style-agent.js";
import { buildToolSystem } from "./generic.js";
import { buildModeratorSystem, buildPanelistSystem, panelText } from "./roundtable.js";

export async function buildSystemFor(key, uid = "u_local", taskContext = {}) {
  try {
    return await assemble(key, uid, taskContext);
  } catch (err) {
    console.error(`[prompts/index] context-assembler 失败, 回退 flat-file: ${err.message}`);
    return buildSystemFallback(key, uid, taskContext);
  }
}

export async function buildLightSystem(key, uid = "u_local") {
  try {
    return await assembleLight(key, uid);
  } catch {
    return buildSystemFallback(key, uid, {});
  }
}

function buildSystemFallback(key, uid, taskContext = {}) {
  const goal = taskContext.goal;
  const exp = experienceBlockFallback(goal);

  if (key === "twin") return buildTwinSystem() + exp;
  if (key === "data") return buildDataAgentSystem() + exp;
  if (key === "style") return buildStyleAgentSystem();
  return buildToolSystem(key) + exp;
}

function experienceBlockFallback(goal) {
  if (!goal) return "";
  try {
    const keywords = extractSceneKeywords(goal);
    const results = search("u_local", keywords, 3);
    if (!results || !results.length) return "";

    const parts = results.map((r, i) => {
      const tags = (r.tags || []).join(", ");
      return `### 经验${i + 1}: ${r.scene} (${r.source || "L2"})\n- 关键决策: ${r.key_decisions || "-"}\n- 标签: ${tags}`;
    });
    return `\n\n# 相关经验包（自动检索注入）\n\n${parts.join("\n\n")}`;
  } catch { return ""; }
}

export { extractSceneKeywords };

// ── brief 简报卡片 ──────────────────────────────────────
export function buildBriefMessages(decision) {
  const lines = [];
  if (decision.question) lines.push(`问题：${decision.question}`);
  if (decision.answer) lines.push(`决策：${decision.answer}`);
  if (decision.reason) lines.push(`理由：${decision.reason}`);
  if (decision.agent) lines.push(`Agent：${decision.agent}`);
  return [{ role: "user", content: lines.join("\n") }];
}

export function fallbackBrief(decision) {
  if (decision.actionType === "deliver") return "任务已完成交付";
  if (decision.actionType === "escalate") return "等待用户确认";
  if (decision.actionType === "accept") return "已验收通过";
  if (decision.question) return `决策：${decision.answer || decision.question}`;
  return "Twin 做出了决策";
}

export function cardTypeFor(actionType) {
  if (actionType === "deliver") return "success";
  if (actionType === "escalate") return "warning";
  if (actionType === "accept" || actionType === "beautify") return "accept";
  if (actionType === "rework") return "error";
  return "info";
}

// ── reflect 经验提取 ────────────────────────────────────
export function buildReflectMessages({ goal, decisionsText, conversationSummary, deliverablesSummary }) {
  return [{
    role: "user",
    content: `请从这次多 Agent 协作任务中提取可复用的经验。

任务目标：${goal}
决策记录：
${decisionsText}

执行过程摘要：
${conversationSummary}

交付物：${deliverablesSummary || "分析报告"}

请输出严格 JSON 格式：
{
  "scene": "场景描述（一句话，如：AI Agent 概念圆桌或消费时长波动归因）",
  "confidence": 0.0-1.0 的置信度,
  "key_decisions": "关键决策点总结",
  "tags": ["标签1", "标签2"],
  "pitfalls": ["踩坑点"]
}`
  }];
}

export function parseReflectOutput(text) {
  if (!text) return null;
  let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    const s = t.indexOf("{"), e = t.lastIndexOf("}");
    if (s >= 0 && e > s) {
      try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; }
    }
    return null;
  }
}

export function summarizeDecisions(decisions) {
  if (!decisions || !decisions.length) return "（无决策记录）";
  return decisions.slice(0, 20).map((d, i) =>
    `${i + 1}. ${d.question || d.summary || ""} → ${d.answer || ""}${d.reason ? `（${d.reason}）` : ""}`
  ).join("\n");
}

export function summarizeConversation(events) {
  if (!events || !events.length) return "（无执行记录）";
  return events.filter(e => !e.transient && e.channel !== "side").slice(-30).map(e => {
    const who = e.actor === "user" ? "用户" : e.actor === "twin" ? "Twin" : e.actor === "system" ? "系统" : e.actor;
    const t = e.text || e.summary || (e.name ? `执行 ${e.name}` : "");
    return `- ${who}/${e.kind}: ${String(t).slice(0, 100)}`;
  }).join("\n");
}

export { buildModeratorSystem, buildPanelistSystem, panelText };
