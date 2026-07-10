// 集中配置。所有参数均可用环境变量覆盖（见 .env.example）。
// 模型名格式取决于你的 LLM 网关：OpenAI 原生用 "gpt-4o"，支持 {owner}/{id} 的网关用 "openai/gpt-4o"。
export const CONFIG = {
  port: Number(process.env.PORT || 8787),

  // 三个角色的默认模型。换成你自己的 OpenAI 兼容端点支持的模型即可。
  twinModel: process.env.TWIN_MODEL || "gpt-4o",
  dataModel: process.env.DATA_MODEL || "gpt-4o",
  styleModel: process.env.STYLE_MODEL || "gpt-4o",

  // reasoning 模型先产 reasoning_content（计入 max_tokens），需给足 token 以免正式回复被截断
  maxTokens: Number(process.env.MAX_TOKENS || 4000),

  // 数据查询适配器（可选；默认 sample 演示模式，编排始终可运行）
  // 接入真实数据源：设 QUERY_BACKEND=command + QUERY_COMMAND="your-cli {sql}"
  dataQuery: {
    backend: process.env.QUERY_BACKEND || "sample",
    rowLimit: Number(process.env.QUERY_ROW_LIMIT || 2000),
  },

  // 编排安全阀
  maxSteps: Number(process.env.MAX_STEPS || 28), // Twin+Data 总回合上限，防跑飞
  // 单次 LLM 调用超时（毫秒）；默认 30 分钟。走 node:https 自控超时，可设任意大，不受内置 fetch ~300s 限制。
  // 需要调整就改这里或设环境变量 LLM_TIMEOUT_MS；超时/网络抖动仍会由编排层自动退避重试而非整体报错。
  llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS || 1800000),

  // 每日进化：定时归纳当天对话与错误，更新各 Agent 的 memory/LEARNINGS.md（见 engine/evolve.js）
  evolve: {
    enabled: process.env.EVOLVE_ENABLED !== "0",             // 默认开；设为 "0" 关闭内置定时器
    hour: Math.min(23, Math.max(0, Number(process.env.EVOLVE_HOUR || 23))), // 每天几点跑（本地时）
    model: process.env.EVOLVE_MODEL || process.env.TWIN_MODEL || "gpt-4o", // 归纳所用模型
    maxLearnings: Number(process.env.EVOLVE_MAX_LEARNINGS || 15), // LEARNINGS.md 条数上限
  },
};

// 推荐模型（供前端下拉优先展示）。替换为你自己网关上可用的模型。
export const RECOMMENDED_MODELS = [
  "gpt-4o",
  "gpt-4o-mini",
  "claude-sonnet-4-20250514",
  "deepseek-chat",
];
