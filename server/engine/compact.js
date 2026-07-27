// 上下文自动压缩（auto-compact）。
//
// 参考 Claude Code 的「分层级联」上下文压缩思想：能不压就不压、要压先用便宜的、LLM 摘要当最后手段，
// 一层失败自然跌落到下一层（渐进式压缩、按代价从低到高逐级升级）。本模块为编排引擎里【每个 Agent】
// 的对话上下文（orchestrator.js 的 agentMsgs）设一个 token 预算，超预算就压缩，把长任务的上下文
// 稳定在模型窗口内，避免多轮真实取数后把窗口撑爆。
//
// 与 Claude Code 五层级联的对应：
//   L0 大结果落盘         —— 早已用 store.saveData 把每次真实查询结果落到 data/*.json；
//                            这里在压缩时把较旧的查询结果消息替换成一行「已归档」指针（指向 data/*.json）。
//   L1 廉价清理（无 LLM） —— archiveStaleToolResults：保留最近 N 条查询结果原文，更旧的换成归档指针。
//   L2 LLM 摘要（有 LLM） —— summarizeMiddle：把 system prompt 之后、最近 M 条消息之前的中间段，
//                            用一次 LLM 调用压成一段结构化摘要，替换原中间段（LLM 失败则用确定性兜底摘要）。
//   兜底 紧急裁剪         —— 见 orchestrator.js：模型报「上下文过长」时强制压缩后重试一次（有损逃生舱）。
import { chat } from "../integrations/llm.js";
import { getRosterEntry } from "../domain/roster.js";

const TOOL_RESULT_RE = /^【查询(?:结果|失败)\s+(.+?)】/;

function contentLen(m) {
  return typeof m.content === "string" ? m.content.length : JSON.stringify(m.content || "").length;
}

export function estimateTokens(messages, charsPerToken = 2.5) {
  let chars = 0;
  for (const m of messages || []) chars += contentLen(m) + 8;
  return Math.ceil(chars / Math.max(0.5, charsPerToken));
}

function toolResultName(m) {
  if (m.role !== "user" || typeof m.content !== "string") return null;
  const mt = m.content.match(TOOL_RESULT_RE);
  return mt ? mt[1] : null;
}

function archiveStaleToolResults(messages, keepRecentTools) {
  const idxs = [];
  messages.forEach((m, i) => { if (toolResultName(m)) idxs.push(i); });
  if (idxs.length <= keepRecentTools) return { messages, archived: 0 };
  const staleIdxs = idxs.slice(0, idxs.length - keepRecentTools);
  const next = messages.slice();
  for (const i of staleIdxs) {
    const name = toolResultName(next[i]);
    next[i] = {
      role: "user",
      content: `【历史查询 ${name} 的结果已归档：完整列/行见 data/${name}.json，此处仅保留指针以节省上下文。若结论已基于它得出，请勿重复该查询。】`,
    };
  }
  return { messages: next, archived: staleIdxs.length };
}

function buildTranscript(msgs) {
  return msgs.map((m) => {
    const who = m.role === "assistant" ? "我(本Agent)" : m.role === "system" ? "系统" : "收到";
    return `${who}: ${String(m.content).replace(/\s+/g, " ").trim().slice(0, 1200)}`;
  }).join("\n");
}

function buildCheapSummary(msgs) {
  const lines = msgs.map((m) => {
    const who = m.role === "assistant" ? "我" : "收到";
    return `· ${who}: ${String(m.content).replace(/\s+/g, " ").trim().slice(0, 150)}`;
  });
  return `（自动生成的简要回顾 · LLM 摘要不可用时的兜底）\n${lines.join("\n")}`;
}

const SUMMARY_SYS = `你在帮一个协作 Agent 压缩它自己的对话上下文，目的是在不丢关键信息的前提下大幅缩短历史。请把给到的历史对话浓缩成一段结构化中文摘要，供该 Agent 继续往下干活时回顾。只输出摘要正文（Markdown 小标题即可），不要调用任何工具、不要输出 JSON、不要客套或解释。`;

async function summarizeMiddle({ messages, keepRecentTurns, summaryModel, timeoutMs }) {
  const tailStart = Math.max(1, messages.length - keepRecentTurns);
  const middle = messages.slice(1, tailStart);
  if (middle.length === 0) return { messages, changed: false };

  let summaryText = "";
  let usageRecord = null;
  try {
    const user = `请浓缩下面这段历史对话。用这几个小标题组织（没有内容的可省略）：
## 任务与目标
## 已确认的口径 / Twin 已替用户做的决定
## 已执行的真实查询与关键数字（列出查询名、目的、关键结果；真实明细见 data/*.json）
## 目前得到的结论 / 发现
## 未完成事项 / 下一步
要求：只保留对后续决策有用的信息，数字要精确，去掉寒暄与重复；控制在 400 字以内。

历史对话如下：
${buildTranscript(middle)}`;
    const r = await chat({ model: summaryModel, messages: [{ role: "system", content: SUMMARY_SYS }, { role: "user", content: user }], maxTokens: 1500, temperature: 0.2, timeoutMs });
    summaryText = (r.content || "").replace(/^```(?:markdown)?/i, "").replace(/```$/, "").trim();
    usageRecord = {
      model: summaryModel,
      reasoning: r.reasoning || "",
      raw: r.content || "",
      ms: r.ms,
      usage: r.usage || {},
    };
  } catch {
    summaryText = "";
  }
  if (!summaryText) summaryText = buildCheapSummary(middle);

  const summaryMsg = {
    role: "user",
    content: `【以下是此前对话的压缩摘要（原始明细已省略以节省上下文；真实 SQL 见 sql/、真实结果见 data/、完整对话见 conversation.jsonl）】\n${summaryText}`,
  };
  return {
    messages: [messages[0], summaryMsg, ...messages.slice(tailStart)],
    changed: true,
    usageRecord,
  };
}

export async function maybeCompact({ key, model, messages, lastUsage, emit, config, force = false }) {
  try {
    const cfg = (config && config.compact) || {};
    if (!cfg.enabled && !force) return { messages, compacted: false };
    if (!Array.isArray(messages) || messages.length <= 2) return { messages, compacted: false };

    const cpt = cfg.charsPerToken || 2.5;
    const trigger = cfg.triggerTokens || 48000;
    const charEst = estimateTokens(messages, cpt);
    const usageTokens = (lastUsage && (lastUsage.prompt_tokens || lastUsage.total_tokens)) || 0;
    const before = Math.max(charEst, usageTokens);
    if (!force && before <= trigger) return { messages, compacted: false };

    let msgs = messages;
    const l1 = archiveStaleToolResults(msgs, cfg.keepRecentTools || 2);
    msgs = l1.messages;

    let summarized = false;
    let usageRecord = null;
    if (force || estimateTokens(msgs, cpt) > trigger) {
      if (emit) emit({ actor: key, kind: "status", text: "正在压缩上下文…", transient: true });
      const l2 = await summarizeMiddle({
        messages: msgs,
        keepRecentTurns: cfg.keepRecentTurns || 6,
        summaryModel: cfg.model || model,
        timeoutMs: (config && config.llmTimeoutMs) || 600000,
      });
      msgs = l2.messages;
      summarized = l2.changed;
      usageRecord = l2.usageRecord || null;
    }

    if (l1.archived === 0 && !summarized) return { messages, compacted: false };

    const after = estimateTokens(msgs, cpt);
    const name = (getRosterEntry(key) && getRosterEntry(key).name) || key;
    const parts = [];
    if (l1.archived) parts.push(`归档 ${l1.archived} 条历史查询结果`);
    if (summarized) parts.push("摘要中间对话");
    if (emit) {
      emit({
        actor: "system",
        kind: "notice",
        text: `🗜️ 已自动压缩「${name}」的上下文：${parts.join("、")}（约 ${before} → ${after} tokens，阈值 ${trigger}）。真实 SQL / 结果仍完整保存在 sql/、data/。`,
      });
    }
    return { messages: msgs, compacted: true, before, after, usageRecord };
  } catch {
    return { messages, compacted: false };
  }
}
