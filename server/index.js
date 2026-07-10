// HTTP 服务启动入口：装配路由 + 监听端口 + 打印启动信息 + 每日进化定时器。
// 分层：
//   http/         路由（router）· 静态前端（static）· SSE 运行时与插话队列（runtime）
//   engine/       编排引擎（orchestrator）· 每日进化（evolve）
//   integrations/ 外部系统客户端（llm 网关 · data-query 数据查询适配器）
//   domain/       领域逻辑（roster 花名册 · agents 详情 · store 任务空间存储）
//   prompts/      三个 Agent 的 system prompt 加载器（读 workspace 下的 agent.md）
import http from "node:http";
import { CONFIG } from "./config.js";
import { hasKey } from "./integrations/llm.js";
import { handleRequest } from "./http/router.js";
import { evolveAll } from "./engine/evolve.js";

const server = http.createServer(handleRequest);

server.listen(CONFIG.port, () => {
  console.log(`\n  MagicTwin 已启动`);
  console.log(`  → http://localhost:${CONFIG.port}`);
  console.log(`  LLM key: ${hasKey() ? "已就绪" : "未找到（请配置）"}`);
  console.log(`  默认模型 Twin=${CONFIG.twinModel}  数据Agent=${CONFIG.dataModel}  样式Agent=${CONFIG.styleModel}`);
  console.log(`  数据查询: ${CONFIG.dataQuery.backend === "sample" ? "演示模式（示例数据）" : "已接入真实数据源"}`);
  scheduleDailyEvolve();
  console.log("");
});

// 每日进化：到点归纳当天各 Agent 的对话与错误，更新其 memory/LEARNINGS.md。
// 默认开启（EVOLVE_ENABLED=0 关闭）；无 LLM key 时 evolve 内部会优雅跳过。
// 也可手动触发：`npm run evolve [YYYY-MM-DD]`（可挂到系统 cron）。
function scheduleDailyEvolve() {
  if (!CONFIG.evolve.enabled) { console.log("  每日进化：已关闭（EVOLVE_ENABLED=0）"); return; }
  const run = async () => {
    try {
      const { date, results } = await evolveAll();
      const updated = results.filter((r) => !r.skipped).map((r) => r.key);
      console.log(`  [evolve] ${date} 进化完成：${updated.length ? "更新 " + updated.join("/") : "无更新"}（跳过 ${results.length - updated.length}）`);
    } catch (e) { console.error(`  [evolve] 失败：${e.message}`); }
    setTimeout(run, 24 * 3600 * 1000); // 此后每 24h 一次
  };
  const now = new Date();
  const next = new Date(now);
  next.setHours(CONFIG.evolve.hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const delay = next - now;
  console.log(`  每日进化：已排程，每天 ${String(CONFIG.evolve.hour).padStart(2, "0")}:00 触发（约 ${Math.round(delay / 3600000)}h 后首次；或 npm run evolve 手动跑）`);
  setTimeout(run, delay);
}
