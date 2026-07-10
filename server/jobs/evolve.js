// CLI：手动 / cron 触发每日进化。
// 用法：
//   node server/jobs/evolve.js            # 归纳「今天」
//   node server/jobs/evolve.js 2026-07-08 # 归纳指定日期
//   npm run evolve -- 2026-07-08
// 可挂到系统 cron（如每天 23:30）：30 23 * * * cd /path/to/repo && npm run evolve
import { evolveAll, todayStr } from "../engine/evolve.js";
import { hasKey } from "../integrations/llm.js";

const date = process.argv[2] || todayStr();

if (!hasKey()) {
  console.error("未找到 LLM key，无法进化。请配置 LLM_API_KEY（或见 README 的 key 解析顺序）。");
  process.exit(1);
}

console.log(`每日进化：归纳 ${date} 各 Agent 的对话与错误…\n`);
const { results } = await evolveAll(date);
for (const r of results) {
  if (r.skipped) console.log(`  - ${r.key}：跳过（${r.reason}）`);
  else console.log(`  - ${r.key}：已更新 LEARNINGS.md（任务 ${r.taskIds.length} 个 · 发言 ${r.counts.utterances} · 思考 ${r.counts.thinking} · 错误 ${r.counts.errors}）`);
}
console.log("\n完成。各 Agent 的 memory/LEARNINGS.md 已更新，下次运行时会自动注入其 system prompt。");
