// 编排引擎：驱动 Twin ⇄ 数据 Agent ⇄ 样式优化 Agent 的有界多轮协作，
// 并支持用户在主对话区通过 @ 提及随时插话（injection）、在副对话区随时问 Twin 进度（inquiry）。
//
// 路由（@ 提及）：
//   - 用户 → 可 @ 任意一方（twin / data / style）
//   - Twin → 可 @ user / data / style
//   - 数据 Agent、样式 Agent → 只能 @ twin
//
// 主循环（turn 表示下一个发言者，null=空闲等待用户）：
//   turn=twin : 调 Twin → assign/answer/rework(→data) | beautify(→style) | deliver/escalate(→user, 转空闲)
//   turn=data : 调数据Agent → query(真实数据查询,结果回喂) | ask(→twin) | report(→twin)
//   turn=style: 调样式Agent → styled(→twin)
//   turn=null : 空闲；等待用户 @ 插话或回复后恢复
//
// 安全阀：单个用户回合内 Agent↔Agent 往返受 maxSteps 限制（每次用户插话重置）；
//         JSON 解析容错 + 多次重试。每次 LLM 调用的 reasoning + 原始输出写入思考日志。
import { chat } from "../integrations/llm.js";
import { runQuery } from "../integrations/data-query.js";
import { CONFIG } from "../config.js";
import { appendEvent, appendDecision, appendThinking, updateMeta, writeState, getMeta, readDecisions, readEvents, saveSql, saveData } from "../domain/store.js";
import { buildTwinSystem } from "../prompts/twin.js";
import { buildDataAgentSystem } from "../prompts/data-agent.js";
import { buildStyleAgentSystem } from "../prompts/style-agent.js";

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
    r = tryParse(slice) || tryParse(slice.replace(/,\s*([}\]])/g, "$1")); // 容忍尾逗号
    if (r) return r;
  }
  return null;
}

// 调一个 Agent，内置多次“只输出 JSON”重试（加大 token + 降温），并对调用异常做退避重试。
// 关键：任何情况下都【不向上抛异常】——彻底失败返回 {json:null, error}，让编排优雅挂起而非整体崩溃断线。
// 返回 {json, raw, reasoning, ms, usage, attempts, error?}
async function callAgent(model, messages, tag = "") {
  const plan = [
    { maxTokens: CONFIG.maxTokens, temperature: 0.3 },
    { maxTokens: CONFIG.maxTokens + 1500, temperature: 0.1 },
    { maxTokens: CONFIG.maxTokens + 1500, temperature: 0 },
  ];
  // 超时/中止（AbortError, DOMException code 20）、连接超时
  const isAbort = (err) => err.name === "AbortError" || err.code === "ABORT_ERR" || err.code === 20 || err.code === "UND_ERR_CONNECT_TIMEOUT" || /abort|timeout/i.test(`${err.code} ${err.message}`);
  // 客户端错误（鉴权失败 / 模型不存在等，429 除外）：重试无意义
  const clientErr = (err) => err.status && err.status >= 400 && err.status < 500 && err.status !== 429;

  let last = { content: "", reasoning: "", usage: {}, ms: 0 };
  let lastErr = null;
  let abortRetries = 0;
  let msgs = messages;
  for (let i = 0; i < plan.length; i++) {
    let r;
    try {
      r = await chat({ model, messages: msgs, maxTokens: plan[i].maxTokens, temperature: plan[i].temperature, timeoutMs: CONFIG.llmTimeoutMs });
    } catch (err) {
      lastErr = err;
      // 客户端错误不重试；超时最多重试 1 次（避免长时间空等）；网络 / 5xx / 429 退避重试
      if (clientErr(err) || (isAbort(err) && abortRetries >= 1)) {
        console.error(`[callAgent ${tag}] 调用失败，不再重试：${err.code || err.name || ""} ${err.message}`);
        break;
      }
      if (isAbort(err)) abortRetries++;
      console.error(`[callAgent ${tag}] 第 ${i + 1} 次调用异常，退避后重试：${err.code || err.name || ""} ${err.message}`);
      await new Promise((res) => setTimeout(res, 800 * (i + 1))); // 线性退避
      continue;
    }
    last = r;
    const json = parseAgentJson(r.content);
    if (json) return { json, raw: r.content, reasoning: r.reasoning, ms: r.ms, usage: r.usage, attempts: i + 1 };
    // 输出无法解析：下一轮追加“只输出 JSON”提示后重试
    msgs = [...messages,
      { role: "assistant", content: (r.content || "(空)").slice(0, 400) },
      { role: "user", content: "上次输出不是可解析的 JSON（可能被截断或夹带多余文字/大段数据）。请【只】输出一个完整且尽量简短的 JSON 对象：不要 markdown、不要解释、findings 用精炼数字而不要塞整张表。" }];
  }
  console.error(`[callAgent ${tag}] 最终失败（attempts=${plan.length}）。`, lastErr ? `错误：${lastErr.code || ""} ${lastErr.message}` : `原文预览：${(last.content || "").slice(0, 200)}`);
  return { json: null, raw: last.content, reasoning: last.reasoning, ms: last.ms, usage: last.usage, attempts: plan.length, error: lastErr ? `${lastErr.code || ""} ${String(lastErr.message).slice(0, 200)}`.trim() : null };
}

// —— Agent 之间“看到”的消息格式化 ——
function twinToDataText(a) {
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
function dataAskText(a) {
  const qs = (a.questions || []).map((q) => `- [${q.id}] ${q.text}｜选项:${(q.options || []).join("/")}｜推荐:${q.recommendation ?? "-"}｜风险:${q.risk || "low"}`);
  return `【数据 Agent 的确认项】${a.message || ""}\n${qs.join("\n")}`;
}
function dataReportText(a) {
  const fs = (a.findings || []).map((f) => `- ${f}`).join("\n");
  return `【数据 Agent ${a.final ? "最终" : ""}报告】${a.message || ""}\n结论：${a.summary || ""}\n发现：\n${fs}\n\n请你以用户视角验收：有硬伤就打回（target=data）；通过就交给样式优化 Agent 排版（target=style, type=beautify）。`;
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

/**
 * 运行一次编排。
 * @param {object} p
 * @param {string} p.tid
 * @param {string} p.goal
 * @param {{twin:string,data:string,style:string}} [p.models]  本任务使用的模型（缺省用 CONFIG）
 * @param {(event:object)=>object} p.ssePush
 * @param {()=>Array<{kind:string,to:string,text:string}>} p.takeInjections  取出并清空用户插话队列
 * @param {()=>Promise<void>} p.waitForInjection  空闲时挂起，直到有新的用户插话/回复
 */
export async function runOrchestration({ tid, goal, models, resumeEvents, ssePush, takeInjections, waitForInjection }) {
  const twinModel = models?.twin || CONFIG.twinModel;
  const dataModel = models?.data || CONFIG.dataModel;
  const styleModel = models?.style || CONFIG.styleModel;

  const emit = (event) => {
    if (event.transient) { ssePush({ seq: -1, ts: new Date().toISOString(), ...event }); return event; }
    const full = appendEvent(tid, event); ssePush(full); return full;
  };
  const logThinking = (actor, model, r) => {
    appendThinking(tid, { actor, model, reasoning: r.reasoning || "", raw: r.raw || "", attempts: r.attempts, ms: r.ms, usage: r.usage || {} });
  };

  const twinMessages = [{ role: "system", content: buildTwinSystem() }];
  const dataMessages = [{ role: "system", content: buildDataAgentSystem() }];
  const styleMessages = [{ role: "system", content: buildStyleAgentSystem() }];

  let turn = "twin";
  let steps = 0;
  let lastReport = null;

  if (Array.isArray(resumeEvents) && resumeEvents.length) {
    // —— 断点续跑：从已持久化事件重建上下文，从当前进度继续（服务重启/刷新后重连触发）——
    const main = resumeEvents.filter((e) => e.channel !== "side");
    const sqlByName = {};
    main.forEach((e) => { if (e.kind === "tool_call") sqlByName[e.name] = e.text || ""; });
    const doneQueries = main.filter((e) => e.kind === "tool_result").map((e) => e.ok
      ? `- ${e.name}（${sqlByName[e.name] || ""}）成功 ${e.rowCount} 行；列：${(e.columns || []).join(", ")}\n  结果样本：${JSON.stringify((e.records || []).slice(0, 40))}`
      : `- ${e.name} 失败：${e.error || ""}`).join("\n");
    const reportEvt = [...main].reverse().find((e) => e.kind === "report");
    if (reportEvt) lastReport = { summary: reportEvt.summary || "", findings: reportEvt.findings || [] };
    const historyBrief = main.map((e) => {
      const who = { user: "用户", twin: "Twin", data: "数据Agent", style: "样式Agent", system: "系统" }[e.actor] || e.actor;
      const t = e.text || e.summary || (e.name ? `查询 ${e.name}` : "");
      return `· ${who}/${e.kind}: ${String(t).slice(0, 80)}`;
    }).join("\n");
    const resumeNote = `【任务恢复 · 续跑】此前的协作因服务重启被中断，现在从当前进度继续，请勿从头再来，直接接着往下推进。
用户目标：${goal}
已发生的协作（旧→新）：
${historyBrief}${doneQueries ? `\n\n已完成的真实查询与结果样本：\n${doneQueries}` : ""}`;
    twinMessages.push({ role: "user", content: `${resumeNote}\n\n你是 Twin，请按职责继续（验收 / 派活 / 代答 / 交付 其一）。` });
    dataMessages.push({ role: "user", content: `${resumeNote}\n\n你是数据分析 Agent，请基于以上已查结果继续分析与归因，按协议输出下一步（query / ask / report）。` });
    styleMessages.push({ role: "user", content: `${resumeNote}\n\n你是样式优化 Agent，收到排版任务再开始。` });
    const last = main[main.length - 1] || {};
    const turnByKind = { deliver: null, escalate: null, tool_result: "data", tool_call: "data", ask: "twin", report: "twin", assign: "data", answer: "data", rework: "data", beautify: "style", styled: "twin" };
    turn = (last.actor === "user" && last.kind === "inject") ? (["twin", "data", "style"].includes(last.to) ? last.to : "twin")
      : (last.kind in turnByKind ? turnByKind[last.kind] : "twin");
    updateMeta(tid, { status: "执行中" });
    emit({ actor: "system", kind: "notice", text: "检测到该任务此前被中断，正在从当前进度自动续跑…" });
  } else {
    emit({ actor: "user", kind: "goal", text: goal });
    twinMessages.push({ role: "user", content: `【用户目标】${goal}` });
  }

  // 把一条用户插话路由到目标 Agent（并在主对话区显示为一条 @ 消息）
  const routeInjection = (inj) => {
    const to = ["twin", "data", "style"].includes(inj.to) ? inj.to : "twin";
    emit({ actor: "user", kind: "inject", channel: "main", to, text: inj.text });
    if (to === "twin") {
      const framing = inj.kind === "reply" ? "【用户回复】" : "【用户 @你 说】";
      twinMessages.push({ role: "user", content: `${framing}${inj.text}` });
    } else if (to === "data") {
      dataMessages.push({ role: "user", content: `【用户 @你（数据 Agent）说】${inj.text}\n（回应后仍把结果交回 Twin）` });
    } else if (to === "style") {
      styleMessages.push({ role: "user", content: `【用户 @你（样式优化 Agent）说】${inj.text}\n（回应后仍把结果交回 Twin）` });
    }
    turn = to;
  };

  try {
    while (steps < CONFIG.maxSteps) {
      // 1) 优先处理用户插话（@ 提及）；有插话则重置本回合步数预算，让后续协作跑得完
      const injs = takeInjections ? takeInjections() : [];
      if (injs.length) {
        steps = 0;
        updateMeta(tid, { status: "执行中" });
        for (const inj of injs) routeInjection(inj);
      }

      // 2) 空闲：已交付/待确认，挂起等待用户 @ 插话或回复
      if (turn === null) {
        ssePush({ control: "idle", status: getMeta(tid)?.status });
        if (waitForInjection) await waitForInjection(); else break;
        continue;
      }

      steps++;

      if (turn === "twin") {
        emit({ actor: "twin", kind: "status", text: "Twin 正在思考…", transient: true });
        const r = await callAgent(twinModel, twinMessages, "twin");
        logThinking("twin", twinModel, r);
        const a = r.json;
        twinMessages.push({ role: "assistant", content: r.raw });
        if (!a) { emit({ actor: "system", kind: "error", text: "Twin 输出无法解析，已停止。" }); updateMeta(tid, { status: "报错" }); turn = null; continue; }

        if (a.target === "data" && ["assign", "answer", "rework"].includes(a.type)) {
          emit({ actor: "twin", kind: a.type, channel: "main", to: "data", text: a.message || "", answers: a.answers || undefined });
          if (a.type === "answer" && Array.isArray(a.answers)) {
            for (const ans of a.answers) appendDecision(tid, { question: ans.id, answer: ans.answer, reason: ans.reason });
            writeState(tid, getMeta(tid), readDecisions(tid));
          }
          dataMessages.push({ role: "user", content: twinToDataText(a) });
          turn = "data";
        } else if (a.type === "beautify" || (a.target === "style")) {
          emit({ actor: "twin", kind: "beautify", channel: "main", to: "style", text: a.message || "把这份结论整理成可交付用户的报告" });
          styleMessages.push({ role: "user", content: twinToStyleText(a, goal, lastReport) });
          turn = "style";
        } else if (a.type === "deliver") {
          emit({ actor: "twin", kind: "deliver", channel: "main", to: "user", text: a.message || "", decisions: a.decisions || [], next_steps: a.next_steps || [] });
          if (Array.isArray(a.decisions)) for (const d of a.decisions) appendDecision(tid, d);
          updateMeta(tid, { status: "已交付" });
          writeState(tid, getMeta(tid), readDecisions(tid));
          turn = null; // 交付后转空闲，用户可继续 @ 追问
        } else if (a.type === "escalate") {
          emit({ actor: "twin", kind: "escalate", channel: "main", to: "user", text: a.message || "", options: a.options || [] });
          updateMeta(tid, { status: "待确认" });
          turn = null; // 等用户回复（通过 /reply → 插话到 twin）后恢复
        } else {
          twinMessages.push({ role: "user", content: "请从 assign/answer/rework/beautify/deliver/escalate 中选择一个合法 type、并给出正确 target 再输出。" });
        }
      } else if (turn === "data") {
        emit({ actor: "data", kind: "status", text: "数据 Agent 正在工作…", transient: true });
        const r = await callAgent(dataModel, dataMessages, "data");
        logThinking("data", dataModel, r);
        const a = r.json;
        dataMessages.push({ role: "assistant", content: r.raw });
        if (!a) { emit({ actor: "system", kind: "error", text: "数据 Agent 输出无法解析，已停止。" }); updateMeta(tid, { status: "报错" }); turn = null; continue; }

        if (a.type === "query") {
          const name = (a.name || `T${steps}`).replace(/[^\w.\-]/g, "_");
          emit({ actor: "data", kind: "tool_call", channel: "main", text: a.purpose || "执行查询", sql: a.sql, name });
          const res = await runQuery(a.sql || "");
          saveSql(tid, name, a.sql || "");
          if (res.ok) saveData(tid, name, { sql: a.sql, columns: res.columns, records: res.records });
          emit({
            actor: "system", kind: "tool_result", channel: "main", name, ok: res.ok, ms: res.ms,
            rowCount: res.rowCount, columns: res.columns, colTypes: res.colTypes,
            records: res.ok ? res.records.slice(0, 200) : undefined,
            error: res.error, code: res.code,
          });
          dataMessages.push({ role: "user", content: toolResultText(name, res) });
          turn = "data";
        } else if (a.type === "ask") {
          emit({ actor: "data", kind: "ask", channel: "main", to: "twin", text: a.message || "", questions: a.questions || [] });
          twinMessages.push({ role: "user", content: dataAskText(a) });
          turn = "twin";
        } else if (a.type === "report") {
          lastReport = { summary: a.summary || "", findings: a.findings || [] };
          emit({ actor: "data", kind: "report", channel: "main", to: "twin", text: a.message || "", summary: a.summary || "", findings: a.findings || [], final: !!a.final, artifacts: a.artifacts || [] });
          twinMessages.push({ role: "user", content: dataReportText(a) });
          turn = "twin";
        } else {
          dataMessages.push({ role: "user", content: "请从 ask/query/report 中选择一个合法 type 再输出。" });
        }
      } else if (turn === "style") {
        emit({ actor: "style", kind: "status", text: "样式优化 Agent 正在排版…", transient: true });
        const r = await callAgent(styleModel, styleMessages, "style");
        logThinking("style", styleModel, r);
        const a = r.json;
        styleMessages.push({ role: "assistant", content: r.raw });
        if (!a) { emit({ actor: "system", kind: "error", text: "样式优化 Agent 输出无法解析，已停止。" }); updateMeta(tid, { status: "报错" }); turn = null; continue; }

        // 样式 Agent 只交回 Twin
        emit({ actor: "style", kind: "styled", channel: "main", to: "twin", title: a.title || "", summary: a.summary || "", highlights: a.highlights || [], sections: a.sections || [], text: a.message || "" });
        twinMessages.push({ role: "user", content: styledReportText(a) });
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

/**
 * 副对话区：用户随时向 Twin 发起状态检查 / 过程询问（与主编排解耦，只读当前进度作答）。
 * Twin 用自然语言口语回答（不走 JSON 协议）。产生两条 side 频道事件（用户问、Twin 答）。
 * @param {object} p {tid, models, question, ssePush}
 * @returns {Promise<string>} Twin 的回答
 */
export async function runTwinInquiry({ tid, models, question, ssePush }) {
  const twinModel = models?.twin || CONFIG.twinModel;
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
【使用模型】Twin=${models?.twin || twinModel} / 数据Agent=${models?.data || "-"} / 样式Agent=${models?.style || "-"}
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
