// 共享 DOM 辅助：所有页面通用。
// 本项目零构建，用普通 <script>（classic script）加载，多个脚本共享同一全局词法作用域，
// 因此这些名字在各页面脚本里【不要重复声明】，否则会 "Identifier already declared" 报错。
"use strict";
const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
