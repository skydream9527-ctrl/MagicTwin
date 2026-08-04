// 单个工具 Agent 的回合循环：从收到一段任务文本，跑到 report / ask / styled / 步数上限。
//
// 从 orchestrator.js 的 runAgentBranch 闭包抽出，目的有两个：
//   1) fanout 并行派单继续用它（行为逐字不变，只是换了个位置）；
//   2) 评测（eval/）也用它 —— 评测跑的必须是**生产同一条路径**，否则两边会漂移，
//      评测结果就不能代表线上表现。
//
// 依赖全部注入（deps），因此可以用一个假的 callWithBudget 做纯逻辑测试，不需要 LLM。
import { getRosterEntry } from "../domain/roster.js";
import { toolFor, runTool } from "./tools.js";
import { CONFIG } from "../config.js";
import { chat } from "../integrations/llm.js";

// —— 容错 JSON 解析 ——
// Agent 协议要求「只输出一个 JSON 对象」，但模型会夹带 markdown 围栏、前后解释、尾逗号。
// 这里按「原文 → 去围栏 → 截取首尾花括号 → 容忍尾逗号」逐级降级，尽量把有效输出救回来。
export function parseAgentJson(text) {
  if (!text) return null;
  const t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const tryParse = (x) => { try { return JSON.parse(x); } catch { return null; } };
  let r = tryParse(t);
  if (r) return r;
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s >= 0 && e > s) {
    const slice = t.slice(s, e + 1);
    r = tryParse(slice) || tryParse(slice.replace(/,\s*([}\]])/g, "$1"));
    if (r) return r;
  }
  return null;
}

/**
 * 调一个 Agent，内置多次「只输出 JSON」重试（加大 token + 降温），并对调用异常做退避重试。
 * 关键：任何情况下都【不向上抛异常】——彻底失败返回 {json:null, error}，让编排优雅挂起而非整体崩溃断线。
 * @returns {{json, raw, reasoning, ms, usage, attempts, contextOverflow?, error?}}
 */
export async function callAgent(model, messages, tag = "") {
  const plan = [
    { maxTokens: CONFIG.maxTokens, temperature: 0.3 },
    { maxTokens: CONFIG.maxTokens + 1500, temperature: 0.1 },
    { maxTokens: CONFIG.maxTokens + 1500, temperature: 0 },
  ];
  // 超时/中止
  const isAbort = (err) => err.name === "AbortError" || err.code === "ABORT_ERR" || err.code === 20 || err.code === "UND_ERR_CONNECT_TIMEOUT" || /abort|timeout/i.test(`${err.code} ${err.message}`);
  // 客户端错误（鉴权失败 / 模型不存在等，429 除外）：重试无意义
  const clientErr = (err) => err.status && err.status >= 400 && err.status < 500 && err.status !== 429;
  // 上下文超长：交由调用层强制压缩后重试
  const isCtxErr = (err) => (err.status === 400 || err.status === 413) && /context|token|length|too long|maximum|exceed/i.test(`${err.body || ""} ${err.message || ""}`);

  let last = { content: "", reasoning: "", usage: {}, ms: 0 };
  let lastErr = null;
  let ctxOverflow = false;
  let abortRetries = 0;
  let msgs = messages;
  for (let i = 0; i < plan.length; i++) {
    let r;
    try {
      r = await chat({ model, messages: msgs, maxTokens: plan[i].maxTokens, temperature: plan[i].temperature, timeoutMs: CONFIG.llmTimeoutMs });
    } catch (err) {
      lastErr = err;
      if (isCtxErr(err)) ctxOverflow = true;
      if (clientErr(err) || (isAbort(err) && abortRetries >= 1)) {
        console.error(`[callAgent ${tag}] 调用失败，不再重试：${err.code || err.name || ""} ${err.message}`);
        break;
      }
      if (isAbort(err)) abortRetries++;
      console.error(`[callAgent ${tag}] 第 ${i + 1} 次调用异常，退避后重试：${err.code || err.name || ""} ${err.message}`);
      await new Promise((res) => setTimeout(res, 800 * (i + 1)));
      continue;
    }
    last = r;
    const json = parseAgentJson(r.content);
    if (json) return { json, raw: r.content, reasoning: r.reasoning, ms: r.ms, usage: r.usage, attempts: i + 1 };
    // 输出无法解析：下一轮追加「只输出 JSON」提示后重试
    msgs = [...messages,
      { role: "assistant", content: (r.content || "(空)").slice(0, 400) },
      { role: "user", content: "上次输出不是可解析的 JSON（可能被截断或夹带多余文字/大段数据）。请【只】输出一个完整且尽量简短的 JSON 对象：不要 markdown、不要解释、findings 用精炼数字而不要塞整张表。" }];
  }
  console.error(`[callAgent ${tag}] 最终失败（attempts=${plan.length}）。`, lastErr ? `错误：${lastErr.code || ""} ${lastErr.message}` : `原文预览：${(last.content || "").slice(0, 200)}`);
  return { json: null, raw: last.content, reasoning: last.reasoning, ms: last.ms, usage: last.usage, attempts: plan.length, contextOverflow: ctxOverflow, error: lastErr ? `${lastErr.code || ""} ${String(lastErr.message).slice(0, 200)}`.trim() : null };
}

/** 「XX 正在工作…」状态文案（orchestrator 与本模块共用，避免两处措辞不一致）。 */
export function busyPhrase(key) {
  if (key === "style") return "样式优化 Agent 正在排版…";
  const a = getRosterEntry(key);
  return `${(a && a.name) || key} 正在工作…`;
}

/**
 * 驱动一个工具 Agent 跑到产出。
 *
 * @param {object} p
 * @param {string} p.agentKey     参与者标识
 * @param {string} p.userMessage  推给该 Agent 的任务文本
 * @param {number} [p.maxSteps=8] 本回合最多几步（含工具调用）
 * @param {string} p.tid          任务 id
 * @param {function} p.buildSystem  (agentKey) => system prompt 文本
 * @param {function} p.onUpdate    (payload) => void 状态回调
 * @param {function} p.appendEvent (tid, event) => void 事件落盘
 * @param {function} p.appendDiscussion (tid, record) => void 讨论记录落盘
 */
export async function runAgentTurn(p) {
  const { agentKey, userMessage, maxSteps = 8, tid, buildSystem, onUpdate, appendEvent, appendDiscussion } = p;
  const baseKey = agentKey.split("#")[0];
  const entry = getRosterEntry(baseKey);
  const model = (entry && entry.defaultModel) || CONFIG.models[baseKey] || CONFIG.models.twin;
  const system = await buildSystem(agentKey);
  const messages = [
    { role: "system", content: system },
    { role: "user", content: userMessage },
  ];

  if (onUpdate) onUpdate({ kind: "agent_start", agentKey, model });

  for (let step = 0; step < maxSteps; step++) {
    const call = await callAgent(model, messages, `${tid}/${agentKey}/step${step}`);
    messages.push({ role: "assistant", content: call.raw || "" });

    if (!call.json) {
      if (appendEvent) appendEvent(tid, { actor: agentKey, kind: "error", text: call.error || "输出解析失败", channel: "side" });
      return { status: "error", agentKey, error: call.error || "parse_failed", steps: step + 1 };
    }

    const action = call.json;
    if (appendDiscussion) appendDiscussion(tid, { actor: agentKey, kind: "agent_action", action, step });

    // 工具调用
    if (action.type === "tool" && action.name) {
      const tool = toolFor(action.name);
      if (!tool) {
        messages.push({ role: "user", content: `工具 ${action.name} 不存在，可用工具：${Object.keys(await import("./tools.js")).filter(k => k !== "default").join(", ")}` });
        continue;
      }
      try {
        const result = await runTool(action.name, action.args || {}, { tid, agentKey });
        messages.push({ role: "user", content: JSON.stringify({ ok: true, result: typeof result === "string" ? result : JSON.stringify(result) }) });
        if (appendEvent) appendEvent(tid, { actor: agentKey, kind: "tool", name: action.name, summary: action.purpose || action.name, channel: "side" });
      } catch (err) {
        messages.push({ role: "user", content: JSON.stringify({ ok: false, error: err.message }) });
        if (appendEvent) appendEvent(tid, { actor: agentKey, kind: "tool_error", name: action.name, text: err.message, channel: "side" });
      }
      continue;
    }

    // ask：需要 Twin 回答确认项
    if (action.type === "ask") {
      if (onUpdate) onUpdate({ kind: "agent_ask", agentKey, questions: action.questions || [], text: action.text });
      return { status: "ask", agentKey, questions: action.questions || [], text: action.text, messages, steps: step + 1 };
    }

    // report：产出报告
    if (action.type === "report") {
      return { status: "report", agentKey, findings: action.findings || [], conclusion: action.conclusion || "", data: action.data, messages, steps: step + 1 };
    }

    // styled：样式优化完成（最终交付）
    if (action.type === "styled") {
      return { status: "styled", agentKey, title: action.title, tldr: action.tldr, sections: action.sections || [], highlights: action.highlights || [], messages, steps: step + 1 };
    }

    // deliver：直接交付
    if (action.type === "deliver") {
      return { status: "deliver", agentKey, content: action.content, messages, steps: step + 1 };
    }

    // 未识别动作，提示模型输出正确协议
    messages.push({ role: "user", content: "未识别的动作类型，请输出 ask / tool / report / styled / deliver 之一" });
  }

  if (appendEvent) appendEvent(tid, { actor: agentKey, kind: "error", text: `步数超出上限（${maxSteps}步）`, channel: "side" });
  return { status: "timeout", agentKey, steps: maxSteps };
}
