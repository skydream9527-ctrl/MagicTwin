"use strict";
// $ / el / esc 来自 shared/dom.js；renderMarkdown / mdInline 来自 shared/markdown.js；
// AGENT_ROSTER / AGENT_KEYS / AGENT_META 来自 shared/roster.js（均以 classic script 先于本文件加载）

const DISCUSSION_TEAM = ["researcher", "concept", "critic", "style"];
const STARTERS = [
  "分析当前 AI Agent 市场的热点方向：哪些是真趋势，哪些可能只是短期泡沫？",
  "讨论什么是 Context Engineering：它和 Prompt Engineering、RAG 有什么本质区别？",
  "多 Agent 系统什么时候会优于单 Agent？请讨论收益、协作成本和失败条件。",
  "比较 RAG、长上下文与 Agentic Search：它们分别适合解决什么问题？",
];
// @ 提及展示用的名称：从 roster 派生，外加 "user"（你）这个虚拟 target
const TARGET_FULL = Object.fromEntries(AGENT_ROSTER.map((a) => [a.key, a.name]));
TARGET_FULL.user = "你";
function atTag(to) { return `<span class="at ${to}">@${esc(TARGET_FULL[to] || to)}</span>`; }
const ARROW = `<span class="arrow">→</span>`;

let es = null;
let curTid = null;
let curMode = "discussion";
let curTeam = [...DISCUSSION_TEAM];
let curUsage = null;
let usageRefreshTimer = null;
// 当前任务的模型映射，键为 agent key（任意 roster 中的 Agent 都可能出现）
let curModels = {};
const pendingEcho = []; // 本地已乐观回显、等待服务端事件去重的插话 {to,text}

// 记忆的 Agent 模型配置（来自 /api/agent-config，可在配置页修改）
let curConfig = {};

// ---------- 初始化 ----------
async function init() {
  try {
    const h = await (await fetch("/api/health")).json();
    const isMock = h.llm?.backend === "mock";
    const m = $("#healthLLM");
    m.textContent = isMock ? "LLM Mock" : h.hasKey ? "LLM 已连接" : "LLM 未配置";
    m.className = "chip " + (h.hasKey ? "ok" : "bad");
    const d = $("#healthDataQuery"); d.textContent = h.dataQuery?.real ? "数据源已连接" : "演示模式"; d.className = "chip " + (h.dataQuery?.real ? "ok" : "");
  } catch {}

  const box = $("#starters");
  STARTERS.forEach((s) => { const c = el("span", "starter", esc(s)); c.onclick = () => { $("#goalInput").value = s; }; box.appendChild(c); });
  $("#startBtn").onclick = start;
  $("#newTaskBtn").onclick = () => location.reload();
  $("#artifactsBtn").onclick = () => showDetailsDrawer("artifacts");
  $("#artifactsOpenFull").onclick = () => { if (curTid) window.open(`/artifacts.html?tid=${curTid}`, "_blank"); };
  $("#tokenUsageChip").onclick = () => { showDetailsDrawer("usage"); refreshUsage(); };

  // 主对话区 @ 提及插话
  $("#injectSend").onclick = doInject;
  $("#injectInput").addEventListener("keydown", (e) => { if (e.key === "Enter") doInject(); });
  // Twin 私聊与过程产物共用浮动详情面板。
  $("#sideToggle").onclick = () => {
    if ($("#sidePanel").classList.contains("hidden")) showDetailsDrawer("twin");
    else closeDetailsDrawer();
  };
  $("#sideClose").onclick = closeDetailsDrawer;
  $("#drawerTwinTab").onclick = () => showDetailsDrawer("twin");
  $("#drawerArtifactsTab").onclick = () => showDetailsDrawer("artifacts");
  $("#drawerUsageTab").onclick = () => { showDetailsDrawer("usage"); refreshUsage(); };
  $("#sideSend").onclick = doInquiry;
  $("#sideInput").addEventListener("keydown", (e) => { if (e.key === "Enter") doInquiry(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDetailsDrawer(); });
  initDrawerInteraction();

  renderHomeAgents();
  renderUseModelsChips();   // 「本次使用」chips：从 roster 动态生成
  renderInjectTarget();     // @ 提及下拉：从 roster 动态生成
  await loadAgentConfig();
  loadHistory();
}

// 渲染首页「本次使用」模型 chips（动态从 roster 派生，避免硬编码 twin/data/style）
function renderUseModelsChips() {
  const box = $("#useModels"); if (!box) return;
  const activeKeys = new Set(["twin", ...DISCUSSION_TEAM]);
  box.innerHTML = AGENT_ROSTER.filter((a) => activeKeys.has(a.key)).map((a) =>
    `<span class="um-chip" id="um-${a.key}" title="${esc(a.name)} · 当前模型">${esc(shortName(a.name))} …</span>`
  ).join("");
}
// 渲染工作区 @ 提及下拉（动态从 roster 派生）
function renderInjectTarget() {
  const sel = $("#injectTarget"); if (!sel) return;
  sel.innerHTML = AGENT_ROSTER.map((a) =>
    `<option value="${a.key}">@ ${esc(a.name)}</option>`
  ).join("");
}
// 短名：去掉「Agent」/「· 数字分身」之类后缀，让 chip 文字更紧凑
function shortName(name) {
  return String(name).replace(/\s*·.*$/, "").replace(/\s*Agent$/, "").trim();
}

// 读取记忆的 Agent 模型配置，回填新任务区「本次使用」与首页 Agent 卡片
async function loadAgentConfig() {
  try {
    const c = await (await fetch("/api/agent-config")).json();
    // 后端返回 { config: {<key>:<model>}, keys: [...] }；兼容旧版直接平铺返回
    curConfig = { ...(c.config || c) };
  } catch {}
  // 回填首页 chips
  AGENT_KEYS.forEach((k) => {
    const chip = $("#um-" + k); if (chip) chip.textContent = `${shortName(AGENT_META[k].name)} · ${shortModel(curConfig[k])}`;
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
    if (!tasks.length) { box.appendChild(el("div", "muted", "还没有讨论，先发起一个议题吧")); return; }
    tasks.slice(0, 12).forEach((t) => {
      const card = el("div", "history-item");
      card.innerHTML = `<div class="hi-goal">${esc(t.goal)}</div><div class="hi-meta"><span class="badge ${t.status}">${esc(t.status)}</span><span class="hi-date">${fmtWhen(t.createdAt)}</span></div>`;
      card.onclick = () => openTask(t.tid);
      box.appendChild(card);
    });
  } catch {}
}
function fmtWhen(iso) { try { const d = new Date(iso); const p = (n) => String(n).padStart(2, "0"); return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; } catch { return ""; } }

function showDetailsDrawer(pane = "twin") {
  const isTwin = pane === "twin";
  const isArtifacts = pane === "artifacts";
  const isUsage = pane === "usage";
  $("#sidePanel").classList.remove("hidden");
  // 详情面板是非阻塞工作区：主对话仍可点击，只有明确的关闭按钮 / Esc 会关闭。
  $("#drawerScrim").classList.add("hidden");
  $("#drawerTwinPane").classList.toggle("hidden", !isTwin);
  $("#drawerArtifactsPane").classList.toggle("hidden", !isArtifacts);
  $("#drawerUsagePane").classList.toggle("hidden", !isUsage);
  $("#drawerTwinTab").classList.toggle("active", isTwin);
  $("#drawerArtifactsTab").classList.toggle("active", isArtifacts);
  $("#drawerUsageTab").classList.toggle("active", isUsage);
  $("#drawerTwinTab").setAttribute("aria-selected", String(isTwin));
  $("#drawerArtifactsTab").setAttribute("aria-selected", String(isArtifacts));
  $("#drawerUsageTab").setAttribute("aria-selected", String(isUsage));
  $("#sideToggle").setAttribute("aria-expanded", "true");
  if (isUsage) renderUsage(curUsage);
  requestAnimationFrame(clampDrawerIntoViewport);
}
function closeDetailsDrawer() {
  $("#sidePanel").classList.add("hidden");
  $("#drawerScrim").classList.add("hidden");
  $("#sideToggle").setAttribute("aria-expanded", "false");
}

// ---------- 浮动详情面板：拖动 / 缩放 / 位置记忆 ----------
const DRAWER_STATE_KEY = "magictwin.drawer.geometry.v1";
let drawerDrag = null;
let drawerResize = null;

function isDesktopDrawer() {
  return window.matchMedia("(min-width: 761px)").matches;
}

function saveDrawerGeometry() {
  const panel = $("#sidePanel");
  if (!panel || panel.classList.contains("hidden") || !isDesktopDrawer()) return;
  const rect = panel.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;
  try {
    localStorage.setItem(DRAWER_STATE_KEY, JSON.stringify({
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }));
  } catch {}
}

function restoreDrawerGeometry() {
  const panel = $("#sidePanel");
  if (!panel || !isDesktopDrawer()) return;
  try {
    const saved = JSON.parse(localStorage.getItem(DRAWER_STATE_KEY) || "null");
    if (!saved || ![saved.left, saved.top, saved.width, saved.height].every(Number.isFinite)) return;
    panel.style.left = `${saved.left}px`;
    panel.style.top = `${saved.top}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.width = `${saved.width}px`;
    panel.style.height = `${saved.height}px`;
  } catch {}
}

function clampDrawerIntoViewport() {
  const panel = $("#sidePanel");
  if (!panel || panel.classList.contains("hidden") || !isDesktopDrawer()) return;
  const rect = panel.getBoundingClientRect();
  const width = Math.min(rect.width, window.innerWidth - 16);
  const height = Math.min(rect.height, window.innerHeight - 16);
  const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
  const top = Math.min(Math.max(8, rect.top), Math.max(8, window.innerHeight - height - 8));
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.right = "auto";
  panel.style.bottom = "auto";
  panel.style.width = `${width}px`;
  panel.style.height = `${height}px`;
}

function initDrawerInteraction() {
  const panel = $("#sidePanel");
  const handle = $("#drawerDragHandle");
  const resizeHandle = $("#drawerResizeHandle");
  if (!panel || !handle || !resizeHandle) return;
  restoreDrawerGeometry();

  handle.addEventListener("pointerdown", (event) => {
    if (!isDesktopDrawer() || event.button !== 0 || event.target.closest("button, input, select, a")) return;
    const rect = panel.getBoundingClientRect();
    drawerDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
    };
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.width = `${rect.width}px`;
    panel.style.height = `${rect.height}px`;
    panel.classList.add("drawer-dragging");
    handle.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  const moveDrawer = (event) => {
    if (!drawerDrag || event.pointerId !== drawerDrag.pointerId) return;
    const rect = panel.getBoundingClientRect();
    const nextLeft = drawerDrag.left + event.clientX - drawerDrag.startX;
    const nextTop = drawerDrag.top + event.clientY - drawerDrag.startY;
    panel.style.left = `${Math.min(Math.max(8, nextLeft), Math.max(8, window.innerWidth - rect.width - 8))}px`;
    panel.style.top = `${Math.min(Math.max(8, nextTop), Math.max(8, window.innerHeight - rect.height - 8))}px`;
    event.preventDefault();
  };
  window.addEventListener("pointermove", moveDrawer);

  const finishDrag = (event) => {
    if (!drawerDrag || event.pointerId !== drawerDrag.pointerId) return;
    handle.releasePointerCapture?.(event.pointerId);
    drawerDrag = null;
    panel.classList.remove("drawer-dragging");
    saveDrawerGeometry();
  };
  window.addEventListener("pointerup", finishDrag);
  window.addEventListener("pointercancel", finishDrag);

  resizeHandle.addEventListener("pointerdown", (event) => {
    if (!isDesktopDrawer() || event.button !== 0) return;
    const rect = panel.getBoundingClientRect();
    drawerResize = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: rect.width,
      height: rect.height,
      left: rect.left,
      top: rect.top,
    };
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.width = `${rect.width}px`;
    panel.style.height = `${rect.height}px`;
    resizeHandle.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  });

  const resizeDrawer = (event) => {
    if (!drawerResize || event.pointerId !== drawerResize.pointerId) return;
    const maxWidth = Math.max(320, window.innerWidth - drawerResize.left - 8);
    const maxHeight = Math.max(340, window.innerHeight - drawerResize.top - 8);
    const width = Math.min(maxWidth, Math.max(320, drawerResize.width + event.clientX - drawerResize.startX));
    const height = Math.min(maxHeight, Math.max(340, drawerResize.height + event.clientY - drawerResize.startY));
    panel.style.width = `${width}px`;
    panel.style.height = `${height}px`;
    event.preventDefault();
  };
  window.addEventListener("pointermove", resizeDrawer);

  const finishResize = (event) => {
    if (!drawerResize || event.pointerId !== drawerResize.pointerId) return;
    resizeHandle.releasePointerCapture?.(event.pointerId);
    drawerResize = null;
    saveDrawerGeometry();
  };
  window.addEventListener("pointerup", finishResize);
  window.addEventListener("pointercancel", finishResize);

  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(() => {
      if (!drawerDrag && !drawerResize) saveDrawerGeometry();
    });
    observer.observe(panel);
  }
  window.addEventListener("resize", () => requestAnimationFrame(clampDrawerIntoViewport));
}

async function start() {
  const goal = $("#goalInput").value.trim();
  if (!goal) return;
  // 把当前记忆的所有 Agent 模型配置作为本次任务的模型映射传给后端
  const models = { ...curConfig };
  $("#startBtn").disabled = true;
  try {
    const team = [...DISCUSSION_TEAM];
    const r = await (await fetch("/api/task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal, models, mode: "discussion", team }),
    })).json();
    if (r.error) { alert(r.error); $("#startBtn").disabled = false; return; }
    curModels = { ...models };
    curMode = "discussion";
    curTeam = team;
    enterWorkspace(goal); connect(r.tid);
  } catch (e) { alert("启动失败：" + e.message); $("#startBtn").disabled = false; }
}

async function openTask(tid) {
  let goal = "", models = {}, mode = "task", team = [];
  try {
    const d = await (await fetch(`/api/task/${tid}`)).json();
    goal = d.meta?.goal || "";
    models = { ...(d.meta?.models || {}) };
    mode = d.meta?.mode || "task";
    team = Array.isArray(d.meta?.team) ? d.meta.team : [];
  } catch {}
  curModels = models;
  curMode = mode;
  curTeam = team;
  enterWorkspace(goal);
  connect(tid);
}

function enterWorkspace(goal) {
  $("#startScreen").classList.add("hidden");
  $("#workspace").classList.remove("hidden");
  $("#homeBtn").classList.remove("hidden");
  $("#newTaskBtn").classList.remove("hidden");
  $("#artifactsBtn").classList.remove("hidden");
  $("#sideToggle").classList.remove("hidden");
  $("#tokenUsageChip").classList.remove("hidden");
  $("#tokenUsageChip").textContent = "Tokens 0";
  curUsage = null;
  lastStyled = null;
  renderUsage(null);
  $("#goalText").textContent = goal;
  $("#feed").innerHTML = "";
  $("#sideFeed").innerHTML = `<div class="muted" style="font-size:12.5px">在这里随时问 Twin：进度到哪了？你替我做了哪些决定？（不会打断主流程）</div>`;
  pendingEcho.length = 0;
  if (window.matchMedia("(min-width: 1180px)").matches) showDetailsDrawer("twin");
  else closeDetailsDrawer();
  // Agent 状态条只展示本次圆桌成员；旧任务没有 team 时仍展示完整花名册。
  const activeKeys = curTeam.length ? new Set(["twin", ...curTeam]) : null;
  $("#agentStrip").innerHTML = AGENT_ROSTER.filter((a) => !activeKeys || activeKeys.has(a.key)).map((a) =>
    agentCardHtml(a.key, a.icon, a.name, curModels[a.key])
  ).join("");
}
// 返回首页：断开当前任务的实时连接，平滑切回启动屏并刷新历史（比整页刷新体验更好）
function goHome() {
  if (es) { es.close(); es = null; }
  curTid = null;
  curMode = "discussion";
  curTeam = [...DISCUSSION_TEAM];
  curUsage = null;
  if (usageRefreshTimer) { clearTimeout(usageRefreshTimer); usageRefreshTimer = null; }
  $("#workspace").classList.add("hidden");
  $("#startScreen").classList.remove("hidden");
  ["homeBtn", "sideToggle", "artifactsBtn", "newTaskBtn", "tokenUsageChip"].forEach((id) => $("#" + id).classList.add("hidden"));
  closeDetailsDrawer();
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
function resetAgents() { AGENT_KEYS.forEach((k) => setAgentStatus(k, "待命", false)); }

// ---------- SSE ----------
function connect(tid) {
  curTid = tid;
  refreshUsage();
  if (es) es.close();
  es = new EventSource(`/api/task/${tid}/stream`);
  es.onmessage = (ev) => {
    let d;
    try { d = JSON.parse(ev.data); } catch { return; }
    handle(d);
    scheduleUsageRefresh(d.control === "done" || d.control === "idle" ? 0 : 300);
  };
  es.onerror = () => {
    // 连接断开（服务重启 / 网络抖动）。CONNECTING 时 EventSource 会自行重试；
    // 若已 CLOSED（不再自动重连），延时主动重建，确保前端与后端持续同步、不落后、能收到 Twin 回应。
    if (es && es.readyState === EventSource.CLOSED && curTid === tid) {
      setTimeout(() => { if (curTid === tid) connect(tid); }, 3000);
    }
  };
}
function setStatus(s) {
  const b = $("#taskStatus");
  if (!s) { b.classList.add("hidden"); updateControlButtons(null); return; }
  b.className = "badge " + s;
  b.textContent = s;
  b.classList.remove("hidden");
  updateControlButtons(s);
}

// ---------- Token 用量统计 ----------
function formatTokens(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`;
  return String(n);
}

function formatLatency(value) {
  const ms = Number(value) || 0;
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function usageRows(items, type) {
  return (items || []).map((item) => {
    const key = type === "agent" ? item.actor : item.model;
    const label = type === "agent"
      ? (AGENT_META[key]?.name || key || "未知 Agent")
      : (key || "未知模型");
    const model = type === "agent" ? (curModels[key] || "") : "";
    return `<div class="usage-row">
      <span class="usage-row-name" title="${esc(label)}">${esc(label)}</span>
      <span class="usage-row-value">${formatTokens(item.totalTokens)}</span>
      <span class="usage-row-meta">${item.calls} 次调用 · 输入 ${formatTokens(item.promptTokens)} · 输出 ${formatTokens(item.completionTokens)}${model ? ` · ${esc(model)}` : ""}</span>
    </div>`;
  }).join("");
}

function renderUsage(usage) {
  const box = $("#usageStats");
  if (!box) return;
  const total = usage?.total;
  if (!total || total.calls === 0) {
    box.innerHTML = `<div class="usage-empty">任务开始后，这里会显示总 Token、输入/输出以及各 Agent 与模型的消耗。</div>`;
    return;
  }
  const detail = [
    total.cachedTokens ? `缓存 ${formatTokens(total.cachedTokens)}` : "",
    total.reasoningTokens ? `推理 ${formatTokens(total.reasoningTokens)}` : "",
    total.unmeteredCalls ? `${total.unmeteredCalls} 次未返回计量` : "",
  ].filter(Boolean).join(" · ");
  box.innerHTML = `
    <div class="usage-summary">
      <div class="usage-metric primary"><span>总 Token</span><strong>${formatTokens(total.totalTokens)}</strong></div>
      <div class="usage-metric"><span>输入 Token</span><strong>${formatTokens(total.promptTokens)}</strong></div>
      <div class="usage-metric"><span>输出 Token</span><strong>${formatTokens(total.completionTokens)}</strong></div>
      <div class="usage-metric"><span>模型调用</span><strong>${total.calls}</strong></div>
      <div class="usage-metric"><span>累计延迟</span><strong>${formatLatency(total.latencyMs)}</strong></div>
    </div>
    ${detail ? `<div class="usage-row-meta" style="margin:9px 2px 0">${esc(detail)}</div>` : ""}
    <div class="usage-section-title">按 Agent</div>
    <div class="usage-list">${usageRows(usage.byAgent, "agent")}</div>
    <div class="usage-section-title">按模型</div>
    <div class="usage-list">${usageRows(usage.byModel, "model")}</div>`;
}

async function refreshUsage() {
  const tid = curTid;
  if (!tid) return;
  try {
    const response = await fetch(`/api/task/${tid}/usage`, { cache: "no-store" });
    if (!response.ok) return;
    const usage = await response.json();
    if (curTid !== tid) return;
    curUsage = usage;
    renderUsage(usage);
    const total = usage?.total?.totalTokens || 0;
    $("#tokenUsageChip").textContent = `Tokens ${formatTokens(total)}`;
    $("#tokenUsageChip").title = `输入 ${formatTokens(usage?.total?.promptTokens)} · 输出 ${formatTokens(usage?.total?.completionTokens)} · ${usage?.total?.calls || 0} 次调用`;
  } catch {}
}

function scheduleUsageRefresh(delay = 300) {
  if (usageRefreshTimer) clearTimeout(usageRefreshTimer);
  usageRefreshTimer = setTimeout(() => {
    usageRefreshTimer = null;
    refreshUsage();
  }, delay);
}

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

  // 主对话区状态灯：任何 roster 中的 Agent 都更新其状态条
  if (kind === "status" && d.transient) { if (AGENT_KEYS.includes(actor)) setAgentStatus(actor, d.text, true); return; }
  if (AGENT_KEYS.includes(actor)) {
    const querying = kind === "tool_call"; // 查询/执行已发起、结果未回，该 Agent 仍在忙，别显示“待命”
    setAgentStatus(actor, querying ? "正在查询…" : "待命", querying);
  }

  if (actor === "user" && kind === "goal") return add(userBubble(curMode === "discussion" ? "你 · 议题" : "你 · 目标", d.text));
  if (actor === "user" && kind === "reply") return add(injectBubble("twin", d.text, "回复"));
  if (actor === "user" && kind === "inject") { if (consumedByEcho(d.to, d.text)) return; return add(injectBubble(d.to, d.text)); }
  // Twin 的派活/回复/打回：to 字段是目标 Agent key（不再硬编码 "data"）
  if (actor === "twin" && kind === "assign") {
    setStatus("执行中");
    return add(routedBubble("twin", "◆", "Twin", d.to, d.parallel ? "并行派发" : "派发任务", d.text));
  }
  if (actor === "twin" && kind === "answer") return add(answerCard(d));
  if (actor === "twin" && kind === "rework") return add(routedBubble("twin", "◆", "Twin", d.to, "打回重做", d.text));
  if (actor === "twin" && kind === "synthesis") return add(synthesisCard(d));
  if (actor === "twin" && kind === "beautify") return add(routedBubble("twin", "◆", "Twin", d.to || "style", "转交排版", d.text));
  if (actor === "twin" && kind === "deliver") { setStatus("已交付"); return add(deliverCard(d)); }
  if (actor === "twin" && kind === "escalate") { setStatus("待确认"); return add(escalateCard(d)); }
  // 任意工具 Agent 的 ask / tool_call / report / styled
  if (AGENT_KEYS.includes(actor) && actor !== "twin" && kind === "ask") return add(confirmCard(d, actor));
  if (AGENT_KEYS.includes(actor) && actor !== "twin" && kind === "tool_call") return add(toolCard(d, actor));
  if (actor === "system" && kind === "tool_result") return attachToolResult(d);
  if (AGENT_KEYS.includes(actor) && actor !== "twin" && kind === "report") return add(reportCard(d, actor));
  if (AGENT_KEYS.includes(actor) && actor !== "twin" && kind === "styled") return add(styledCard(d, actor));
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
function reportCard(d, actor = "data") {
  const meta = AGENT_META[actor] || { name: actor, icon: "■" };
  const m = el("div", `msg ${actor} report`);
  const fs = (d.findings || []).map((f) => `<li>${esc(f)}</li>`).join("");
  m.innerHTML = `<div class="who"><span class="ava ${actor}">${meta.icon}</span>${esc(meta.name)} ${ARROW} ${atTag("twin")} · ${d.final ? "最终报告" : "阶段报告"}</div><div class="body"><b>${esc(d.summary || d.text)}</b>${fs ? `<ul>${fs}</ul>` : ""}</div>`;
  return m;
}
// 记住样式优化 Agent 最近交回的排版稿，供交付卡片复用其高亮排版
let lastStyled = null;
function styledCard(d, actor = "style") {
  lastStyled = { title: d.title || "", summary: d.summary || "", highlights: d.highlights || [], sections: d.sections || [] };
  const meta = AGENT_META[actor] || { name: actor, icon: "■" };
  const c = el("div", "card styled");
  const hls = (d.highlights || []).map((h) => `<span class="hl">${esc(h)}</span>`).join("");
  const secs = (d.sections || []).map((s) => `<div class="styled-sec"><h5>${esc(s.heading || "")}</h5><ul>${(s.bullets || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul></div>`).join("");
  c.innerHTML = `<div class="card-h">${meta.icon} ${esc(meta.name)} ${ARROW} ${atTag("twin")} · 排版稿</div><div class="card-b">
    ${d.title ? `<div class="styled-title">${esc(d.title)}</div>` : ""}
    ${d.summary ? `<div class="styled-tldr">${esc(d.summary)}</div>` : ""}
    ${hls ? `<div class="styled-highlights">${hls}</div>` : ""}
    ${secs}</div>`;
  return c;
}
function synthesisAsStyled(synthesis = {}) {
  const sections = [
    { heading: "共识结论", bullets: synthesis.consensus || [] },
    { heading: "核心分歧", bullets: synthesis.differences || [] },
    { heading: "反例与风险", bullets: synthesis.risks || [] },
    { heading: "不确定性", bullets: synthesis.uncertainties || [] },
    { heading: "下一步建议", bullets: synthesis.recommendations || [] },
  ].filter((section) => section.bullets.length);
  return {
    title: synthesis.title || "Twin 综合结论",
    summary: synthesis.summary || "",
    highlights: [],
    sections,
  };
}
function synthesisCard(d) {
  const synthesis = d.synthesis || d;
  const view = synthesisAsStyled(synthesis);
  const sections = view.sections.map((section) =>
    `<div class="styled-sec"><h5>${esc(section.heading)}</h5><ul>${section.bullets.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></div>`
  ).join("");
  const card = el("div", "card synthesis");
  card.innerHTML = `<div class="card-h">◆ Twin ${ARROW} ${atTag(d.to || "style")} · 总结果汇总</div><div class="card-b">
    <div class="styled-title">${esc(view.title)}</div>
    ${view.summary ? `<div class="styled-tldr">${esc(view.summary)}</div>` : ""}
    ${sections}</div>`;
  return card;
}
function confirmCard(d, actor = "data") {
  const meta = AGENT_META[actor] || { name: actor, icon: "■" };
  const c = el("div", "card confirm");
  const qs = (d.questions || []).map((q) =>
    `<div class="q-item"><div class="qt">${esc(q.text)}<span class="risk ${q.risk === "high" ? "high" : "low"}">${q.risk === "high" ? "高风险" : "低风险"}</span></div>
     <div class="qo">选项：${esc((q.options || []).join(" / ") || "开放")}　推荐：${esc(q.recommendation ?? "-")}</div></div>`).join("");
  c.innerHTML = `<div class="card-h">${meta.icon} ${esc(meta.name)} ${ARROW} ${atTag("twin")} · 抛出确认项（等代答）</div><div class="card-b">${d.text ? `<div class="muted">${esc(d.text)}</div>` : ""}${qs}</div>`;
  return c;
}
function answerCard(d) {
  // answer 事件里有 to（被代答的工具 Agent key），没有则回退 "data"
  const to = d.to || "data";
  const c = el("div", "card answer");
  const items = (d.answers || []).map((a) => `<div class="ans-item"><span class="a">✓ ${esc(a.answer)}</span> <span class="r">— ${esc(a.reason || "")}</span></div>`).join("");
  c.innerHTML = `<div class="card-h">◆ Twin ${ARROW} ${atTag(to)} · 代替你回答确认项（未打扰你）</div><div class="card-b">${d.text ? `<div class="muted">${esc(d.text)}</div>` : ""}${items}</div>`;
  return c;
}
function toolCard(d, actor = "data") {
  const meta = AGENT_META[actor] || { name: actor, icon: "■" };
  const c = el("div", "card tool"); c.dataset.name = d.name || "";
  const isCode = d.lang === "python" || (!!d.code && !d.sql);
  if (isCode) c.dataset.isCode = "1";
  const actionLabel = isCode ? "代码执行" : "真实查询";
  c.innerHTML = `<div class="card-h">🔧 ${esc(meta.name)} ${actionLabel} · ${esc(d.name || "")}</div>
    <div class="card-b"><div class="purpose">${esc(d.text || "")}</div>
    <div class="sqlmini">${esc(d.sql || d.code || "")}</div>
    <div class="rmeta">执行中…</div></div>`;
  return c;
}
function attachToolResult(d) {
  let target = null;
  $("#feed").querySelectorAll(".card.tool").forEach((c) => { if (c.dataset.name === d.name) target = c; });
  const metaEl = target ? target.querySelector(".rmeta") : null;
  // Python 代码执行结果 vs SQL 查询结果：根据是否有 lang=python 区分渲染
  const isCode = d.lang === "python" || (target && target.dataset.isCode === "1");
  if (metaEl) {
    if (d.ok) {
      metaEl.className = "rmeta ok";
      if (isCode) {
        metaEl.innerHTML = `✅ 执行成功 · ${d.ms}ms`;
        // 把 stdout 附在卡片下方
        if (d.stdout) {
          const pre = document.createElement("pre");
          pre.className = "code-out";
          pre.textContent = d.stdout;
          target.querySelector(".card-b").appendChild(pre);
        }
      } else {
        metaEl.innerHTML = `✅ 成功 · ${d.rowCount} 行 · ${d.ms}ms · 真实数据已入库（详情见「过程产物与日志」）`;
      }
    } else {
      metaEl.className = "rmeta err";
      metaEl.innerHTML = `⚠ 失败：${esc(d.error || "")}（${esc(d.code || "")}）— Agent 将据此修正`;
      if (isCode && d.stderr) {
        const pre = document.createElement("pre");
        pre.className = "code-out err";
        pre.textContent = d.stderr;
        target.querySelector(".card-b").appendChild(pre);
      }
    }
  } else {
    if (isCode) add(sysBubble(d.ok ? `代码 ${d.name} 执行成功 (${d.ms}ms)` : `代码 ${d.name} 执行失败：${d.error}`));
    else add(sysBubble(d.ok ? `查询 ${d.name} 成功 ${d.rowCount} 行` : `查询 ${d.name} 失败：${d.error}`));
  }
  $("#feed").scrollTop = $("#feed").scrollHeight;
}
function deliverCard(d) {
  const c = el("div", "card deliver");
  const decs = (d.decisions || []).map((x) => `<div class="dec"><span class="q">${esc(x.question || "")}</span> → <span class="a">${esc(x.answer || "")}</span>${x.reason ? ` <span class="muted">（${esc(x.reason)}）</span>` : ""}</div>`).join("");
  const hasSynthesisSteps = Array.isArray(d.synthesis?.recommendations) && d.synthesis.recommendations.length > 0;
  const steps = (hasSynthesisSteps ? [] : (d.next_steps || [])).map((s) => `<li>${esc(s)}</li>`).join("");
  // 最终内容以 Twin 的 synthesis 为唯一真相源；Style 只能贡献高亮等视觉信息，不能覆盖或删改结论。
  const twinView = d.synthesis ? synthesisAsStyled(d.synthesis) : null;
  const s = twinView
    ? { ...twinView, highlights: lastStyled?.highlights || [] }
    : (d.styled || lastStyled);
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
  showDetailsDrawer("twin");
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
  showDetailsDrawer("twin");
  try {
    const res = await fetch(`/api/task/${curTid}/inquiry`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) });
    if (!res.ok) { const j = await res.json().catch(() => ({})); addSide("twin", `（未能送达：${esc(j.error || res.status)}）`); }
  } catch { addSide("twin", "（发送失败，网络错误）"); }
}

// ---------- 任务控制：暂停 / 恢复 / 终止 / 下载 ----------
function updateControlButtons(status) {
  const pauseBtn = $("#pauseBtn");
  const resumeBtn = $("#resumeBtn");
  const abortBtn = $("#abortBtn");
  const downloadBtn = $("#downloadBtn");
  [pauseBtn, resumeBtn, abortBtn, downloadBtn].forEach(b => b.classList.add("hidden"));
  if (!curTid) return;
  downloadBtn.classList.remove("hidden");
  if (status === "执行中") {
    pauseBtn.classList.remove("hidden");
    abortBtn.classList.remove("hidden");
  } else if (status === "已暂停") {
    resumeBtn.classList.remove("hidden");
    abortBtn.classList.remove("hidden");
  }
}
async function pauseTask() {
  if (!curTid) return;
  try { await fetch(`/api/task/${curTid}/pause`, { method: "POST" }); } catch {}
}
async function resumeTask() {
  if (!curTid) return;
  try { await fetch(`/api/task/${curTid}/resume`, { method: "POST" }); } catch {}
}
async function abortTask() {
  if (!curTid) return;
  if (!confirm("确定终止当前任务吗？终止后无法恢复。")) return;
  try { await fetch(`/api/task/${curTid}/abort`, { method: "POST" }); } catch {}
}
async function downloadBundle() {
  if (!curTid) return;
  window.open(`/api/task/${curTid}/download`, "_blank");
}

// ---------- 信任仪表盘 ----------
async function showTrustDashboard() {
  try {
    const data = await (await fetch("/api/twin/trust")).json();
    const nextReq = data.next_level ? Object.entries(data.next_level.requirements).map(([k, v]) => {
      const name = { tasks: "完成任务", approval_rate: "认可率", experience_packs: "经验包数", consecutive_clean: "连续无纠错" }[k] || k;
      const mark = v.met ? "✅" : "⬜";
      const cur = k.includes("rate") ? Math.round(v.current * 100) + "%" : v.current;
      const tgt = k.includes("rate") ? Math.round(v.target * 100) + "%" : v.target;
      return `${mark} ${name}: ${cur} / ${tgt}`;
    }).join("<br>") : "已达最高等级";
    alert(`📊 Twin 信任仪表盘

当前等级: ${data.level} - ${data.label}
总任务数: ${data.total_tasks}
总决策数: ${data.total_decisions}
用户认可: ${data.approved} (${Math.round(data.approval_rate * 100)}%)
被纠正: ${data.corrected} (${Math.round(data.correction_rate * 100)}%)

表现最好: ${data.highest_performance}
需要关注: ${data.needs_attention}

升级到 ${data.next_level ? data.next_level.level + " " + data.next_level.label : "满级"} 要求:
${nextReq}

（详细 UI 开发中，这是简版提示）`);
  } catch (e) { alert("获取信任数据失败: " + e.message); }
}

// ---------- 风险配置 ----------
async function showRiskConfig() {
  alert("⚠️ 风险规则配置页面开发中...\n\n当前支持通过 API 修改风险分级矩阵，高风险操作（写操作/越权/重查询/业务判断）始终会升级给用户确认。");
}

// ---------- 经验包管理 ----------
async function showExperiencePacks() {
  try {
    const data = await (await fetch("/api/twin/experience")).json();
    const l2 = (data.packs || []).length;
    const l1 = (data.candidates || []).length;
    alert(`📦 经验包管理

已生效经验包 (L2): ${l2} 个
候选经验包 (L1，待审核): ${l1} 个

任务完成后 Twin 会自动提取可复用经验，审核通过后沉淀为个人经验包，后续类似任务自动复用。
（详细管理页面开发中）`);
  } catch (e) { alert("获取经验包失败: " + e.message); }
}

init();
