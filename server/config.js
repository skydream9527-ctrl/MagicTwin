// 集中配置。所有参数均可用环境变量覆盖（见 .env.example）。
// 模型名格式取决于你的 LLM 网关：OpenAI 原生用 "gpt-4o"，支持 {owner}/{id} 的网关用 "openai/gpt-4o"。
import "./env.js";
import { ROSTER } from "./domain/roster.js";

// 从 roster 派生「每个 Agent 的默认模型」：
//   - 优先读环境变量 <KEY_UPPER>_MODEL（如 TWIN_MODEL / DATA_MODEL / CODE_RUNNER_MODEL）
//   - 否则用 roster.entry.defaultModel（若声明）
//   - 否则回退 gpt-4o
// 新增 Agent 无需改本文件，加 env 变量或 roster.defaultModel 即可。
function buildDefaultModels() {
  const out = {};
  const mockMode = (process.env.LLM_BACKEND || "mock").toLowerCase() === "mock";
  const providerDefault = process.env.DEFAULT_MODEL
    || (process.env.MINIMAX_MODELS || "").split(",").map((model) => model.trim()).filter(Boolean).map((model) => `minimax/${model.replace(/^minimax\//, "")}`)[0]
    || (process.env.VOLCENGINE_MODELS || "").split(",").map((model) => model.trim()).filter(Boolean).map((model) => `volcengine/${model.replace(/^volcengine\//, "")}`)[0]
    || "gpt-4o";
  for (const a of ROSTER) {
    const envKey = `${a.key.toUpperCase().replace(/-/g, "_")}_MODEL`;
    out[a.key] = mockMode
      ? "mock/magictwin"
      : process.env[envKey] || providerDefault || a.defaultModel || "gpt-4o";
  }
  return out;
}

const DEFAULT_MODELS = buildDefaultModels();

export const CONFIG = {
  port: Number(process.env.PORT || 8787),
  // 本地优先：默认绑定 localhost，与浏览器访问地址保持一致。
  // 需要局域网访问时显式设 HOST=0.0.0.0。
  host: process.env.HOST || "localhost",

  // 每个 Agent 的默认模型（从 roster 派生 + env 覆盖）。
  // 兼容旧字段名 twinModel / dataModel / styleModel。
  models: DEFAULT_MODELS,
  get twinModel() { return DEFAULT_MODELS.twin; },
  get dataModel() { return DEFAULT_MODELS.data; },
  get styleModel() { return DEFAULT_MODELS.style; },

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
  parallel: {
    // Twin 一次最多并行调度的 Agent 数量，以及每个并行子任务可自行推进的工具回合数。
    maxAgents: Math.max(2, Number(process.env.MAX_PARALLEL_AGENTS || 6)),
    maxRounds: Math.max(1, Number(process.env.MAX_PARALLEL_ROUNDS || 5)),
  },
  // 单次 LLM 调用超时（毫秒）；默认 30 分钟。走 node:https 自控超时，可设任意大，不受内置 fetch ~300s 限制。
  // 需要调整就改这里或设环境变量 LLM_TIMEOUT_MS；超时/网络抖动仍会由编排层自动退避重试而非整体报错。
  llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS || 1800000),

  // 上下文自动压缩（auto-compact）。
  // 为每个 Agent 的对话上下文设 token 预算，超预算就「先归档旧查询结果、再 LLM 摘要中间段」，
  // 把长任务（多轮真实取数）的上下文稳定在模型窗口内。可用环境变量覆盖。
  compact: {
    enabled: process.env.COMPACT_ENABLED !== "0",
    triggerTokens: Number(process.env.COMPACT_TRIGGER_TOKENS || 48000),
    keepRecentTurns: Number(process.env.COMPACT_KEEP_RECENT || 6),
    keepRecentTools: Number(process.env.COMPACT_KEEP_TOOLS || 2),
    charsPerToken: Number(process.env.COMPACT_CHARS_PER_TOKEN || 2.5),
    model: process.env.COMPACT_MODEL || "",
  },

  // 每日进化：定时归纳当天对话与错误，更新各 Agent 的 memory/LEARNINGS.md（见 engine/evolve.js）
  evolve: {
    enabled: process.env.EVOLVE_ENABLED !== "0",             // 默认开；设为 "0" 关闭内置定时器
    hour: Math.min(23, Math.max(0, Number(process.env.EVOLVE_HOUR || 23))), // 每天几点跑（本地时）
    model: process.env.EVOLVE_MODEL || process.env.TWIN_MODEL || "gpt-4o", // 归纳所用模型
    maxLearnings: Number(process.env.EVOLVE_MAX_LEARNINGS || 15), // LEARNINGS.md 条数上限
  },

  // Twin 画像蒸馏引擎：从外部工作空间文件自动提取用户画像（见 engine/distill.js）
  distill: {
    enabled: process.env.DISTILL_ENABLED !== "0",
    workspacePath: process.env.DISTILL_WORKSPACE || "",
    model: process.env.DISTILL_MODEL || process.env.TWIN_MODEL || "gpt-4o",
  },
};

// 推荐模型（供前端下拉优先展示）。替换为你自己网关上可用的模型。
export const RECOMMENDED_MODELS = [
  "minimax/MiniMax-M3",
  "minimax/MiniMax-M2.7",
  "minimax/MiniMax-M2.7-highspeed",
  "volcengine/doubao-seed-2.1-turbo",
  "volcengine/doubao-seed-2.0-code",
  "volcengine/doubao-seed-2.0-pro",
  "volcengine/doubao-seed-2.0-lite",
  "volcengine/doubao-seed-code",
  "volcengine/glm-5.2",
  "volcengine/kimi-k2.7-code",
  "volcengine/minimax-m3",
  "volcengine/deepseek-v4-flash",
  "volcengine/deepseek-v4-pro",
  "volcengine/minimax-m2.7",
  "volcengine/kimi-k2.6",
  "volcengine/ark-code-latest",
  "gpt-4o",
  "gpt-4o-mini",
  "claude-sonnet-4-20250514",
  "deepseek-chat",
];

export const MODEL_NOTES = {
  "volcengine/doubao-seed-2.0-code": "即将下线",
  "volcengine/doubao-seed-2.0-pro": "即将下线",
  "volcengine/doubao-seed-code": "即将下线",
  "volcengine/ark-code-latest": "火山 Coding Plan 自动路由最新版",
};
