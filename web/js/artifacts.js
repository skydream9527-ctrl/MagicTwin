"use strict";
const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const fmtDate = (v) => { const s = String(v); return /^\d{8}$/.test(s) ? `${s.slice(4, 6)}-${s.slice(6, 8)}` : s; };
const shortTs = (ts) => { try { return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false }); } catch { return ""; } };

const tid = new URLSearchParams(location.search).get("tid");

async function init() {
  document.querySelectorAll(".tab").forEach((t) => t.onclick = () => switchTab(t.dataset.t));
  if (!tid) { $("#goal").textContent = "缺少 tid 参数"; return; }
  let d;
  try { d = await (await fetch(`api/task/${tid}`)).json(); } catch { $("#goal").textContent = "加载失败"; return; }
  if (d.error) { $("#goal").textContent = d.error; return; }
  const meta = d.meta || {};
  $("#sub").textContent = `${tid} · Twin=${meta.models?.twin || "-"} · 数据Agent=${meta.models?.data || "-"} · 样式Agent=${meta.models?.style || "-"}`;
  $("#goal").innerHTML = `<b>目标：</b>${esc(meta.goal || "")}`;
  if (meta.status) { const b = $("#taskStatus"); b.className = "badge " + meta.status; b.textContent = meta.status; b.classList.remove("hidden"); }
  renderArtifacts(d.events || [], d.decisions || []);
  renderLog(d.events || []);
  renderThinking(d.thinking || []);
}

function switchTab(t) {
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x.dataset.t === t));
  document.querySelectorAll(".tabpane").forEach((p) => p.classList.remove("active"));
  $("#pane-" + t).classList.add("active");
}

// ---------- 过程产物 ----------
function renderArtifacts(events, decisions) {
  const pane = $("#pane-art"); pane.innerHTML = "";
  if (decisions.length) {
    const card = el("div", "art-card open");
    const items = decisions.map((x) => `<div class="dec" style="font-size:12.5px;margin:3px 0"><span class="muted">${esc(x.question || "")}</span> → <b style="color:var(--twin)">${esc(x.answer || "")}</b>${x.reason ? ` <span class="muted">（${esc(x.reason)}）</span>` : ""}</div>`).join("");
    card.innerHTML = `<div class="ah">🧭 Twin 替用户做的决定 <span class="m">${decisions.length} 条</span></div><div class="ab" style="display:block"><div class="col" style="min-width:100%">${items}</div></div>`;
    pane.appendChild(card);
  }
  const sqlByName = {};
  events.forEach((e) => { if (e.kind === "tool_call") sqlByName[e.name] = e.sql; });
  const results = events.filter((e) => e.kind === "tool_result" && e.ok && e.records && e.records.length);
  if (!results.length) { pane.appendChild(el("div", "empty", "还没有数据产物。")); return; }
  results.forEach((r) => {
    const card = el("div", "art-card open");
    const head = el("div", "ah", `📊 ${esc(r.name)} <span class="m">${r.rowCount} 行 · ${r.ms}ms · 真实数据</span>`);
    head.onclick = () => card.classList.toggle("open");
    const body = el("div", "ab");
    const chart = buildChart(r.columns, r.colTypes || [], r.records);
    if (chart) { const c = el("div", "col"); c.appendChild(chart); body.appendChild(c); }
    const tcol = el("div", "col"); tcol.appendChild(buildTable(r.columns, r.records)); body.appendChild(tcol);
    if (sqlByName[r.name]) { const sc = el("div", "col", `<div class="muted" style="font-size:11px;margin-bottom:4px">SQL 原文</div>`); sc.appendChild(el("div", "sqlbox", esc(sqlByName[r.name]))); sc.firstChild && body.appendChild(sc); }
    card.appendChild(head); card.appendChild(body); pane.appendChild(card);
  });
}

function buildTable(columns, records) {
  const wrap = el("div", "tbl-wrap"); const t = el("table", "tbl");
  const head = "<tr>" + columns.map((c) => `<th>${esc(c)}</th>`).join("") + "</tr>";
  const rows = records.slice(0, 200).map((r) => "<tr>" + columns.map((c) => `<td>${esc(fmtCell(r[c]))}</td>`).join("") + "</tr>").join("");
  t.innerHTML = head + rows; wrap.appendChild(t); return wrap;
}
function fmtCell(v) { if (typeof v === "number") return v.toLocaleString(); if (typeof v === "string" && /^\d+\.\d+$/.test(v)) return Number(v).toLocaleString(); return v; }

// ---------- 完整日志 ----------
function renderLog(events) {
  const pane = $("#pane-log"); pane.innerHTML = "";
  if (!events.length) { pane.appendChild(el("div", "empty", "无日志")); return; }
  events.forEach((e) => {
    const entry = el("div", "log-entry");
    let detail = e.text ? `<div>${esc(e.text)}</div>` : "";
    if (e.kind === "tool_call") detail += `<div class="sqlbox" style="margin-top:6px">${esc(e.sql || "")}</div>`;
    if (e.kind === "tool_result") detail += `<div class="muted" style="margin-top:4px">${e.ok ? `✅ ${e.rowCount} 行 · ${e.ms}ms` : `⚠ 失败：${esc(e.error || "")}`}</div>`;
    if (e.kind === "ask" && e.questions) detail += e.questions.map((q) => `<div class="muted" style="margin-top:3px">❓ ${esc(q.text)}（推荐：${esc(q.recommendation ?? "-")}）</div>`).join("");
    if (e.kind === "answer" && e.answers) detail += e.answers.map((a) => `<div style="margin-top:3px;color:var(--twin)">✓ ${esc(a.answer)} <span class="muted">— ${esc(a.reason || "")}</span></div>`).join("");
    if (e.kind === "deliver") {
      if (e.decisions) detail += e.decisions.map((x) => `<div class="muted" style="margin-top:3px">🧭 ${esc(x.question || "")} → ${esc(x.answer || "")}</div>`).join("");
      if (e.next_steps) detail += e.next_steps.map((s) => `<div class="muted" style="margin-top:3px">→ ${esc(s)}</div>`).join("");
    }
    entry.innerHTML = `<div class="lh"><span class="tag ${e.actor}">${actorName(e.actor)}</span><span>${esc(e.kind)}</span><span>${shortTs(e.ts)}</span><span>#${e.seq}</span></div>${detail}`;
    pane.appendChild(entry);
  });
}
function actorName(a) { return { user: "你", twin: "Twin", data: "数据Agent", style: "样式Agent", system: "系统" }[a] || a; }

// ---------- Agent 思考过程 ----------
function renderThinking(thinking) {
  const pane = $("#pane-think"); pane.innerHTML = "";
  if (!thinking.length) { pane.appendChild(el("div", "empty", "没有捕获到思考记录（该模型可能未返回 reasoning）。")); return; }
  thinking.forEach((t, i) => {
    const entry = el("div", "think-entry" + (i === 0 ? " open" : ""));
    const th = el("div", "th", `<span class="tag ${t.actor}">${actorName(t.actor)}</span><span>${esc(t.model || "")}</span><span class="m">${t.ms || 0}ms · ${t.attempts || 1} 次尝试 · ${shortTs(t.ts)}</span>`);
    th.onclick = () => entry.classList.toggle("open");
    const tb = el("div", "tb");
    tb.innerHTML =
      (t.reasoning ? `<div class="muted" style="font-size:11px;margin-bottom:3px">🧠 思考（reasoning）</div><div class="reason">${esc(t.reasoning)}</div>` : `<div class="muted" style="margin-bottom:6px">（该次调用无 reasoning 内容）</div>`) +
      `<div class="muted" style="font-size:11px;margin-bottom:3px">📤 原始输出</div><div class="raw">${esc(t.raw || "")}</div>`;
    entry.appendChild(th); entry.appendChild(tb); pane.appendChild(entry);
  });
}

// ---------- 图表（折线）----------
function buildChart(cols, types, records) {
  const dateIdx = cols.findIndex((c) => /date|dt|day/i.test(c));
  if (dateIdx < 0) return null;
  const isNum = (i) => /int|bigint|decimal|double|float|numeric/i.test(types[i] || "") || records.every((r) => r[cols[i]] == null || !isNaN(Number(r[cols[i]])));
  const numIdxs = cols.map((_, i) => i).filter((i) => i !== dateIdx && isNum(i));
  const dimIdx = cols.findIndex((c, i) => i !== dateIdx && !numIdxs.includes(i));
  if (!numIdxs.length) return null;
  const dateCol = cols[dateIdx];
  const dates = [...new Set(records.map((r) => r[dateCol]))].sort();
  if (dates.length < 2) return null;
  const yCol = cols[numIdxs[0]];
  let series = [];
  if (dimIdx >= 0) {
    const dimCol = cols[dimIdx];
    const groups = [...new Set(records.map((r) => r[dimCol]))].slice(0, 6);
    series = groups.map((g) => ({ name: String(g), data: dates.map((dt) => { const rec = records.find((r) => r[dateCol] === dt && r[dimCol] === g); return rec ? Number(rec[yCol]) : null; }) }));
  } else {
    series = numIdxs.slice(0, 4).map((i) => ({ name: cols[i], data: dates.map((dt) => { const rec = records.find((r) => r[dateCol] === dt); return rec ? Number(rec[cols[i]]) : null; }) }));
  }
  return drawLine(dates.map(fmtDate), series);
}
function drawLine(labels, series) {
  const W = 520, H = 260, pad = { l: 60, r: 14, t: 28, b: 28 };
  const dpr = window.devicePixelRatio || 1;
  const cv = el("canvas"); cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px";
  const g = cv.getContext("2d"); g.scale(dpr, dpr);
  const colors = ["#1e8e3e", "#0b57d0", "#e37400", "#6d3fd4", "#d93025", "#00838f"];
  let vals = []; series.forEach((s) => s.data.forEach((v) => { if (v != null && !isNaN(v)) vals.push(v); }));
  if (!vals.length) return cv;
  let min = Math.min(...vals), max = Math.max(...vals); if (min === max) { min -= 1; max += 1; }
  const px = (i) => pad.l + (labels.length === 1 ? 0 : i * (W - pad.l - pad.r) / (labels.length - 1));
  const py = (v) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
  g.strokeStyle = "#c4ccd6"; g.lineWidth = 1; g.beginPath(); g.moveTo(pad.l, pad.t); g.lineTo(pad.l, H - pad.b); g.lineTo(W - pad.r, H - pad.b); g.stroke();
  g.fillStyle = "#5f6368"; g.font = "10px sans-serif";
  for (let k = 0; k <= 3; k++) { const v = min + (max - min) * k / 3; const y = py(v); g.fillText(fmtNum(v), 4, y + 3); g.strokeStyle = "#e9edf3"; g.beginPath(); g.moveTo(pad.l, y); g.lineTo(W - pad.r, y); g.stroke(); }
  labels.forEach((lb, i) => { if (labels.length <= 10 || i % Math.ceil(labels.length / 10) === 0) { g.fillStyle = "#5f6368"; g.fillText(lb, px(i) - 12, H - pad.b + 15); } });
  series.forEach((s, si) => {
    g.strokeStyle = colors[si % colors.length]; g.lineWidth = 2; g.beginPath(); let started = false;
    s.data.forEach((v, i) => { if (v == null || isNaN(v)) return; const X = px(i), Y = py(v); if (!started) { g.moveTo(X, Y); started = true; } else g.lineTo(X, Y); });
    g.stroke();
    g.fillStyle = colors[si % colors.length]; s.data.forEach((v, i) => { if (v == null || isNaN(v)) return; g.beginPath(); g.arc(px(i), py(v), 2.5, 0, 7); g.fill(); });
  });
  let lx = pad.l;
  series.forEach((s, si) => { g.fillStyle = colors[si % colors.length]; g.fillRect(lx, 10, 9, 9); g.fillStyle = "#5f6368"; g.font = "10px sans-serif"; g.fillText(s.name, lx + 12, 18); lx += 14 + g.measureText(s.name).width + 14; });
  return cv;
}
function fmtNum(v) { const a = Math.abs(v); if (a >= 1e8) return (v / 1e8).toFixed(1) + "亿"; if (a >= 1e4) return (v / 1e4).toFixed(1) + "万"; if (a >= 1e3) return (v / 1e3).toFixed(1) + "k"; return (Math.round(v * 10) / 10).toString(); }

init();
