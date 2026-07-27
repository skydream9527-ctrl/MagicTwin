"use strict";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const FALLBACK_AGENTS = [
  { key: "twin", icon: "◆", color: "twin", name: "Twin · 数字分身", tagline: "唯一编排者：代表你派活 / 代答 / 验收 / 交付" },
  { key: "data", icon: "📊", color: "data", name: "数据分析 Agent", tagline: "NL→SQL 真实取数 + 分析归因" },
  { key: "style", icon: "✨", color: "style", name: "样式优化 Agent", tagline: "把结论排版成可直接交付的报告" },
];

let rec = [], all = [], cur = {}, agents = FALLBACK_AGENTS;

async function init() {
  try {
    const h = await (await fetch("/api/health")).json();
    const isMock = h.llm?.backend === "mock";
    const m = $("#healthLLM"); m.textContent = isMock ? "LLM Mock" : h.hasKey ? "LLM 已连接" : "LLM 未配置"; m.className = "chip " + (h.hasKey ? "ok" : "bad");
  } catch {}
  try {
    const d = await (await fetch("/api/agents")).json();
    if (Array.isArray(d.agents) && d.agents.length) agents = d.agents;
  } catch {}
  try { const d = await (await fetch("/api/models")).json(); rec = d.recommended || []; all = d.all || []; } catch {}
  try { cur = await (await fetch("/api/agent-config")).json(); } catch { cur = {}; }
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

function fillSelect(sel, val) {
  if (!sel) return;
  sel.innerHTML = "";
  const opt = (m) => { const o = document.createElement("option"); o.value = m; o.textContent = m; return o; };
  if (rec.length) { const g = document.createElement("optgroup"); g.label = "推荐"; rec.forEach((m) => g.appendChild(opt(m))); sel.appendChild(g); }
  const rest = all.filter((m) => !rec.includes(m));
  if (rest.length) { const g = document.createElement("optgroup"); g.label = `全部 (${all.length})`; rest.forEach((m) => g.appendChild(opt(m))); sel.appendChild(g); }
  if (!rec.length && !all.length && val) sel.appendChild(opt(val)); // 拿不到模型列表时至少保留当前值
  if (val) sel.value = val;
  if (!sel.value && rec.length) sel.value = rec[0];
}

async function save() {
  const body = Object.fromEntries(agents.map((a) => [a.key, $("#sel-" + a.key)?.value || cur[a.key] || ""]).filter(([, model]) => model));
  const msg = $("#saveMsg");
  $("#saveBtn").disabled = true; msg.className = "save-msg"; msg.textContent = "保存中…";
  try {
    const r = await (await fetch("/api/agent-config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
    if (r.ok) { cur = r.config || body; msg.className = "save-msg ok"; msg.textContent = "✓ 已保存，新任务将使用此配置"; }
    else { msg.className = "save-msg err"; msg.textContent = "保存失败"; }
  } catch { msg.className = "save-msg err"; msg.textContent = "保存失败（网络错误）"; }
  $("#saveBtn").disabled = false;
  setTimeout(() => { if (msg.textContent.startsWith("✓")) { msg.textContent = ""; msg.className = "save-msg"; } }, 4000);
}

init();
