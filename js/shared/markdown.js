// 共享轻量 Markdown 渲染（先转义再套语法，无 XSS 风险）。
// 支持：标题 / 代码块 / 水平线 / 表格 / 有序·无序列表 / 段落 / 行内代码·加粗·链接。
// 依赖全局 esc（见 shared/dom.js，须在本文件之前加载）。
"use strict";

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
