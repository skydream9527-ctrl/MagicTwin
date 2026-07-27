// 编排引擎：驱动 Twin ⇄ 任意数量工具 Agent 的有界多轮协作，
// 并支持用户在主对话区通过 @ 提及随时插话（injection）、在副对话区随时问 Twin 进度（inquiry）。
//
// 「任意数量」的关键：不再硬编码特定 Agent，而是从花名册（domain/roster.js）派生——
//   - Twin 是唯一编排者，可 assign 给任一已登记的工具 Agent（target=该 Agent 的 key）；
//   - 每个工具 Agent 的 system prompt 由 prompts/index.js 的 buildSystemFor(key) 统一组装
//     （通用 Agent 自动套上 ask/query/report 协作协议）；
//   - 所有工具 Agent 只对 Twin 汇报，Agent 之间不直接对话（Twin 唯一 leader、有界多跳）。
//
// 路由（@ 提及）：
//   - 用户 → 可 @ 任意一方（twin / 任一工具 Agent key）
//   - Twin → 可 @ user / 任一工具 Agent key
//   - 工具 Agent → 只能 @ twin
//
// 安全阀：单个用户回合内 Agent↔Agent 往返受 maxSteps 限制（每次用户插话重置）；
//         JSON 解析容错 + 多次重试。每次 LLM 调用的 reasoning + 原始输出写入思考日志。
//         上下文自动压缩（auto-compact，见 engine/compact.js）：每次调 Agent 前按 token 预算压缩其上下文。
import { chat } from "../integrations/llm.js";
import { CONFIG } from "../config.js";
import { appendEvent, appendDecision, appendThinking, updateMeta, writeState, getMeta, readDecisions, readEvents, saveSql, saveData, appendFeedback, saveFile } from "../domain/store.js";
import { buildSystemFor, buildBriefMessages, fallbackBrief, buildReflectMessages, parseReflectOutput, summarizeDecisions, summarizeConversation, extractSceneKeywords } from "../prompts/index.js";
import { getRosterEntry, isToolAgentKey, defaultModelFor, hasCapability, getDispatchableAgents } from "../domain/roster.js";
import { normQuestions } from "../domain/events.js";
import { maybeCompact } from "./compact.js";
import { getRiskConfig } from "../domain/risk.js";
import { getTrust, shouldAutoAnswer } from "../domain/trust.js";
import { calibrate } from "../domain/calibrate.js";
import { createCandidate } from "../domain/experience.js";
import { runTool, toolFor, CONTROL_TYPES } from "./tools.js";

// —— 风险硬护栏：检查 Twin 代答是否命中强制升级规则 ——
function shouldForceEscalate(action) {
  try {
    const config = getRiskConfig();
    const always = config.thresholds && config.thresholds.always_escalate;
    if (!always || !Array.isArray(always) || always.length === 0) return false;
    const text = JSON.stringify(action).toLowerCase();
    const highRules = (config.rules || []).filter(r => r.level === "high" && r.enabled !== false);
    for (const rule of highRules) {
      if (!always.includes(rule.id)) continue;
      for (const signal of (rule.signals || [])) {
        if (text.includes(signal.toLowerCase())) return true;
      }
    }
    return false;
  } catch { return false; }
}

// —— 容错 JSON 解析 ——
function parseAgentJson(text) {
  if (!text) return null;
  let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
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

// 调一个 Agent，内置多次“只输出 JSON”重试（加大 token + 降温），并对调用异常做退避重试。
// 关键：任何情况下都【不向上抛异常】——彻底失败返回 {json:null, error}，让编排优雅挂起而非整体崩溃断线。
async function callAgent(model, messages, tag = "") {
  const plan = [
    { maxTokens: CONFIG.maxTokens, temperature: 0.3 },
    { maxTokens: CONFIG.maxTokens + 1500, temperature: 0.1 },
    { maxTokens: CONFIG.maxTokens + 1500, temperature: 0 },
  ];
  const isAbort = (err) => err.name === "AbortError" || err.code === "ABORT_ERR" || err.code === 20 || err.code === "UND_ERR_CONNECT_TIMEOUT" || /abort|timeout/i.test(`${err.code} ${err.message}`);
  const clientErr = (err) => err.status && err.status >= 400 && err.status < 500 && err.status !== 429;
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
    msgs = [...messages,
      { role: "assistant", content: (r.content || "(空)").slice(0, 400) },
      { role: "user", content: "上次输出不是可解析的 JSON（可能被截断或夹带多余文字/大段数据）。请【只】输出一个完整且尽量简短的 JSON 对象：不要 markdown、不要解释、findings 用精炼数字而不要塞整张表。" }];
  }
  console.error(`[callAgent ${tag}] 最终失败（attempts=${plan.length}）。`, lastErr ? `错误：${lastErr.code || ""} ${lastErr.message}` : `原文预览：${(last.content || "").slice(0, 200)}`);
  return { json: null, raw: last.content, reasoning: last.reasoning, ms: last.ms, usage: last.usage, attempts: plan.length, contextOverflow: ctxOverflow, error: lastErr ? `${lastErr.code || ""} ${String(lastErr.message).slice(0, 200)}`.trim() : null };
}

// —— Agent 之间“看到”的消息格式化 ——
function twinToAgentText(a) {
  if (a.type === "assign") return `【Twin 派发任务】\n${a.message || ""}`;
  if (a.type === "answer") {
    const lines = (a.answers || []).map((x) => `- [${x.id}] ${x.answer}${x.reason ? `（理由：${x.reason}）` : ""}`);
    return `【Twin 回复你的确认项】${a.message || ""}\n${lines.join("\n")}\n请据此继续。`;
  }
  if (a.type === "rework") return `【Twin 打回重做】${a.message || ""}\n请补齐后重新交付。`;
  return a.message || "";
}
function twinToStyleText(a, goal, lastReport, reports = []) {
  const sourceReports = reports.length ? reports : (lastReport ? [lastReport] : []);
  const rep = sourceReports.length
    ? `\n【待整合的多 Agent 观点】\n${sourceReports.map((report, index) => {
      const agent = getRosterEntry(report.by);
      return `${index + 1}. ${(agent && agent.name) || report.by || "Agent"}\n结论：${report.summary || ""}\n要点：\n${(report.findings || []).map((f) => `- ${f}`).join("\n")}`;
    }).join("\n\n")}`
    : "";
  return `【Twin 请你综合整理】\n用户议题：${goal}${rep}\nTwin 说明：${a.message || ""}\n请保留各方共识、分歧、反例与不确定性，整理成结构清晰、可直接交付给用户的讨论纪要，只输出规定的 JSON。`;
}
function normalizeSynthesis(input = {}, goal = "") {
  const list = (value) => (Array.isArray(value) ? value : []).map((item) => String(item || "").trim()).filter(Boolean);
  return {
    title: String(input.title || goal || "多 Agent 综合结论").trim(),
    summary: String(input.summary || "").trim(),
    consensus: list(input.consensus),
    differences: list(input.differences),
    risks: list(input.risks),
    uncertainties: list(input.uncertainties),
    recommendations: list(input.recommendations),
  };
}
function twinSynthesisToStyleText(synthesis, goal) {
  const section = (heading, items) => `【${heading}】\n${items.length ? items.map((item) => `- ${item}`).join("\n") : "- （无）"}`;
  return `【Twin 已完成总结果汇总 · Style 只负责排版】
用户议题：${goal}
标题：${synthesis.title}
总结果：${synthesis.summary}

${section("共识结论", synthesis.consensus)}
${section("核心分歧", synthesis.differences)}
${section("反例与风险", synthesis.risks)}
${section("不确定性", synthesis.uncertainties)}
${section("下一步建议", synthesis.recommendations)}

你不得重新判断、增加新结论或删除分歧；只把 Twin 的上述总结果整理成 styled JSON。`;
}
function agentAskText(a, agent) {
  const questions = normQuestions(a.questions);
  const qs = questions.map((q) => `- [${q.id || "?"}] ${q.text || "(空)"}｜选项:${(q.options || []).join("/")}｜推荐:${q.recommendation || "-"}｜风险:${q.risk || "low"}`);
  return `【${agent.name}（key=${agent.key}）的确认项】${a.message || ""}\n${qs.join("\n")}\n（你回答时 target 用 "${agent.key}"）`;
}
function agentReportText(a, agent, discussion = null) {
  const fs = (a.findings || []).map((f) => `- ${f}`).join("\n");
  const next = discussion && discussion.remaining.length
    ? `\n\n这是圆桌中的一个视角，不是最终答案。请把有价值的结论与疑点带给下一位专家继续讨论。尚待参与：${discussion.remaining.join("、")}。`
    : "\n\n请你以用户视角验收：有硬伤就打回；材料齐全后再交给样式优化 Agent 综合整理。";
  return `【${agent.name}（key=${agent.key}）${a.final ? "最终" : ""}报告】${a.message || ""}\n结论：${a.summary || ""}\n发现：\n${fs}${next}`;
}
function styledReportText(a) {
  const secs = (a.sections || []).map((s) => `【${s.heading || ""}】\n${(s.bullets || []).map((b) => `- ${b}`).join("\n")}`).join("\n");
  return `【样式优化 Agent 交回排版稿】\n标题：${a.title || ""}\nTL;DR：${a.summary || ""}\n${secs}\n\n排版已完成，可直接交付用户（target=user, type=deliver）。`;
}
function toolResultText(name, res) {
  if (res.ok) {
    const sample = res.records.slice(0, 80);
    const more = res.rowCount > sample.length ? `（仅回显前 ${sample.length} 行，共 ${res.rowCount} 行）` : "";
    return `【查询结果 ${name}】成功：${res.rowCount} 行，${res.ms}ms。列：${res.columns.join(", ")}${more}\n数据(JSON)：${JSON.stringify(sample)}`;
  }
  return `【查询失败 ${name}】${res.error}（code=${res.code}）。请阅读报错、修正 SQL 后作为新的 query 重试；不要重复同样的错误。`;
}
function codeResultText(name, res) {
  if (res.ok) {
    const out = (res.stdout || "").slice(0, 4000);
    const err = (res.stderr || "").slice(0, 1500);
    return `【代码执行结果 ${name}】成功（${res.ms}ms）。\nstdout:\n${out || "(无输出)"}${err ? `\nstderr(警告/提示):\n${err}` : ""}`;
  }
  return `【代码执行失败 ${name}】${res.error}（code=${res.code}）。\n${res.stderr ? `stderr:\n${(res.stderr || "").slice(0, 2500)}` : ""}\n请阅读报错、修正代码后作为新的 execute 重试；不要重复同样的错误。`;
}

function busyPhrase(key) {
  if (key === "style") return "样式优化 Agent 正在排版…";
  const a = getRosterEntry(key);
  return `${(a && a.name) || key} 正在工作…`;
}

export async function runOrchestration({ tid, goal, mode = "task", models, team, resumeEvents, ssePush, takeInjections, waitForInjection, control }) {
  const modelFor = (key) => (models && models[key]) || defaultModelFor(key);
  const selectedTeam = [...new Set((team || []).filter((key) => isToolAgentKey(key)))];
  const selectedTeamSet = new Set(selectedTeam);
  const discussionMode = mode === "discussion";
  const discussionExperts = selectedTeam.filter((key) => !["style", "report-writer"].includes(key));
  const requiredDiscussionCount = discussionMode ? Math.min(3, discussionExperts.length) : 0;
  const isAllowedTool = (key) => isToolAgentKey(key) && (!selectedTeamSet.size || selectedTeamSet.has(key));

  const emit = (event) => {
    if (event.transient) { ssePush({ seq: -1, ts: new Date().toISOString(), ...event }); return event; }
    const full = appendEvent(tid, event); ssePush(full); return full;
  };
  const logThinking = (actor, model, r) => {
    appendThinking(tid, {
      actor,
      model,
      kind: r.kind || "agent",
      reasoning: r.reasoning || "",
      raw: r.raw || "",
      attempts: r.attempts,
      ms: r.ms,
      usage: r.usage || {},
    });
  };

  const isResume = Array.isArray(resumeEvents) && resumeEvents.length > 0;
  let resumeNote = "";
  const agentMsgs = new Map();
  const resumeFramed = (key) => {
    if (key === "twin") return `${resumeNote}\n\n你是 Twin，请按职责继续（验收 / 派活 / 代答 / 交付 其一）。`;
    const a = getRosterEntry(key);
    if (key === "style") return `${resumeNote}\n\n你是样式优化 Agent，收到排版任务再开始。`;
    return `${resumeNote}\n\n你是「${(a && a.name) || key}」，请基于以上已发生的协作继续，按协议输出下一步（query / ask / report）。`;
  };
  const msgsFor = async (key) => {
    if (agentMsgs.has(key)) return agentMsgs.get(key);
    const goalKeywords = extractSceneKeywords(goal);
    const systemPrompt = await buildSystemFor(key, "u_local", { goal, sceneKeywords: goalKeywords });
    const arr = [{ role: "system", content: systemPrompt }];
    if (isResume) arr.push({ role: "user", content: resumeFramed(key) });
    agentMsgs.set(key, arr);
    return arr;
  };

  const usageByAgent = new Map();
  const ensureBudget = async (key, force = false) => {
    const msgs = agentMsgs.get(key);
    if (!msgs) return;
    const res = await maybeCompact({ key, model: modelFor(key), messages: msgs, lastUsage: usageByAgent.get(key), emit, config: CONFIG, force });
    if (res.usageRecord) {
      appendThinking(tid, {
        actor: key,
        model: res.usageRecord.model || modelFor(key),
        kind: "compact",
        reasoning: res.usageRecord.reasoning || "",
        raw: res.usageRecord.raw || "",
        attempts: 1,
        ms: res.usageRecord.ms,
        usage: res.usageRecord.usage || {},
      });
    }
    if (res.compacted) agentMsgs.set(key, res.messages);
  };
  const callWithBudget = async (key) => {
    await msgsFor(key);
    await ensureBudget(key);
    let r = await callAgent(modelFor(key), agentMsgs.get(key), key);
    if (!r.json && r.contextOverflow) {
      await ensureBudget(key, true);
      r = await callAgent(modelFor(key), agentMsgs.get(key), key);
    }
    usageByAgent.set(key, r.usage || {});
    return r;
  };

  let turn = "twin";
  let steps = 0;
  let lastReport = null;
  let twinSynthesis = null;
  const discussionReports = [];
  const consultedAgents = new Set();
  let pendingFanout = []; // fanout 模式下等待执行的 Agent 队列

  if (isResume) {
    const main = resumeEvents.filter((e) => e.channel !== "side");
    const sqlByName = {};
    main.forEach((e) => { if (e.kind === "tool_call") sqlByName[e.name] = e.sql || e.text || ""; });
    const doneQueries = main.filter((e) => e.kind === "tool_result").map((e) => e.ok
      ? `- ${e.name}（${sqlByName[e.name] || ""}）成功 ${e.rowCount} 行；列：${(e.columns || []).join(", ")}\n  结果样本：${JSON.stringify((e.records || []).slice(0, 40))}`
      : `- ${e.name} 失败：${e.error || ""}`).join("\n");
    const reportEvents = main.filter((e) => e.kind === "report" && isToolAgentKey(e.actor));
    for (const event of reportEvents) {
      discussionReports.push({ summary: event.summary || "", findings: event.findings || [], by: event.actor });
      if (discussionExperts.includes(event.actor)) consultedAgents.add(event.actor);
    }
    const reportEvt = reportEvents[reportEvents.length - 1];
    if (reportEvt) lastReport = { summary: reportEvt.summary || "", findings: reportEvt.findings || [] };
    const synthesisEvt = [...main].reverse().find((event) => event.actor === "twin" && event.kind === "synthesis");
    if (synthesisEvt) twinSynthesis = normalizeSynthesis(synthesisEvt.synthesis || synthesisEvt, goal);
    const historyBrief = main.map((e) => {
      const ent = getRosterEntry(e.actor);
      const who = e.actor === "user" ? "用户" : e.actor === "system" ? "系统" : (ent && ent.name) || e.actor;
      const t = e.text || e.summary || (e.name ? `查询 ${e.name}` : "");
      return `· ${who}/${e.kind}: ${String(t).slice(0, 80)}`;
    }).join("\n");
    resumeNote = `【任务恢复 · 续跑】此前的协作因服务重启被中断，现在从当前进度继续，请勿从头再来，直接接着往下推进。
用户目标：${goal}
已发生的协作（旧→新）：
${historyBrief}${doneQueries ? `\n\n已完成的真实查询与结果样本：\n${doneQueries}` : ""}`;

    const last = main[main.length - 1] || {};
    if (last.actor === "user" && last.kind === "inject") {
      turn = (last.to === "twin" || isToolAgentKey(last.to)) ? last.to : "twin";
    } else if (last.actor === "twin") {
      if (["assign", "answer", "rework", "beautify", "synthesis"].includes(last.kind)) turn = isToolAgentKey(last.to) ? last.to : "data";
      else if (["deliver", "escalate"].includes(last.kind)) turn = null;
      else turn = "twin";
    } else if (last.kind === "tool_call" || last.kind === "tool_result") {
      const lastCall = [...main].reverse().find((e) => e.kind === "tool_call");
      turn = (lastCall && isToolAgentKey(lastCall.actor)) ? lastCall.actor : "data";
    } else if (isToolAgentKey(last.actor)) {
      turn = "twin";
    } else {
      turn = "twin";
    }
    updateMeta(tid, { status: "执行中" });
    emit({ actor: "system", kind: "notice", text: "检测到该任务此前被中断，正在从当前进度自动续跑…" });
  } else {
    emit({ actor: "user", kind: "goal", text: goal });
    const teamNames = selectedTeam.map((key) => {
      const agent = getRosterEntry(key);
      return `${key}（${agent ? agent.name : key}，模型 ${modelFor(key)}）`;
    }).join("、");
    const discussionBrief = discussionMode
      ? `\n\n【本次模式】多模型圆桌讨论\n【指定团队】${teamNames || "从可用团队中选择"}\n【主持要求】第一轮必须使用 type="assign_many"，同时邀请至少 ${requiredDiscussionCount || 3} 位不同专业 Agent 并行、独立发表；并行结果齐全后，你必须亲自输出 type="synthesize" 形成总结果（共识、分歧、风险、不确定性、建议），Style 只能排版 Twin 的总结；在 Twin 总结完成前禁止 beautify/deliver。`
      : "";
    (await msgsFor("twin")).push({ role: "user", content: `【用户${discussionMode ? "议题" : "目标"}】${goal}${discussionBrief}` });
  }

  const routeInjection = async (inj) => {
    const to = (inj.to === "twin" || isToolAgentKey(inj.to)) ? inj.to : "twin";
    emit({ actor: "user", kind: "inject", channel: "main", to, text: inj.text });
    // 用户插话，清空并行队列，回到用户指定的目标
    pendingFanout = [];
    if (to === "twin") {
      const framing = inj.kind === "reply" ? "【用户回复】" : "【用户 @你 说】";
      (await msgsFor("twin")).push({ role: "user", content: `${framing}${inj.text}` });
    } else {
      const a = getRosterEntry(to);
      (await msgsFor(to)).push({ role: "user", content: `【用户 @你（${(a && a.name) || to}）说】${inj.text}\n（回应后仍把结果交回 Twin）` });
    }
    turn = to;
  };

  const emitBrief = async (decision) => {
    try {
      const msgs = buildBriefMessages(decision);
      const r = await chat({
        model: modelFor("twin"),
        messages: [{ role: "system", content: "用一句话（不超过25字）总结决策，口语化，像项目经理汇报。" }, ...msgs],
        maxTokens: 80,
        temperature: 0.3,
        timeoutMs: 8000,
      });
      logThinking("twin", modelFor("twin"), { ...r, raw: r.content, attempts: 1, kind: "brief" });
      const summary = (r.content || "").trim() || fallbackBrief(decision);
      const cardType = decision.actionType === "beautify" ? "accept" : (decision.actionType || "info");
      ssePush({
        event: "brief",
        data: {
          card_type: cardType,
          summary,
          meta: {
            agent: decision.agent || "",
            question: decision.question || "",
            decision_params: decision.decision_params || {},
          },
          decision_id: decision.decision_id || `D-${Date.now()}`,
          timestamp: new Date().toISOString(),
        },
      });
    } catch {
      try {
        const summary = fallbackBrief(decision);
        ssePush({ event: "brief", data: { card_type: decision.actionType || "info", summary, meta: {}, timestamp: new Date().toISOString() } });
      } catch {}
    }
  };

  // Twin 的并行派发器：每个 Agent 保持独立上下文，并以真正并发的 LLM / 工具调用推进。
  // 单个子任务可在自己的 worker 内连续 query / execute 多轮；报告、确认项和排版稿最后统一交回 Twin。
  const runParallelAssignments = async (rawAssignments) => {
    const seen = new Set();
    const assignments = (Array.isArray(rawAssignments) ? rawAssignments : [])
      .map((item) => ({
        target: typeof item?.target === "string" ? item.target : "",
        message: typeof item?.message === "string" ? item.message.trim() : "",
      }))
      .filter((item) => {
        if (!item.target || !item.message || seen.has(item.target) || !isAllowedTool(item.target)) return false;
        seen.add(item.target);
        return true;
      })
      .slice(0, CONFIG.parallel.maxAgents);

    if (assignments.length < 2) return { ok: false, reason: "assign_many 至少需要两个不同的可用工具 Agent。" };

    const batchId = `P-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    emit({
      actor: "system",
      kind: "parallel_start",
      channel: "main",
      batchId,
      targets: assignments.map((item) => item.target),
      text: `Twin 已并行启动 ${assignments.length} 个 Agent 子任务。`,
    });

    for (const item of assignments) {
      emit({
        actor: "twin",
        kind: "assign",
        channel: "main",
        to: item.target,
        text: item.message,
        parallel: true,
        batchId,
      });
      (await msgsFor(item.target)).push({
        role: "user",
        content: twinToAgentText({ type: "assign", message: item.message }),
      });
      emitBrief({ actionType: "assign", agent: item.target });
    }

    const runWorker = async ({ target: key }) => {
      const agent = getRosterEntry(key);
      const caps = (agent && agent.capabilities) || [];
      let rounds = 0;

      while (rounds < CONFIG.parallel.maxRounds && steps < CONFIG.maxSteps) {
        while (control && control.isPaused() && !control.isAborted()) {
          await new Promise((res) => setTimeout(res, 500));
        }
        if (control && control.isAborted()) return { key, status: "aborted" };

        rounds += 1;
        steps += 1;
        emit({ actor: key, kind: "status", text: `${busyPhrase(key)}（并行 ${rounds}）`, transient: true });
        const r = await callWithBudget(key);
        logThinking(key, modelFor(key), r);
        const action = r.json;
        (await msgsFor(key)).push({ role: "assistant", content: r.raw });

        if (!action) {
          emit({ actor: "system", kind: "error", text: `${agent.name} 的并行输出无法解析，该子任务已停止。` });
          return { key, status: "error", error: "输出无法解析" };
        }

        if (action.type === "query" && caps.includes("query")) {
          const name = (action.name || `${batchId}_${key}_${rounds}`).replace(/[^\w.\-]/g, "_");
          if (!action.sql || !action.sql.trim()) {
            (await msgsFor(key)).push({
              role: "user",
              content: `【格式错误】type="query" 的 sql 不能为空。请重新输出完整、可执行的只读 SELECT JSON。`,
            });
            continue;
          }
          emit({ actor: key, kind: "tool_call", channel: "main", text: action.purpose || "执行查询", sql: action.sql, name, parallel: true, batchId });
          const result = await runQuery(action.sql);
          saveSql(tid, name, action.sql);
          if (result.ok) saveData(tid, name, { sql: action.sql, columns: result.columns, records: result.records });
          emit({
            actor: "system", kind: "tool_result", channel: "main", name, ok: result.ok, ms: result.ms,
            rowCount: result.rowCount, columns: result.columns, colTypes: result.colTypes,
            records: result.ok ? result.records.slice(0, 200) : undefined,
            error: result.error, code: result.code, by: key, parallel: true, batchId,
          });
          (await msgsFor(key)).push({ role: "user", content: toolResultText(name, result) });
          continue;
        }

        if (action.type === "execute" && caps.includes("execute")) {
          const name = (action.name || `${batchId}_${key}_${rounds}`).replace(/[^\w.\-]/g, "_");
          emit({ actor: key, kind: "tool_call", channel: "main", text: action.purpose || "执行代码", code: action.code, name, lang: "python", parallel: true, batchId });
          const result = await runPython(action.code || "");
          emit({
            actor: "system", kind: "tool_result", channel: "main", name, ok: result.ok, ms: result.ms,
            stdout: result.ok ? (result.stdout || "").slice(0, 8000) : undefined,
            stderr: (result.stderr || "").slice(0, 4000),
            error: result.error, code: result.code, lang: "python", by: key, parallel: true, batchId,
          });
          (await msgsFor(key)).push({ role: "user", content: codeResultText(name, result) });
          continue;
        }

        if (action.type === "ask") {
          const questions = normQuestions(action.questions);
          emit({ actor: key, kind: "ask", channel: "main", to: "twin", text: action.message || "", questions, parallel: true, batchId });
          return { key, status: "waiting", action, agent };
        }

        if (action.type === "report") {
          emit({
            actor: key, kind: "report", channel: "main", to: "twin", text: action.message || "",
            summary: action.summary || "", findings: action.findings || [], final: !!action.final,
            artifacts: action.artifacts || [], parallel: true, batchId,
          });
          return {
            key,
            status: "report",
            action,
            agent,
            report: { summary: action.summary || "", findings: action.findings || [], by: key },
          };
        }

        if (action.type === "styled") {
          emit({
            actor: key, kind: "styled", channel: "main", to: "twin", title: action.title || "",
            summary: action.summary || "", highlights: action.highlights || [], sections: action.sections || [],
            text: action.message || "", parallel: true, batchId,
          });
          return { key, status: "styled", action, agent };
        }

        (await msgsFor(key)).push({
          role: "user",
          content: "并行子任务中请从 ask/query/execute/report/styled 选择符合你能力的 type，并只输出一个 JSON 对象。",
        });
      }

      emit({ actor: "system", kind: "notice", channel: "main", text: `${agent.name} 的并行子任务已达到回合上限。` });
      return { key, status: "limit" };
    };

    const results = await Promise.all(assignments.map(runWorker));
    const reports = results.filter((result) => result.status === "report");
    for (const result of reports) {
      lastReport = result.report;
      discussionReports.push(result.report);
      if (discussionExperts.includes(result.key)) consultedAgents.add(result.key);
    }

    const twinMessages = await msgsFor("twin");
    for (const result of results) {
      if (result.status === "report") {
        const remaining = discussionExperts.filter((key) => !consultedAgents.has(key));
        twinMessages.push({
          role: "user",
          content: agentReportText(result.action, result.agent, discussionMode ? { remaining } : null),
        });
      } else if (result.status === "waiting") {
        twinMessages.push({ role: "user", content: agentAskText(result.action, result.agent) });
      } else if (result.status === "styled") {
        twinMessages.push({ role: "user", content: styledReportText(result.action) });
      }
    }

    const resultSummary = results.map((result) => `${result.key}:${result.status}`).join("、");
    twinMessages.push({
      role: "user",
      content: `【并行批次已完成】batch=${batchId}\n${resultSummary}\n请同时审视所有返回结果：必要时再次并行复核；材料齐全后再综合或排版。`,
    });
    emit({
      actor: "system",
      kind: "parallel_done",
      channel: "main",
      batchId,
      targets: assignments.map((item) => item.target),
      text: `并行批次完成：${results.filter((result) => ["report", "styled"].includes(result.status)).length}/${assignments.length} 个子任务已交回成果。`,
    });
    return { ok: true, batchId, results };
  };

  const doReflectAndCalibrate = async () => {
    try {
      const calResult = await calibrate("u_local", tid, (event, data) => {
        if (event === "trust_level") ssePush({ event: "trust_level", data });
      });
      if (calResult && calResult.upgraded) {
        console.log(`[trust] 用户升级: ${calResult.oldLevel} → ${calResult.newLevel} (${calResult.dashboard.approval_rate})`);
      }
    } catch (err) {
      console.error(`[calibrate] 失败: ${err.message}`);
    }

    try {
      const decisions = readDecisions(tid);
      const events = readEvents(tid);
      const decisionsText = summarizeDecisions(decisions);
      const conversationSummary = summarizeConversation(events);
      const msgs = buildReflectMessages({ goal, decisionsText, conversationSummary, deliverablesSummary: discussionMode ? "多模型讨论纪要" : "任务交付物" });
      const r = await chat({
        model: modelFor("twin"),
        messages: [{ role: "system", content: "提取多 Agent 协作中的可复用经验。只输出 JSON。" }, ...msgs],
        maxTokens: 600,
        temperature: 0.2,
        timeoutMs: 15000,
      });
      logThinking("twin", modelFor("twin"), { ...r, raw: r.content, attempts: 1, kind: "reflect" });
      const parsed = parseReflectOutput(r.content);
      if (parsed && parsed.confidence > 0.3 && parsed.scene) {
        const candidatePath = createCandidate("u_local", { ...parsed, tid });
        if (candidatePath) {
          ssePush({ event: "reflect", data: { tid, scene: parsed.scene, confidence: parsed.confidence, candidate_id: candidatePath } });
          console.log(`[reflect] 经验候选已生成: ${parsed.scene} (置信度:${parsed.confidence})`);
        }
      }
    } catch (err) {
      console.error(`[reflect] 经验提取失败（不阻塞交付）: ${err.message}`);
    }
  };

  try {
    while (steps < CONFIG.maxSteps) {
      while (control && control.isPaused() && !control.isAborted()) {
        await new Promise((res) => setTimeout(res, 500));
      }
      if (control && control.isAborted()) {
        emit({ actor: "system", kind: "notice", text: "已按你的请求终止任务。" });
        updateMeta(tid, { status: "已终止" });
        turn = null;
        break;
      }

      const injs = takeInjections ? takeInjections() : [];
      if (injs.length) {
        steps = 0;
        updateMeta(tid, { status: "执行中" });
        for (const inj of injs) await routeInjection(inj);
      }

      if (turn === null) {
        ssePush({ control: "idle", status: getMeta(tid)?.status });
        if (waitForInjection) await waitForInjection(); else break;
        continue;
      }

      steps++;

      if (turn === "twin") {
        emit({ actor: "twin", kind: "status", text: "Twin 正在思考…", transient: true });
        const r = await callWithBudget("twin");
        logThinking("twin", modelFor("twin"), r);
        const a = r.json;
        (await msgsFor("twin")).push({ role: "assistant", content: r.raw });
        if (!a) { emit({ actor: "system", kind: "error", text: "Twin 输出无法解析，已停止。" }); updateMeta(tid, { status: "报错" }); turn = null; continue; }

        if (a.type === "assign_many") {
          const result = await runParallelAssignments(a.assignments);
          if (!result.ok) {
            (await msgsFor("twin")).push({
              role: "user",
              content: `【并行派发格式错误】${result.reason} 请修正 assignments 后重新输出 type="assign_many"，或改用单个 assign。`,
            });
          }
          turn = "twin";
        } else if (["assign", "answer", "rework"].includes(a.type) && isAllowedTool(a.target)) {
          if (a.type === "answer") {
            const trust = getTrust("u_local");
            if (!shouldAutoAnswer("caliber_selection", trust)) {
              emit({ actor: "twin", kind: "escalate", channel: "main", to: "user", text: `(L1 全程监工模式) ${a.message || "需要你的确认"}`, options: [] });
              appendDecision(tid, { question: (a.answers || [{}])[0]?.id || "确认项", answer: "(信任等级不足, 升级用户)", reason: `当前信任等级 ${trust.level}，制度未允许代答` });
              updateMeta(tid, { status: "待确认" });
              turn = null;
              continue;
            }
          }

          if (a.type === "answer" && shouldForceEscalate(a)) {
            emit({ actor: "twin", kind: "escalate", channel: "main", to: "user", text: a.message || "（系统判定为高风险，需要你的确认）", options: [] });
            appendDecision(tid, { question: "硬护栏触发", answer: "(强制升级)", reason: "风险矩阵硬护栏命中" });
            updateMeta(tid, { status: "待确认" });
            turn = null;
          } else {
          const tgt = a.target;
          emit({ actor: "twin", kind: a.type, channel: "main", to: tgt, text: a.message || "", answers: a.answers || undefined, thought: a.thought || undefined });
          if (a.type === "answer" && Array.isArray(a.answers)) {
            for (const ans of a.answers) appendDecision(tid, { question: ans.id, answer: ans.answer, reason: ans.reason });
            writeState(tid, getMeta(tid), readDecisions(tid));
          }
          (await msgsFor(tgt)).push({ role: "user", content: twinToAgentText(a) });
          emitBrief({ actionType: a.type, question: (a.answers || [{}])[0]?.id, answer: (a.answers || [{}])[0]?.answer, reason: (a.answers || [{}])[0]?.reason, agent: tgt });
          turn = tgt;
          }
        } else if (a.type === "synthesize") {
          if (discussionMode && consultedAgents.size < requiredDiscussionCount) {
            const remaining = discussionExperts.filter((key) => !consultedAgents.has(key));
            (await msgsFor("twin")).push({
              role: "user",
              content: `【圆桌流程未完成】目前只有 ${consultedAgents.size}/${requiredDiscussionCount} 位专家完成观点。请先继续 assign_many 给尚未完成的专家：${remaining.join("、")}，结果齐全后再 synthesize。`,
            });
            turn = "twin";
            continue;
          }
          const synthesis = normalizeSynthesis(a.synthesis || a, goal);
          if (!synthesis.summary || !synthesis.consensus.length) {
            (await msgsFor("twin")).push({
              role: "user",
              content: "【总结果不完整】synthesize 必须包含非空的 synthesis.summary 与 synthesis.consensus；同时请明确 differences、risks、uncertainties、recommendations。请基于所有 Agent 报告重新汇总。",
            });
            turn = "twin";
            continue;
          }
          twinSynthesis = synthesis;
          const target = isAllowedTool("style") ? "style" : (isToolAgentKey(a.target) ? a.target : "style");
          emit({
            actor: "twin",
            kind: "synthesis",
            channel: "main",
            to: target,
            text: synthesis.summary,
            synthesis,
            title: synthesis.title,
            consensus: synthesis.consensus,
            differences: synthesis.differences,
            risks: synthesis.risks,
            uncertainties: synthesis.uncertainties,
            recommendations: synthesis.recommendations,
            thought: a.thought || undefined,
          });
          (await msgsFor(target)).push({ role: "user", content: twinSynthesisToStyleText(synthesis, goal) });
          emitBrief({ actionType: "accept", agent: "twin", deliverable: "Twin 总结果" });
          turn = target;
        } else if (a.type === "fanout" && Array.isArray(a.targets) && a.targets.length > 0) {
          // 并行派活：同时给多个工具 Agent 派任务，并行执行
          const validTargets = a.targets.filter(t => t && isToolAgentKey(t.target) && t.message);
          if (validTargets.length === 0) {
            (await msgsFor("twin")).push({ role: "user", content: "fanout.targets 中没有合法的工具 Agent key，请重新输出。" });
            continue;
          }
          emit({ actor: "twin", kind: "fanout", channel: "main", text: a.thought || "并行派发任务", targets: validTargets.map(t => t.target) });
          for (const t of validTargets) {
            const assignMsg = { type: "assign", message: t.message, target: t.target };
            emit({ actor: "twin", kind: "assign", channel: "main", to: t.target, text: t.message, thought: a.thought });
            (await msgsFor(t.target)).push({ role: "user", content: twinToAgentText(assignMsg) });
          }
          emitBrief({ actionType: "fanout", agent_count: validTargets.length, deliverable: "并行任务" });
          // 先让第一个 Agent 开始执行，其他的排队执行
          turn = validTargets[0].target;
          // 标记剩余待执行的 fanout 任务
          pendingFanout = validTargets.slice(1).map(t => t.target);
        } else if (a.type === "beautify") {
          if (discussionMode && consultedAgents.size < requiredDiscussionCount) {
            const remaining = discussionExperts.filter((key) => !consultedAgents.has(key));
            (await msgsFor("twin")).push({
              role: "user",
              content: `【圆桌流程未完成】目前只有 ${consultedAgents.size}/${requiredDiscussionCount} 位专家完成观点。请继续 assign 给尚未参与的专家：${remaining.join("、")}。不得提前排版或交付。`,
            });
            turn = "twin";
            continue;
          }
          if (discussionMode && !twinSynthesis) {
            (await msgsFor("twin")).push({
              role: "user",
              content: "【缺少 Twin 总结】不要把原始 Agent 报告直接交给 Style。请先输出 type=\"synthesize\"，由你亲自形成总结果，再让 Style 只负责排版。",
            });
            turn = "twin";
            continue;
          }
          const tgt = isToolAgentKey(a.target) ? a.target : "style";
          emit({ actor: "twin", kind: "beautify", channel: "main", to: tgt, text: a.message || "把这份结论整理成可交付用户的报告", thought: a.thought || undefined });
          (await msgsFor(tgt)).push({ role: "user", content: tgt === "style" ? twinToStyleText(a, goal, lastReport, discussionReports) : twinToAgentText({ ...a, type: "assign" }) });
          emitBrief({ actionType: "accept", agent: tgt, deliverable: "排版报告" });
          turn = tgt;
        } else if (a.type === "deliver") {
          if (discussionMode && consultedAgents.size < requiredDiscussionCount) {
            const remaining = discussionExperts.filter((key) => !consultedAgents.has(key));
            (await msgsFor("twin")).push({
              role: "user",
              content: `【圆桌流程未完成】还不能交付。请先邀请 ${remaining.join("、")} 完成独立观点与交叉审视。`,
            });
            turn = "twin";
            continue;
          }
          if (discussionMode && !twinSynthesis) {
            (await msgsFor("twin")).push({
              role: "user",
              content: "【禁止直接交付】请先输出 type=\"synthesize\" 汇总全部 Agent 结果；系统会将 Twin 总结交给 Style 排版，排版返回后你再 deliver。",
            });
            turn = "twin";
            continue;
          }
          emit({
            actor: "twin", kind: "deliver", channel: "main", to: "user", text: a.message || "",
            decisions: a.decisions || [], next_steps: a.next_steps || [],
            synthesis: twinSynthesis || undefined,
            thought: a.thought || undefined,
          });
          if (Array.isArray(a.decisions)) for (const d of a.decisions) appendDecision(tid, d);
          updateMeta(tid, { status: "已交付" });
          writeState(tid, getMeta(tid), readDecisions(tid));
          emitBrief({ actionType: "deliver", deliverable: a.title || "分析报告", question_count: (readDecisions(tid) || []).length });
          if (process.env.POST_DELIVERY_LEARNING_ENABLED !== "0") doReflectAndCalibrate();
          turn = null;
        } else if (a.type === "escalate") {
          emit({ actor: "twin", kind: "escalate", channel: "main", to: "user", text: a.message || "", options: a.options || [] });
          updateMeta(tid, { status: "待确认" });
          emitBrief({ actionType: "escalate", question: a.message || "" });
          turn = null;
        } else {
          (await msgsFor("twin")).push({ role: "user", content: "请从 assign/assign_many/answer/rework/synthesize/beautify/deliver/escalate 中选择一个合法 type。assign_many 的 assignments 至少包含两个不同且可用的工具 Agent；讨论模式收齐观点后必须先 synthesize，再由 Style 排版，最后 deliver。请重新输出。" });
        }
      } else if (isToolAgentKey(turn)) {
        const agent = getRosterEntry(turn);
        const caps = (agent && agent.capabilities) || [];
        emit({ actor: turn, kind: "status", text: busyPhrase(turn), transient: true });
        const r = await callWithBudget(turn);
        logThinking(turn, modelFor(turn), r);
        const a = r.json;
        (await msgsFor(turn)).push({ role: "assistant", content: r.raw });
        if (!a) { emit({ actor: "system", kind: "error", text: `${agent.name} 输出无法解析，已停止。` }); updateMeta(tid, { status: "报错" }); turn = null; continue; }

        const type = a.type;
        // 先看是否是控制流类型（ask/report/styled）
        if (CONTROL_TYPES.has(type)) {
          if (type === "ask") {
            const askQuestions = normQuestions(a.questions);
            emit({ actor: turn, kind: "ask", channel: "main", to: "twin", text: a.message || "", questions: askQuestions });
            (await msgsFor("twin")).push({ role: "user", content: agentAskText(a, agent) });
            // 如果有fanout排队，ask需要Twin回答，中断并行队列
            pendingFanout = [];
            turn = "twin";
          } else if (type === "report") {
            lastReport = { summary: a.summary || "", findings: a.findings || [], by: turn };
            discussionReports.push(lastReport);
            if (discussionExperts.includes(turn)) consultedAgents.add(turn);
            emit({ actor: turn, kind: "report", channel: "main", to: "twin", text: a.message || "", summary: a.summary || "", findings: a.findings || [], final: !!a.final, artifacts: a.artifacts || [] });
            const remaining = discussionExperts.filter((key) => !consultedAgents.has(key));
            (await msgsFor("twin")).push({
              role: "user",
              content: agentReportText(a, agent, discussionMode ? { remaining } : null),
            });
            // 如果是fanout模式，且还有待执行的Agent，继续执行下一个
            if (pendingFanout.length > 0) {
              turn = pendingFanout.shift();
              emit({ actor: "system", kind: "notice", text: `继续执行并行任务：${(getRosterEntry(turn)?.name) || turn}`, transient: true });
            } else {
              turn = "twin";
            }
          } else if (type === "styled") {
            emit({ actor: turn, kind: "styled", channel: "main", to: "twin", title: a.title || "", summary: a.summary || "", highlights: a.highlights || [], sections: a.sections || [], text: a.message || "" });
            (await msgsFor("twin")).push({ role: "user", content: styledReportText(a) });
            turn = "twin";
          }
        } else {
          // 交给通用工具层处理
          const tool = toolFor(type);
          if (!tool) {
            (await msgsFor(turn)).push({ role: "user", content: `未知动作 type="${type}"。请只用 ask/report${caps.includes("query") ? "/query" : ""}${caps.includes("execute") ? "/execute_python" : ""}/read_skill/write_file/now 中的合法动作，只输出一个 JSON 对象。` });
            turn = turn;
            continue;
          }
          if (tool.capability && !hasCapability(turn, tool.capability)) {
            (await msgsFor(turn)).push({ role: "user", content: `你不具备「${tool.capability}」能力，无法执行 ${type}。若确需，请在 report 里建议 Twin 改派给具备该能力的 Agent。` });
            turn = turn;
            continue;
          }
          // 执行工具
          const out = await runTool(type, a, { tid, agentKey: turn });
          if (out.retry) {
            (await msgsFor(turn)).push({ role: "user", content: out.correction });
            turn = turn;
            continue;
          }
          if (out.callEvent) emit({ actor: turn, kind: "tool_call", channel: "main", ...out.callEvent });
          if (out.resultEvent) emit({ actor: "system", kind: "tool_result", channel: "main", by: turn, ...out.resultEvent });
          (await msgsFor(turn)).push({ role: "user", content: out.forLLM });
          turn = turn;
        }
      } else {
        turn = "twin";
      }
    }

    if (turn !== null) {
      emit({ actor: "system", kind: "notice", text: `已达回合上限（${CONFIG.maxSteps}），任务暂停。可 @ 相关方继续。` });
      updateMeta(tid, { status: "已暂停" });
    }
  } catch (err) {
    emit({ actor: "system", kind: "error", text: `编排出错：${err.code || ""} ${String(err.message).slice(0, 300)}` });
    updateMeta(tid, { status: "报错" });
  }
}

export async function runTwinInquiry({ tid, models, question, ssePush }) {
  const twinModel = (models && models.twin) || defaultModelFor("twin");
  const meta = getMeta(tid);
  const decisions = readDecisions(tid);
  const events = readEvents(tid).filter((e) => e.channel !== "side");
  const recent = events.slice(-14).map((e) => {
    const t = e.text || e.summary || (e.questions ? "（确认项）" : "") || (e.sql ? `查询 ${e.name || ""}` : "");
    return `${e.actor}/${e.kind}: ${String(t).slice(0, 90)}`;
  }).join("\n");
  const decLines = decisions.length ? decisions.map((d) => `- ${d.question || d.summary || ""} → ${d.answer || ""}`).join("\n") : "（暂无）";

  const sys = `你是用户的数字分身「Twin」。用户在工作区的"与 Twin 私聊"侧边栏里，随时问你关于当前协作议题或任务的**进度 / 过程 / 各 Agent 的观点 / 你替他做了什么决定**。请以简洁、亲切、结论优先的中文口语回答，像圆桌主持人向本人快速汇报。不要输出 JSON，不要 markdown 代码块，控制在 2~5 句话。`;
  const ctx = `【任务目标】${meta?.goal || ""}
【当前状态】${meta?.status || ""}
【我替用户做的决定】
${decLines}
【最近动态（旧→新）】
${recent || "（刚开始，还没有动态）"}

【用户在私聊里问你】${question}`;

  ssePush(appendEvent(tid, { actor: "user", kind: "inquiry", channel: "side", text: question }));
  emit_side_typing(ssePush);
  let answer = "";
  try {
    const r = await chat({ model: twinModel, messages: [{ role: "system", content: sys }, { role: "user", content: ctx }], maxTokens: 1200, temperature: 0.4 });
    appendThinking(tid, {
      actor: "twin",
      model: twinModel,
      kind: "inquiry",
      reasoning: r.reasoning || "",
      raw: r.content || "",
      attempts: 1,
      ms: r.ms,
      usage: r.usage || {},
    });
    answer = (r.content || "").trim();
  } catch (err) {
    answer = `（我这边查询进度时出了点岔子：${String(err.message).slice(0, 120)}）`;
  }
  if (!answer) answer = "我正在推进这个任务，稍后把结论同步给你。";
  ssePush(appendEvent(tid, { actor: "twin", kind: "inquiry_reply", channel: "side", text: answer }));
  return answer;
}

function emit_side_typing(ssePush) {
  ssePush({ seq: -1, ts: new Date().toISOString(), actor: "twin", kind: "status", channel: "side", text: "Twin 正在看进度…", transient: true });
}
