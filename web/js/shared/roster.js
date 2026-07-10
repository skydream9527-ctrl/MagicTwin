// 前端 Agent 花名册（首页卡片 / 配置页共用）。
// 后端 server/domain/roster.js 是权威真相源，/api/agents 亦由其派生；此处仅为零构建前端
// 提供一份轻量镜像（key/icon/name/tagline），避免首页/配置页各自硬编码同一份清单。
"use strict";
const AGENT_ROSTER = [
  { key: "twin", icon: "◆", name: "Twin · 数字分身", tagline: "唯一编排者：代表你派活 / 代答 / 验收 / 交付" },
  { key: "data", icon: "📊", name: "数据分析 Agent", tagline: "NL→SQL 真实取数 + 分析归因" },
  { key: "style", icon: "✨", name: "样式优化 Agent", tagline: "把结论排版成可直接交付的报告" },
];
