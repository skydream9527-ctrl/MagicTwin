"use strict";
// $ / el / esc 来自 shared/dom.js；renderMarkdown / mdInline 来自 shared/markdown.js；AGENT_ROSTER 来自 shared/roster.js（均以 classic script 先于本文件加载）

const STARTERS = [
  "看看内容中心最近一周消费时长有没有异常，帮我定位下",
  "内容中心最近 7 天 DAU 趋势，跌了的话按体裁拆一下",
  "对比最近一周和上一周内容中心的人均消费时长",
];
// @ 提及展示用的名称
const TARGET_FULL = { twin: "Twin", data: "数据分析 Agent", style: "样式优化 Agent", user: "你" };
function atTag(to) { return `<span class="at ${to}">@${esc(TARGET_FULL[to] || to)}</span>`; }
const ARROW = `<span class="arrow">→</span>`;

let es = null;
let curTid = null;
let curModels = { twin: "", data: "", style: "" };
const pendingEcho = []; // 本地已乐观回显、等待服务端事件去重的插话 {to,text}

// 记忆的 Agent 模型配置（来自 /api/agent-config，可在配置页修改）
let curConfig = { twin: "", data: "", style: "" };

// ---------- 初始化 ----------
async function init() {
  try {
    const h = await (await fetch("/api/health")).json();
    const m = $("#healthLLM"); m.textContent = h.hasKey ? "LLM 已连接" : "LLM 未配置"; m.className = "chip " + (h.hasKey ? "ok" : "bad");
    const d = $("#healthDataQuery"); d.textContent = h.dataQuery?.real ? "数据源已连接" : "演示模式"; d.className = "chip " + (h.dataQuery?.real ? "ok" : "");
  } catch {}

  const box = $("#starters");
  STARTERS.forEach((s) => { const c = el("span", "starter", esc(s)); c.onclick = () => { $("#goalInput").value = s; }; box.appendChild(c); });
  $("#startBtn").onclick = start;
  $("#newTaskBtn").onclick = () => location.reload();
  $("#artifactsBtn").onclick = () => { if (curTid) window.open(`/artifacts.html?tid=${curTid}`, "_blank"); };

  // 主对话区 @ 提及插话
  $("#injectSend").onclick = doInject;
  $("#injectInput").addEventListener("keydown", (e) => { if (e.key === "Enter") doInject(); });
  // 副对话区：与 Twin 私聊（常驻，按钮可折叠/展开）
  $("#sideToggle").onclick = () => $("#sidePanel").classList.toggle("hidden");
  $("#sideSend").onclick = doInquiry;
  $("#sideInput").addEventListener("keydown", (e) => { if (e.key === "Enter") doInquiry(); });

  renderHomeAgents();
  await loadAgentConfig();
  loadHistory();
}

// 读取记忆的 Agent 模型配置，回填新任务区「本次使用」与首页 Agent 卡片
async function loadAgentConfig() {
  try {
    const c = await (await fetch("/api/agent-config")).json();
    curConfig = { twin: c.twin || "", data: c.data || "", style: c.style || "" };
  } catch {}
  const label = { twin: "Twin", data: "数据", style: "样式" };
  ["twin", "data", "style"].forEach((k) => {
    const chip = $("#um-" + k); if (chip) chip.textContent = `${label[k]} · ${shortModel(curConfig[k])}`;
    const mdl = $("#ha-mdl-" + k); if (mdl) mdl.textContent = curConfig[k] || "默认";
  });
}
function shortModel(m) { if (!m) return "默认"; const i = m.indexOf("/"); return i >= 0 ? m.slice(i + 1) : m; }

// 首页「你的 Agent 团队」卡片（点击进入详情页）
function renderHomeAgents() {
  const box = $("#homeAgents"); if (!box) return;
  box.innerHTML = AGENT_ROSTER.map((a) => `
    <div class="home-agent" role="button" tabindex="0" title="查看 ${esc(a.name)} 的详情与相关文件" onclick="openAgent('${a.key}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openAgent('${a.key}')}">
      <div class="ha-top"><div class="avatar ${a.key}">${a.icon}</div><div class="ha-name">${esc(a.name)}</div></div>
      <div class="ha-tag">${esc(a.tagline)}</div>
      <div class="ha-foot"><span class="ha-mdl" id="ha-mdl-${a.key}">默认</span><span class="ha-go">详情 ›</span></div>
    </div>`).join("");
}

async function loadHistory() {
  try {
    const { tasks } = await (await fetch("/api/tasks")).json();
    const box = $("#historyList"); box.innerHTML = "";
    if (!tasks.length) { box.appendChild(el("div", "muted", "还没有任务，先在上面布置一个吧")); return; }
    tasks.slice(0, 12).forEach((t) => {
      const card = el("div", "history-item");
      card.innerHTML = `<div class="hi-goal">${esc(t.goal)}</div><div class="hi-meta"><span class="badge ${t.status}">${esc(t.status)}</span><span class="hi-date">${fmtWhen(t.createdAt)}</span></div>`;
      card.onclick = () => openTask(t.tid);
      box.appendChild(card);
    });
  } catch {}
}
function fmtWhen(iso) { try { const d = new Date(iso); const p = (n) => String(n).padStart(2, "0"); return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; } catch { return ""; } }

async function start() {
  const goal = $("#goalInput").value.trim();
  if (!goal) return;
  const models = { twin: curConfig.twin, data: curConfig.data, style: curConfig.style };
  $("#startBtn").disabled = true;
  try {
    const r = await (await fetch("/api/task", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal, twinModel: models.twin, dataModel: models.data, styleModel: models.style }) })).json();
    if (r.error) { alert(r.error); $("#startBtn").disabled = false; return; }
    curModels = { ...models };
    enterWorkspace(goal); connect(r.tid);
  } catch (e) { alert("启动失败：" + e.message); $("#startBtn").disabled = false; }
}

async function openTask(tid) {
  let goal = "", models = { twin: "", data: "", style: "" };
  try { const d = await (await fetch(`/api/task/${tid}`)).json(); goal = d.meta?.goal || ""; models = { ...models, ...(d.meta?.models || {}) }; } catch {}
  curModels = models; enterWorkspace(goal); connect(tid);
}

function enterWorkspace(goal) {
  $("#startScreen").classList.add("hidden");
  $("#workspace").classList.remove("hidden");
  $("#homeBtn").classList.remove("hidden");
  $("#newTaskBtn").classList.remove("hidden");
  $("#artifactsBtn").classList.remove("hidden");
  $("#sideToggle").classList.remove("hidden");
  $("#sidePanel").classList.remove("hidden");
  $("#goalText").textContent = goal;
  $("#feed").innerHTML = "";
  $("#sideFeed").innerHTML = `<div class="muted" style="font-size:12.5px">在这里随时问 Twin：进度到哪了？你替我做了哪些决定？（不会打断主流程）</div>`;
  pendingEcho.length = 0;
  $("#agentStrip").innerHTML =
    agentCardHtml("twin", "◆", "Twin · 数字分身", curModels.twin) +
    agentCardHtml("data", "📊", "数据分析 Agent", curModels.data) +
    agentCardHtml("style", "✨", "样式优化 Agent", curModels.style);
}
// 返回首页：断开当前任务的实时连接，平滑切回启动屏并刷新历史（比整页刷新体验更好）
function goHome() {
  if (es) { es.close(); es = null; }
  curTid = null;
  $("#workspace").classList.add("hidden");
  $("#startScreen").classList.remove("hidden");
  ["homeBtn", "sideToggle", "artifactsBtn", "newTaskBtn"].forEach((id) => $("#" + id).classList.add("hidden"));
  setStatus(null);
  $("#startBtn").disabled = false;
  loadHistory();
}
function agentCardHtml(k, icon, name, model) {
  return `<div class="agent-card" role="button" tabindex="0" title="查看该 Agent 的详情与相关文件" onclick="openAgent('${k}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openAgent('${k}')}"><div class="avatar ${k}">${icon}</div><div class="agent-meta"><div class="n">${name}</div><div class="s" id="st-${k}">待命</div><div class="mdl">${esc(model || "-")}</div></div><span class="card-go">详情 ›</span></div>`;
}
// 打开某个 Agent 的详情页（新标签：定位/职责/边界/模型 + 相关文件浏览）
function openAgent(k) { window.open(`/agent.html?key=${encodeURIComponent(k)}`, "_blank"); }
function setAgentStatus(k, text, active) { const e = $("#st-" + k); if (e) { e.textContent = text; e.className = "s" + (active ? " active" : ""); } }
function resetAgents() { ["twin", "data", "style"].forEach((k) => setAgentStatus(k, "待命", false)); }

// ---------- SSE ----------
function connect(tid) {
  curTid = tid;
  if (es) es.close();
  es = new EventSource(`/api/task/${tid}/stream`);
  es.onmessage = (ev) => { let d; try { d = JSON.parse(ev.data); } catch { return; } handle(d); };
  es.onerror = () => {
    // 连接断开（服务重启 / 网络抖动）。CONNECTING 时 EventSource 会自行重试；
    // 若已 CLOSED（不再自动重连），延时主动重建，确保前端与后端持续同步、不落后、能收到 Twin 回应。
    if (es && es.readyState === EventSource.CLOSED && curTid === tid) {
      setTimeout(() => { if (curTid === tid) connect(tid); }, 3000);
    }
  };
}
function setStatus(s) { const b = $("#taskStatus"); if (!s) { b.classList.add("hidden"); return; } b.className = "badge " + s; b.textContent = s; b.classList.remove("hidden"); }

// ---------- 事件处理（主对话区进 feed，side 频道进侧栏）----------
function add(node) {
  const f = $("#feed");
  const nearBottom = f.scrollHeight - f.scrollTop - f.clientHeight < 160; // 仅当已在底部附近才自动滚，避免打断用户回看
  f.appendChild(node);
  if (nearBottom) f.scrollTop = f.scrollHeight;
  return node;
}
// 去重：若这条 user/inject 已被本地乐观回显过，则跳过（返回 true）
function consumedByEcho(to, text) {
  const i = pendingEcho.findIndex((p) => p.to === to && p.text === text);
  if (i >= 0) { pendingEcho.splice(i, 1); return true; }
  return false;
}

function handle(d) {
  if (d.control === "done") { setStatus(d.status); resetAgents(); if (es) es.close(); return; }
  if (d.control === "idle") { setStatus(d.status); resetAgents(); return; }

  const { actor, kind, channel } = d;

  // 侧栏「与 Twin 私聊」
  if (channel === "side") {
    if (kind === "status" && d.transient) return showSideTyping();
    if (actor === "user" && kind === "inquiry") return addSide("user", d.text);
    if (actor === "twin" && kind === "inquiry_reply") { clearSideTyping(); return addSide("twin", d.text); }
    return;
  }

  // 主对话区状态灯
  if (kind === "status" && d.transient) { if (["twin", "data", "style"].includes(actor)) setAgentStatus(actor, d.text, true); return; }
  if (["twin", "data", "style"].includes(actor)) {
    const querying = actor === "data" && kind === "tool_call"; // 查询已发起、结果未回，数据 Agent 仍在忙，别显示“待命”
    setAgentStatus(actor, querying ? "正在查询…" : "待命", querying);
  }

  if (actor === "user" && kind === "goal") return add(userBubble("你 · 目标", d.text));
  if (actor === "user" && kind === "reply") return add(injectBubble("twin", d.text, "回复"));
  if (actor === "user" && kind === "inject") { if (consumedByEcho(d.to, d.text)) return; return add(injectBubble(d.to, d.text)); }
  if (actor === "twin" && kind === "assign") { setStatus("执行中"); return add(routedBubble("twin", "◆", "Twin", "data", "派发任务", d.text)); }
  if (actor === "twin" && kind === "answer") return add(answerCard(d));
  if (actor === "twin" && kind === "rework") return add(routedBubble("twin", "◆", "Twin", "data", "打回重做", d.text));
  if (actor === "twin" && kind === "beautify") return add(routedBubble("twin", "◆", "Twin", "style", "转交排版", d.text));
  if (actor === "twin" && kind === "deliver") { setStatus("已交付"); return add(deliverCard(d)); }
  if (actor === "twin" && kind === "escalate") { setStatus("待确认"); return add(escalateCard(d)); }
  if (actor === "data" && kind === "ask") return add(confirmCard(d));
  if (actor === "data" && kind === "tool_call") return add(toolCard(d));
  if (actor === "system" && kind === "tool_result") return attachToolResult(d);
  if (actor === "data" && kind === "report") return add(reportCard(d));
  if (actor === "style" && kind === "styled") return add(styledCard(d));
  if (actor === "system") return add(sysBubble(d.text));
}

// ---------- 渲染 ----------
function userBubble(who, text) { const m = el("div", "msg user"); m.innerHTML = `<div class="who">${esc(who)}</div><div class="body">${esc(text)}</div>`; return m; }
// 用户 @ 某方 的插话气泡（who 里带彩色 @ 提及）
function injectBubble(to, text, label) {
  const m = el("div", "msg user");
  const head = label ? `你 · ${esc(label)} ${ARROW} ${atTag(to)}` : `你 ${ARROW} ${atTag(to)}`;
  m.innerHTML = `<div class="who">${head}</div><div class="body">${esc(text)}</div>`;
  return m;
}
function sysBubble(text) { const m = el("div", "msg sys"); m.innerHTML = `<div class="body">${esc(text)}</div>`; return m; }
// Agent 发言气泡：明确显示「谁 → @谁」的路由
function routedBubble(fromKey, icon, fromName, toKey, tagline, text) {
  const m = el("div", "msg " + fromKey);
  m.innerHTML = `<div class="who"><span class="ava ${fromKey}">${icon}</span>${esc(fromName)} ${ARROW} ${atTag(toKey)}${tagline ? ` · ${esc(tagline)}` : ""}</div><div class="body">${esc(text)}</div>`;
  return m;
}
function reportCard(d) {
  const m = el("div", "msg data report");
  const fs = (d.findings || []).map((f) => `<li>${esc(f)}</li>`).join("");
  m.innerHTML = `<div class="who"><span class="ava data">📊</span>数据分析 Agent ${ARROW} ${atTag("twin")} · ${d.final ? "最终报告" : "阶段报告"}</div><div class="body"><b>${esc(d.summary || d.text)}</b>${fs ? `<ul>${fs}</ul>` : ""}</div>`;
  return m;
}
// 记住样式优化 Agent 最近交回的排版稿，供交付卡片复用其高亮排版
let lastStyled = null;
function styledCard(d) {
  lastStyled = { title: d.title || "", summary: d.summary || "", highlights: d.highlights || [], sections: d.sections || [] };
  const c = el("div", "card styled");
  const hls = (d.highlights || []).map((h) => `<span class="hl">${esc(h)}</span>`).join("");
  const secs = (d.sections || []).map((s) => `<div class="styled-sec"><h5>${esc(s.heading || "")}</h5><ul>${(s.bullets || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul></div>`).join("");
  c.innerHTML = `<div class="card-h">✨ 样式优化 Agent ${ARROW} ${atTag("twin")} · 排版稿</div><div class="card-b">
    ${d.title ? `<div class="styled-title">${esc(d.title)}</div>` : ""}
    ${d.summary ? `<div class="styled-tldr">${esc(d.summary)}</div>` : ""}
    ${hls ? `<div class="styled-highlights">${hls}</div>` : ""}
    ${secs}</div>`;
  return c;
}
function confirmCard(d) {
  const c = el("div", "card confirm");
  const qs = (d.questions || []).map((q) =>
    `<div class="q-item"><div class="qt">${esc(q.text)}<span class="risk ${q.risk === "high" ? "high" : "low"}">${q.risk === "high" ? "高风险" : "低风险"}</span></div>
     <div class="qo">选项：${esc((q.options || []).join(" / ") || "开放")}　推荐：${esc(q.recommendation ?? "-")}</div></div>`).join("");
  c.innerHTML = `<div class="card-h">📊 数据分析 Agent ${ARROW} ${atTag("twin")} · 抛出确认项（等代答）</div><div class="card-b">${d.text ? `<div class="muted">${esc(d.text)}</div>` : ""}${qs}</div>`;
  return c;
}
function answerCard(d) {
  const c = el("div", "card answer");
  const items = (d.answers || []).map((a) => `<div class="ans-item"><span class="a">✓ ${esc(a.answer)}</span> <span class="r">— ${esc(a.reason || "")}</span></div>`).join("");
  c.innerHTML = `<div class="card-h">◆ Twin ${ARROW} ${atTag("data")} · 代替你回答确认项（未打扰你）</div><div class="card-b">${d.text ? `<div class="muted">${esc(d.text)}</div>` : ""}${items}</div>`;
  return c;
}
function toolCard(d) {
  const c = el("div", "card tool"); c.dataset.name = d.name || "";
  c.innerHTML = `<div class="card-h">🔧 数据 Agent 真实查询 · ${esc(d.name || "")}</div>
    <div class="card-b"><div class="purpose">${esc(d.text || "")}</div>
    <div class="sqlmini">${esc(d.sql || "")}</div>
    <div class="rmeta">执行中…</div></div>`;
  return c;
}
function attachToolResult(d) {
  let target = null;
  $("#feed").querySelectorAll(".card.tool").forEach((c) => { if (c.dataset.name === d.name) target = c; });
  const metaEl = target ? target.querySelector(".rmeta") : null;
  if (metaEl) {
    if (d.ok) { metaEl.className = "rmeta ok"; metaEl.innerHTML = `✅ 成功 · ${d.rowCount} 行 · ${d.ms}ms · 真实数据已入库（详情见「过程产物与日志」）`; }
    else { metaEl.className = "rmeta err"; metaEl.innerHTML = `⚠ 失败：${esc(d.error || "")}（${esc(d.code || "")}）— Agent 将据此修正`; }
  } else {
    add(sysBubble(d.ok ? `查询 ${d.name} 成功 ${d.rowCount} 行` : `查询 ${d.name} 失败：${d.error}`));
  }
  $("#feed").scrollTop = $("#feed").scrollHeight;
}
function deliverCard(d) {
  const c = el("div", "card deliver");
  const decs = (d.decisions || []).map((x) => `<div class="dec"><span class="q">${esc(x.question || "")}</span> → <span class="a">${esc(x.answer || "")}</span>${x.reason ? ` <span class="muted">（${esc(x.reason)}）</span>` : ""}</div>`).join("");
  const steps = (d.next_steps || []).map((s) => `<li>${esc(s)}</li>`).join("");
  const s = d.styled || lastStyled; // 优先用交付事件自带的排版稿，否则用前端记住的最近一份
  let body;
  if (s && (s.title || s.summary || (s.sections || []).length || (s.highlights || []).length)) {
    // 复用样式优化 Agent 的高亮排版：标题 / TL;DR / 关键数字高亮 / 分节
    const hls = (s.highlights || []).map((h) => `<span class="hl">${esc(h)}</span>`).join("");
    const secs = (s.sections || []).map((x) => `<div class="styled-sec"><h5>${esc(x.heading || "")}</h5><ul>${(x.bullets || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul></div>`).join("");
    body = `${s.title ? `<div class="styled-title">${esc(s.title)}</div>` : ""}${s.summary ? `<div class="styled-tldr">${esc(s.summary)}</div>` : ""}${hls ? `<div class="styled-highlights">${hls}</div>` : ""}${secs}`;
  } else {
    body = `<div class="concl md">${renderMarkdown(d.text || "")}</div>`;
  }
  c.innerHTML = `<div class="card-h">🎁 Twin ${ARROW} ${atTag("user")} · 交付（已排版）</div><div class="card-b">
    ${body}
    ${decs ? `<h4>我替你做的决定</h4>${decs}` : ""}
    ${steps ? `<h4>下一步建议</h4><ul>${steps}</ul>` : ""}</div>`;
  return c;
}
function escalateCard(d) {
  const c = el("div", "card escalate");
  const opts = (d.options || []).map((o) => `<button class="opt">${esc(o)}</button>`).join("");
  c.innerHTML = `<div class="card-h">⬆️ Twin ${ARROW} ${atTag("user")} · 需要你拍板（高风险已升级）</div><div class="card-b"><div>${esc(d.text)}</div>
    <div class="reply-box"><input placeholder="回复 Twin…" /><button class="send">回复</button></div>${opts ? `<div class="opts">${opts}</div>` : ""}</div>`;
  const input = c.querySelector("input");
  const doSend = (txt) => { if (!txt) return; sendReply(txt); c.querySelector(".reply-box").innerHTML = `<span class="muted">已回复：${esc(txt)}</span>`; c.querySelectorAll(".opt").forEach((b) => b.disabled = true); };
  c.querySelector(".send").onclick = () => doSend(input.value.trim());
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSend(input.value.trim()); });
  c.querySelectorAll(".opt").forEach((b) => b.onclick = () => doSend(b.textContent));
  return c;
}

// ---------- 与 Twin 私聊（side 频道）----------
let sideTypingEl = null;
function addSide(role, text) {
  const box = $("#sideFeed"); if (!box) return;
  clearSideTyping();
  const first = box.querySelector(".muted"); if (first) first.remove();
  box.appendChild(el("div", "side-msg " + role, esc(text)));
  box.scrollTop = box.scrollHeight;
}
function showSideTyping() {
  const box = $("#sideFeed"); if (!box || sideTypingEl) return;
  $("#sidePanel").classList.remove("hidden"); // Twin 开始作答时确保侧栏可见
  sideTypingEl = el("div", "side-msg twin", `<span class="typing"><i></i><i></i><i></i></span>`);
  box.appendChild(sideTypingEl); box.scrollTop = box.scrollHeight;
}
function clearSideTyping() { if (sideTypingEl) { sideTypingEl.remove(); sideTypingEl = null; } }

// ---------- 用户动作：插话 / 回复 / 私聊 ----------
async function doInject() {
  const input = $("#injectInput"); const text = input.value.trim();
  if (!text || !curTid) return;
  const to = $("#injectTarget").value;
  input.value = "";
  const bubble = add(injectBubble(to, text)); // 立即乐观回显，用户马上看到自己的插话
  pendingEcho.push({ to, text });
  try {
    const res = await fetch(`/api/task/${curTid}/inject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to, text }) });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      consumedByEcho(to, text); // 服务端不会回推，撤销去重占位
      bubble.classList.add("failed");
      bubble.querySelector(".body").insertAdjacentHTML("beforeend", `<div class="send-fail">⚠ 未送达：${esc(j.error || ("HTTP " + res.status))}</div>`);
    }
  } catch {
    consumedByEcho(to, text);
    bubble.classList.add("failed");
    bubble.querySelector(".body").insertAdjacentHTML("beforeend", `<div class="send-fail">⚠ 发送失败（网络错误）</div>`);
  }
}
async function sendReply(text) {
  try { await fetch(`/api/task/${curTid}/reply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }); } catch {}
}
async function doInquiry() {
  const input = $("#sideInput"); const question = input.value.trim();
  if (!question || !curTid) return;
  input.value = "";
  $("#sidePanel").classList.remove("hidden");
  // 用户问题与 Twin 回答都由服务端 side 频道即时回推渲染，这里不本地回显以免重复
  try {
    const res = await fetch(`/api/task/${curTid}/inquiry`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) });
    if (!res.ok) { const j = await res.json().catch(() => ({})); addSide("twin", `（未能送达：${esc(j.error || res.status)}）`); }
  } catch { addSide("twin", "（发送失败，网络错误）"); }
}

init();
