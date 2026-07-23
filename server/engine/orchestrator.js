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
import { runQuery } from "../integrations/data-query.js";
import { runPython } from "../integrations/sandbox.js";
import { CONFIG } from "../config.js";
import { appendEvent, appendDecision, appendThinking, updateMeta, writeState, getMeta, readDecisions, readEvents, saveSql, saveData, appendFeedback } from "../domain/store.js";
import { buildSystemFor, buildBriefMessages, fallbackBrief, buildReflectMessages, parseReflectOutput, summarizeDecisions, summarizeConversation, extractSceneKeywords } from "../prompts/index.js";
import { getRosterEntry, isToolAgentKey, defaultModelFor } from "../domain/roster.js";
import { normQuestions } from "../domain/events.js";
import { maybeCompact } from "./compact.js";
import { getRiskConfig } from "../domain/risk.js";
import { getTrust, shouldAutoAnswer } from "../domain/trust.js";
import { calibrate } from "../domain/calibrate.js";
import { createCandidate } from "../domain/experience.js";

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
function twinToStyleText(a, goal, lastReport) {
  const rep = lastReport
    ? `\n【待优化的分析结论】\n结论：${lastReport.summary || ""}\n发现：\n${(lastReport.findings || []).map((f) => `- ${f}`).join("\n")}`
    : "";
  return `【Twin 请你美化排版】\n用户目标：${goal}${rep}\nTwin 说明：${a.message || ""}\n请把它整理成结构清晰、可直接交付给用户的报告，只输出规定的 JSON。`;
}
function agentAskText(a, agent) {
  const questions = normQuestions(a.questions);
  const qs = questions.map((q) => `- [${q.id || "?"}] ${q.text || "(空)"}｜选项:${(q.options || []).join("/")}｜推荐:${q.recommendation || "-"}｜风险:${q.risk || "low"}`);
  return `【${agent.name}（key=${agent.key}）的确认项】${a.message || ""}\n${qs.join("\n")}\n（你回答时 target 用 "${agent.key}"）`;
}
function agentReportText(a, agent) {
  const fs = (a.findings || []).map((f) => `- ${f}`).join("\n");
  return `【${agent.name}（key=${agent.key}）${a.final ? "最终" : ""}报告】${a.message || ""}\n结论：${a.summary || ""}\n发现：\n${fs}\n\n请你以用户视角验收：有硬伤就打回（target="${agent.key}", type="rework"）；通过就交给样式优化 Agent 排版（target="style", type="beautify"）。`;
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

export async function runOrchestration({ tid, goal, models, team, resumeEvents, ssePush, takeInjections, waitForInjection, control }) {
  const modelFor = (key) => (models && models[key]) || defaultModelFor(key);

  const emit = (event) => {
    if (event.transient) { ssePush({ seq: -1, ts: new Date().toISOString(), ...event }); return event; }
    const full = appendEvent(tid, event); ssePush(full); return full;
  };
  const logThinking = (actor, model, r) => {
    appendThinking(tid, { actor, model, reasoning: r.reasoning || "", raw: r.raw || "", attempts: r.attempts, ms: r.ms, usage: r.usage || {} });
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

  if (isResume) {
    const main = resumeEvents.filter((e) => e.channel !== "side");
    const sqlByName = {};
    main.forEach((e) => { if (e.kind === "tool_call") sqlByName[e.name] = e.sql || e.text || ""; });
    const doneQueries = main.filter((e) => e.kind === "tool_result").map((e) => e.ok
      ? `- ${e.name}（${sqlByName[e.name] || ""}）成功 ${e.rowCount} 行；列：${(e.columns || []).join(", ")}\n  结果样本：${JSON.stringify((e.records || []).slice(0, 40))}`
      : `- ${e.name} 失败：${e.error || ""}`).join("\n");
    const reportEvt = [...main].reverse().find((e) => e.kind === "report");
    if (reportEvt) lastReport = { summary: reportEvt.summary || "", findings: reportEvt.findings || [] };
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
      if (["assign", "answer", "rework", "beautify"].includes(last.kind)) turn = isToolAgentKey(last.to) ? last.to : "data";
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
    (await msgsFor("twin")).push({ role: "user", content: `【用户目标】${goal}` });
  }

  const routeInjection = async (inj) => {
    const to = (inj.to === "twin" || isToolAgentKey(inj.to)) ? inj.to : "twin";
    emit({ actor: "user", kind: "inject", channel: "main", to, text: inj.text });
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
      const msgs = buildReflectMessages({ goal, decisionsText, conversationSummary, deliverablesSummary: "分析报告" });
      const r = await chat({
        model: modelFor("twin"),
        messages: [{ role: "system", content: "提取数据分析经验。只输出 JSON。" }, ...msgs],
        maxTokens: 600,
        temperature: 0.2,
        timeoutMs: 15000,
      });
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

        if (["assign", "answer", "rework"].includes(a.type) && isToolAgentKey(a.target)) {
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
        } else if (a.type === "beautify") {
          const tgt = isToolAgentKey(a.target) ? a.target : "style";
          emit({ actor: "twin", kind: "beautify", channel: "main", to: tgt, text: a.message || "把这份结论整理成可交付用户的报告", thought: a.thought || undefined });
          (await msgsFor(tgt)).push({ role: "user", content: tgt === "style" ? twinToStyleText(a, goal, lastReport) : twinToAgentText({ ...a, type: "assign" }) });
          emitBrief({ actionType: "accept", agent: tgt, deliverable: "排版报告" });
          turn = tgt;
        } else if (a.type === "deliver") {
          emit({ actor: "twin", kind: "deliver", channel: "main", to: "user", text: a.message || "", decisions: a.decisions || [], next_steps: a.next_steps || [], thought: a.thought || undefined });
          if (Array.isArray(a.decisions)) for (const d of a.decisions) appendDecision(tid, d);
          updateMeta(tid, { status: "已交付" });
          writeState(tid, getMeta(tid), readDecisions(tid));
          emitBrief({ actionType: "deliver", deliverable: a.title || "分析报告", question_count: (readDecisions(tid) || []).length });
          doReflectAndCalibrate();
          turn = null;
        } else if (a.type === "escalate") {
          emit({ actor: "twin", kind: "escalate", channel: "main", to: "user", text: a.message || "", options: a.options || [] });
          updateMeta(tid, { status: "待确认" });
          emitBrief({ actionType: "escalate", question: a.message || "" });
          turn = null;
        } else {
          (await msgsFor("twin")).push({ role: "user", content: "请从 assign/answer/rework/beautify/deliver/escalate 中选择一个合法 type，且 assign/answer/rework 的 target 必须是团队清单里存在的工具 Agent key。请重新输出。" });
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

        if (a.type === "query" && caps.includes("query")) {
          const name = (a.name || `T${steps}`).replace(/[^\w.\-]/g, "_");
          if (!a.sql || !a.sql.trim()) {
            (await msgsFor(turn)).push({ role: "user", content: `【格式错误】你输出了 type="query" 但 sql 字段为空。请重新输出完整的 JSON，确保 sql 字段包含可执行的 SELECT 语句。参考格式：{ "thought":"...", "type":"query", "name":"T${steps}_xxx", "purpose":"查询目的", "sql":"SELECT ... FROM ... WHERE ..." }` });
            turn = turn;
          } else {
          emit({ actor: turn, kind: "tool_call", channel: "main", text: a.purpose || "执行查询", sql: a.sql, name });
          const res = await runQuery(a.sql || "");
          saveSql(tid, name, a.sql || "");
          if (res.ok) saveData(tid, name, { sql: a.sql, columns: res.columns, records: res.records });
          emit({
            actor: "system", kind: "tool_result", channel: "main", name, ok: res.ok, ms: res.ms,
            rowCount: res.rowCount, columns: res.columns, colTypes: res.colTypes,
            records: res.ok ? res.records.slice(0, 200) : undefined,
            error: res.error, code: res.code, by: turn,
          });
          (await msgsFor(turn)).push({ role: "user", content: toolResultText(name, res) });
          turn = turn;
          }
        } else if (a.type === "execute" && caps.includes("execute")) {
          const en = (a.name || `E${steps}`).replace(/[^\w.\-]/g, "_");
          emit({ actor: turn, kind: "tool_call", channel: "main", text: a.purpose || "执行代码", code: a.code, name: en, lang: "python" });
          const res = await runPython(a.code || "");
          emit({
            actor: "system", kind: "tool_result", channel: "main", name: en, ok: res.ok, ms: res.ms,
            stdout: res.ok ? (res.stdout || "").slice(0, 8000) : undefined,
            stderr: (res.stderr || "").slice(0, 4000),
            error: res.error, code: res.code, lang: "python",
          });
          (await msgsFor(turn)).push({ role: "user", content: codeResultText(en, res) });
          turn = turn;
        } else if (a.type === "ask") {
          const askQuestions = normQuestions(a.questions);
          emit({ actor: turn, kind: "ask", channel: "main", to: "twin", text: a.message || "", questions: askQuestions });
          (await msgsFor("twin")).push({ role: "user", content: agentAskText(a, agent) });
          turn = "twin";
        } else if (a.type === "report") {
          lastReport = { summary: a.summary || "", findings: a.findings || [], by: turn };
          emit({ actor: turn, kind: "report", channel: "main", to: "twin", text: a.message || "", summary: a.summary || "", findings: a.findings || [], final: !!a.final, artifacts: a.artifacts || [] });
          (await msgsFor("twin")).push({ role: "user", content: agentReportText(a, agent) });
          turn = "twin";
        } else if (a.type === "styled") {
          emit({ actor: turn, kind: "styled", channel: "main", to: "twin", title: a.title || "", summary: a.summary || "", highlights: a.highlights || [], sections: a.sections || [], text: a.message || "" });
          (await msgsFor("twin")).push({ role: "user", content: styledReportText(a) });
          turn = "twin";
        } else {
          (await msgsFor(turn)).push({ role: "user", content: "请从 ask/query/report 中选择一个合法 type 再输出（只输出一个 JSON 对象）。" });
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

  const sys = `你是用户的数字分身「Twin」。用户在工作区的"与 Twin 私聊"侧边栏里，随时问你关于当前这个数据分析任务的**进度 / 过程 / 你替他做了什么决定**之类的问题。请以简洁、亲切、结论优先的中文口语回答，像分身向本人快速汇报。不要输出 JSON，不要 markdown 代码块，控制在 2~5 句话。`;
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
