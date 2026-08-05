"use strict";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const FALLBACK_AGENTS = [
  { key: "twin", icon: "◆", color: "twin", name: "Twin · 数字分身", tagline: "唯一编排者：代表你派活 / 代答 / 验收 / 交付" },
  { key: "data", icon: "📊", color: "data", name: "数据分析 Agent", tagline: "NL→SQL 真实取数 + 分析归因" },
  { key: "style", icon: "✨", color: "style", name: "样式优化 Agent", tagline: "把结论排版成可直接交付的报告" },
];

let rec = [], all = [], cur = {}, agents = FALLBACK_AGENTS, providers = [];

async function init() {
  try {
    const h = await (await fetch("api/health")).json();
    const isMock = h.llm?.backend === "mock";
    providers = Array.isArray(h.providers) ? h.providers : [];
    const connected = providers.filter((provider) => provider.configured && provider.id !== "mock");
    const m = $("#healthLLM");
    m.textContent = isMock ? "LLM Mock" : h.hasKey ? `${connected.length || 1} 个 LLM 已连接` : "LLM 未配置";
    m.className = "chip " + (h.hasKey ? "ok" : "bad");
    renderProviderStatus();
  } catch {}
  try {
    const d = await (await fetch("api/agents")).json();
    if (Array.isArray(d.agents) && d.agents.length) agents = d.agents;
  } catch {}
  try {
    const d = await (await fetch("api/models")).json();
    rec = d.recommended || [];
    all = d.all || [];
    if (Array.isArray(d.providers)) providers = d.providers;
    renderProviderStatus();
  } catch {}
  try { cur = await (await fetch("api/agent-config")).json(); } catch { cur = {}; }
  render();
  $("#saveBtn").onclick = save;
}

function render() {
  const box = $("#cfgList");
  box.innerHTML = agents.map((a) => `
    <div class="cfg-card">
      <div class="cfg-agent">
        <div class="avatar av-${esc(a.color || a.key)}">${esc(a.icon)}</div>
        <div class="cfg-agent-meta">
          <div class="cfg-name">${esc(a.name)}</div>
          <div class="cfg-tag">${esc(a.tagline)}</div>
        </div>
      </div>
      <label class="cfg-field"><span class="cfg-flabel">模型</span><select id="sel-${a.key}"></select></label>
    </div>`).join("");
  agents.forEach((a) => fillSelect($("#sel-" + a.key), cur[a.key]));
}

function renderProviderStatus() {
  const box = $("#providerStatus");
  if (!box) return;
  const visible = providers.filter((provider) => provider.id !== "openai-compatible" || provider.configured);
  box.innerHTML = visible.map((provider) => `
    <span class="provider-pill ${provider.configured ? "connected" : "offline"}">
      <span class="provider-dot"></span>${esc(provider.label || provider.id)}
      <small>${provider.configured ? "已配置" : "未配置"}</small>
    </span>`).join("");
}

function providerId(model) {
  const prefix = String(model || "").split("/")[0];
  return ["minimax", "volcengine", "mock"].includes(prefix) ? prefix : "other";
}

function providerLabel(id) {
  return providers.find((provider) => provider.id === id)?.label
    || ({ minimax: "MiniMax", volcengine: "火山引擎", mock: "LLM Mock", other: "其他模型" }[id] || id);
}

function displayModel(model) {
  const id = providerId(model);
  return id === "other" || id === "mock" ? model : String(model).slice(String(model).indexOf("/") + 1);
}

function fillSelect(sel, val) {
  if (!sel) return;
  sel.innerHTML = "";
  const opt = (model) => {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = `${rec.includes(model) ? "★ " : ""}${displayModel(model)}`;
    return option;
  };
  const choices = [...new Set([...rec, ...all])];
  const groups = new Map();
  for (const model of choices) {
    const id = providerId(model);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(model);
  }
  for (const id of ["minimax", "volcengine", "other", "mock"]) {
    const models = groups.get(id) || [];
    if (!models.length) continue;
    const group = document.createElement("optgroup");
    group.label = `${providerLabel(id)} (${models.length})`;
    models.forEach((model) => group.appendChild(opt(model)));
    sel.appendChild(group);
  }
  if (val && !choices.includes(val)) {
    const group = document.createElement("optgroup");
    group.label = "当前配置";
    group.appendChild(opt(val));
    sel.prepend(group);
  }
  if (val) sel.value = val;
  if (!sel.value && choices.length) sel.value = choices[0];
}

async function save() {
  const body = Object.fromEntries(agents.map((a) => [a.key, $("#sel-" + a.key)?.value || cur[a.key] || ""]).filter(([, model]) => model));
  const msg = $("#saveMsg");
  $("#saveBtn").disabled = true; msg.className = "save-msg"; msg.textContent = "保存中…";
  try {
    const r = await (await fetch("api/agent-config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
    if (r.ok) { cur = r.config || body; msg.className = "save-msg ok"; msg.textContent = "✓ 已保存，新任务将使用此配置"; }
    else { msg.className = "save-msg err"; msg.textContent = "保存失败"; }
  } catch { msg.className = "save-msg err"; msg.textContent = "保存失败（网络错误）"; }
  $("#saveBtn").disabled = false;
  setTimeout(() => { if (msg.textContent.startsWith("✓")) { msg.textContent = ""; msg.className = "save-msg"; } }, 4000);
}

init();
