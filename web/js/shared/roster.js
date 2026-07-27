// 前端 Agent 花名册（首页卡片 / 配置页 / 工作区 @ 提及下拉 共用）。
// 后端 server/domain/roster.js 是权威真相源，/api/agents 亦由其派生；此处仅为零构建前端
// 提供一份轻量镜像（key/icon/name/tagline/kind），避免首页/配置页各自硬编码同一份清单。
// 新增 Agent 时：先在后端 roster.js 登记 + 建 space 目录，然后在此处补一行镜像即可。
"use strict";
const AGENT_ROSTER = [
  { key: "twin",          kind: "twin", icon: "◆", name: "Twin · 数字分身",   tagline: "用户的代理人 / 唯一编排者" },
  { key: "researcher",    kind: "tool", icon: "◉", name: "趋势研究 Agent",   tagline: "扫描热点、生态与关键参与者" },
  { key: "concept",       kind: "tool", icon: "◇", name: "概念拆解 Agent",   tagline: "定义概念、边界与核心机制" },
  { key: "critic",        kind: "tool", icon: "△", name: "批判审视 Agent",   tagline: "挑战假设、寻找反例与风险" },
  { key: "data",          kind: "tool", icon: "📊", name: "数据分析 Agent",   tagline: "NL→SQL 真实取数 + 分析归因" },
  { key: "style",         kind: "tool", icon: "✨", name: "样式优化 Agent",   tagline: "把结论排版成可直接交付的报告" },
  { key: "general",       kind: "tool", icon: "🤖", name: "通用 Agent",       tagline: "入口编排者（智能路由）" },
  { key: "code-runner",   kind: "tool", icon: "🐍", name: "代码执行 Agent",   tagline: "Python 沙箱（高级分析）" },
  { key: "report-writer", kind: "tool", icon: "📝", name: "报告撰写 Agent",   tagline: "报告生成（周报/总结）" },
  { key: "data-monitor",  kind: "tool", icon: "🔔", name: "数据监控 Agent",   tagline: "指标监控 + 异常告警" },
];

// 派生：所有 Agent 的 key 列表（用于 @ 插话下拉 / resetAgents / 状态灯等）
const AGENT_KEYS = AGENT_ROSTER.map((a) => a.key);
// 派生：key → { name, icon }（用于事件渲染时把 actor=xxx 翻译成可读名 + 头像）
const AGENT_META = Object.fromEntries(AGENT_ROSTER.map((a) => [a.key, { name: a.name, icon: a.icon }]));
