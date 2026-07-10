// 三个 Agent 的单一真相源：结构化注册表。
// 对齐「统一 Agent」抽象：Twin 是用户私有的特权 Agent（kind=twin，落在用户空间），
// 数据 / 样式是团队共享的工具 Agent（kind=tool，落在 Agent 空间）。
// 各 Agent 的操作手册（agent.md）、取数知识、用户画像、进化记忆（memory/）另以文件为真相源存于其 space 目录。
//
// 后端（domain/agents.js 组装详情、config 默认模型键、store 镜像历史、evolve 每日进化）与前端
//（/api/agents 派生首页/配置卡片）都从这里派生，避免「三个 Agent」在多处硬编码。
// 新增 Agent 只需在此登记 + 建其 space 目录。
//
// key 为对外稳定标识（twin/data/style），与 agent-config.json、/api/agent/:key、前端一致；
// space 为该 Agent 在 workspace 下的目录（可与 key 不同名）。

export const ROSTER = [
  {
    key: "twin",
    kind: "twin",
    name: "Twin · 数字分身",
    icon: "◆",
    color: "twin",
    tagline: "用户的代理人 / 唯一编排者",
    space: "workspace/users/u_local/twin",
    role: "你的数字分身：理解你的意图，替你把活派给数据分析 Agent 与样式优化 Agent，替你回答确认项、验收产出、必要时打回，最后把结论交付给你。",
    responsibilities: [
      "把（可能模糊的）目标翻译成清晰的分析任务，派给数据分析 Agent",
      "代表用户回答数据 Agent 抛出的确认项（口径 / 时间窗 / 是否下钻）",
      "站在用户视角挑剔地验收报告，有硬伤就打回重做",
      "把通过验收的结论转交样式 Agent 排版，再交付给用户",
      "沉淀「我替你做的决定」清单，只有真正高风险才升级问用户",
    ],
    boundary: "只提议不越权；不写 SQL、不查数、不亲自排版；高风险决策回来问用户。",
    files: [
      { path: "workspace/users/u_local/twin/agent.md", title: "Twin 操作手册（agent.md）", group: "人设 Prompt", desc: "编排 / @ 提及路由 / 代答 / 交付的输出协议（{{PROFILE}} 处注入用户画像）" },
      { path: "workspace/users/u_local/twin/profile.md", title: "用户画像 · 协作工作区完整指南", group: "用户画像知识", desc: "用户画像，Twin 据此代表用户做低风险决策（gitignored，从 profile.example.md 复制）" },
    ],
  },

  {
    key: "data",
    kind: "tool",
    name: "数据分析 Agent",
    icon: "📊",
    color: "data",
    tagline: "干活的数据分析专家（只读查询）",
    space: "workspace/agents/data-analysis",
    role: "资深数据分析师。把自然语言需求转成可执行 SQL，经数据查询适配器查真实数据并做分析归因。",
    responsibilities: [
      "判断业务线、澄清命题、确认口径（向 Twin 提确认项）",
      "NL→SQL：用对应业务线的真实表 / 列 / 口径写只读 SQL",
      "经数据网关真实取数，算趋势 / 环比给出数据速览",
      "环比异动（|Δ| > 8%）追加维度下钻归因",
      "产出一句话结论 + 2~4 条发现，交回 Twin 验收",
    ],
    boundary: "面对的甲方是 Twin 而非用户本人；不替用户拍板；查询白名单只读 SELECT。",
    files: [
      { path: "workspace/agents/data-analysis/agent.md", title: "数据分析 Agent 操作手册（agent.md）", group: "人设 Prompt", desc: "5 阶段 SOP + 业务线路由表 + 输出协议（{{KNOWLEDGE_*}} 处注入各线取数知识）" },
      { path: "workspace/agents/data-analysis/knowledge/content-center.md", title: "业务线A 取数知识", group: "取数知识库（示例模板）", desc: "表 / 列 / 口径模板 · 运行时注入 system prompt · 请替换为你自己的真实业务知识" },
      { path: "workspace/agents/data-analysis/knowledge/browser.md", title: "业务线B 取数知识", group: "取数知识库（示例模板）", desc: "表 / 列 / 口径模板 · 请替换为你自己的真实业务知识" },
      { path: "workspace/agents/data-analysis/knowledge/browser-feed.md", title: "业务线C 取数知识", group: "取数知识库（示例模板）", desc: "表 / 列 / 口径模板 · 请替换为你自己的真实业务知识" },
      { path: "workspace/agents/data-analysis/knowledge/search.md", title: "业务线D 取数知识", group: "取数知识库（示例模板）", desc: "表 / 列 / 口径模板 · 请替换为你自己的真实业务知识" },
      { path: "workspace/agents/data-analysis/knowledge/novel.md", title: "业务线E 取数知识", group: "取数知识库（示例模板）", desc: "表 / 列 / 口径模板 · 请替换为你自己的真实业务知识" },
      { path: "workspace/agents/data-analysis/memory/LEARNINGS.md", title: "进化经验（LEARNINGS）", group: "进化记忆", desc: "每日自动归纳的经验 / 易错点（如口径/SQL 常见坑），运行时注入 system prompt（尚未进化则暂缺）" },
    ],
  },

  {
    key: "style",
    kind: "tool",
    name: "样式优化 Agent",
    icon: "✨",
    color: "style",
    tagline: "报告编辑（不查数、不改数字）",
    space: "workspace/agents/style-optimizer",
    role: "把数据 Agent 的粗糙结论整理成可直接交付的漂亮报告：拟标题、提炼 TL;DR、分节组织、突出关键数字、去掉过程噪音。",
    responsibilities: [
      "拟一个直击结论的标题（不超过 20 字）",
      "提炼一句话 TL;DR（方向 + 幅度 + 主因）",
      "组织成 2~4 个小节，突出关键数字",
      "抽出 2~4 个关键数字高亮供卡片顶部展示",
      "忠实原结论，只优化表达与排版",
    ],
    boundary: "甲方只有 Twin；不查数据、不改动任何数字或结论、不做业务决策。",
    files: [
      { path: "workspace/agents/style-optimizer/agent.md", title: "样式优化 Agent 操作手册（agent.md）", group: "人设 Prompt", desc: "标题 / TL;DR / 分节 / 高亮的排版协议" },
      { path: "workspace/agents/style-optimizer/memory/LEARNINGS.md", title: "进化经验（LEARNINGS）", group: "进化记忆", desc: "每日自动归纳的排版经验 / 易错点，运行时注入 system prompt（尚未进化则暂缺）" },
    ],
  },
];

export const AGENT_KEYS = ROSTER.map((a) => a.key);

export function getRosterEntry(key) {
  return ROSTER.find((a) => a.key === key) || null;
}
