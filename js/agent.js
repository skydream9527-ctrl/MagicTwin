"use strict";
const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const fmtSize = (n) => { if (n == null) return ""; if (n < 1024) return n + " B"; if (n < 1048576) return (n / 1024).toFixed(1) + " KB"; return (n / 1048576).toFixed(1) + " MB"; };

const key = new URLSearchParams(location.search).get("key");

async function init() {
  if (!key) { $("#agentTagline").textContent = "缺少 key 参数"; return; }
  let d;
  try { d = await (await fetch(`api/agent/${encodeURIComponent(key)}`)).json(); }
  catch { $("#agentTagline").textContent = "加载失败"; return; }
  if (!d || d.error) { $("#agentTagline").textContent = d && d.error ? d.error : "未找到该 Agent"; return; }

  document.title = `${d.name} · Agent 详情`;
  renderHead(d);
  renderHero(d);
  renderFileList(d.files || []);
  const first = (d.files || []).find((f) => f.readable && f.exists) || (d.files || [])[0];
  if (first) selectFile(first);
}

function renderHead(d) {
  const logo = $("#agentLogo");
  logo.textContent = d.icon || "◆";
  logo.className = "logo av-" + (d.color || "twin");
  $("#agentName").textContent = d.name || "Agent";
  $("#agentTagline").textContent = d.tagline || "";
  const m = $("#agentModel");
  m.textContent = "🧠 " + (d.model || "-");
}

function renderHero(d) {
  const resp = (d.responsibilities || []).map((r) => `<li>${esc(r)}</li>`).join("");
  $("#agentHero").innerHTML = `
    <div class="hero-top">
      <div class="hero-avatar av-${esc(d.color || "twin")}">${esc(d.icon || "◆")}</div>
      <div class="hero-meta">
        <div class="hero-name">${esc(d.name || "")}</div>
        <div class="hero-tagline">${esc(d.tagline || "")}</div>
        <div class="hero-chips">
          <span class="hero-chip">🧠 ${esc(d.model || "-")}</span>
          <span class="hero-chip">${(d.files || []).length} 个相关文件</span>
        </div>
      </div>
    </div>
    <div class="hero-role">${esc(d.role || "")}</div>
    <div class="hero-cols">
      <div class="hero-card"><h4>职责</h4><ul>${resp || "<li class='muted'>—</li>"}</ul></div>
      <div class="hero-card boundary"><h4>边界</h4><p>${esc(d.boundary || "")}</p></div>
    </div>`;
}

function renderFileList(files) {
  const box = $("#fileList");
  box.innerHTML = "";
  if (!files.length) { box.appendChild(el("div", "empty", "该 Agent 暂无关联文件")); return; }
  const groups = [];
  files.forEach((f) => { let g = groups.find((x) => x.name === f.group); if (!g) { g = { name: f.group, items: [] }; groups.push(g); } g.items.push(f); });
  groups.forEach((g) => {
    box.appendChild(el("div", "fl-group", esc(g.name)));
    g.items.forEach((f) => {
      const it = el("div", "file-item" + (f.exists ? "" : " missing"));
      it.dataset.path = f.path;
      const ext = (f.ext || "?").toUpperCase();
      it.innerHTML = `<span class="fi-ext ${f.readable ? "" : "bin"}">${esc(ext)}</span>
        <span class="fi-main">
          <span class="fi-title">${esc(f.title)}</span>
          ${f.desc ? `<span class="fi-desc">${esc(f.desc)}</span>` : ""}
          <span class="fi-path">${esc(f.path)}${f.exists ? "" : " · 缺失"}</span>
        </span>`;
      it.onclick = () => selectFile(f);
      box.appendChild(it);
    });
  });
}

function selectFile(f) {
  document.querySelectorAll(".file-item").forEach((x) => x.classList.toggle("active", x.dataset.path === f.path));
  const view = $("#fileView");
  const head = `<div class="fv-head"><span class="fv-title">${esc(f.title)}</span><span class="fv-path">${esc(f.path)}${f.truncated ? " · 内容较大已截断" : ""}${f.size ? " · " + fmtSize(f.size) : ""}</span></div>`;

  if (!f.exists) { view.innerHTML = head + `<div class="fv-note">⚠ 文件不存在或已移动。</div>`; view.scrollTop = 0; return; }
  if (!f.readable) {
    view.innerHTML = head + `<div class="fv-note">📦 该文件为压缩 / 二进制资源（.${esc(f.ext)}），不支持在线预览。<div class="muted" style="margin-top:6px">大小：${fmtSize(f.size)}</div></div>`;
    view.scrollTop = 0; return;
  }
  const body = f.ext === "md"
    ? `<div class="md-body">${renderMarkdown(f.content || "")}</div>`
    : `<pre class="code-body"><code>${esc(f.content || "")}</code></pre>`;
  view.innerHTML = head + body;
  view.scrollTop = 0;
}

// ---------- 轻量 Markdown 渲染（先转义再套语法，无 XSS 风险）----------
function mdInline(t) {
  return esc(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
function renderMarkdown(src) {
  const lines = String(src).replace(/\r\n?/g, "\n").split("\n");
  let out = "", i = 0;
  const isBreak = (s) => /^(#{1,6}\s|```|\s*[-*+]\s|\s*\d+\.\s)/.test(s) || /^(-{3,}|\*{3,}|_{3,})\s*$/.test(s) || /\|/.test(s) || s.trim() === "";
  while (i < lines.length) {
    const line = lines[i];
    // 代码块
    if (/^```/.test(line)) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out += `<pre class="md-code"><code>${esc(buf.join("\n"))}</code></pre>`;
      continue;
    }
    // 标题
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { const lv = h[1].length; out += `<h${lv} class="md-h md-h${lv}">${mdInline(h[2])}</h${lv}>`; i++; continue; }
    // 水平线
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out += `<hr class="md-hr"/>`; i++; continue; }
    // 表格：本行含 | 且下一行是分隔行
    if (/\|/.test(line) && i + 1 < lines.length && /-/.test(lines[i + 1]) && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const parse = (r) => r.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
      const headers = parse(line); i += 2;
      const rows = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== "") { rows.push(parse(lines[i])); i++; }
      out += `<div class="md-tablewrap"><table class="md-table"><thead><tr>${headers.map((c) => `<th>${mdInline(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${mdInline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
      continue;
    }
    // 无序列表
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*+]\s+/, "")); i++; }
      out += `<ul class="md-ul">${items.map((it) => `<li>${mdInline(it)}</li>`).join("")}</ul>`;
      continue;
    }
    // 有序列表
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, "")); i++; }
      out += `<ol class="md-ol">${items.map((it) => `<li>${mdInline(it)}</li>`).join("")}</ol>`;
      continue;
    }
    // 空行
    if (line.trim() === "") { i++; continue; }
    // 段落
    const buf = [line]; i++;
    while (i < lines.length && !isBreak(lines[i])) { buf.push(lines[i]); i++; }
    out += `<p class="md-p">${buf.map(mdInline).join("<br/>")}</p>`;
  }
  return out;
}

init();
