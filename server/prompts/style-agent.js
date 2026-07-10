// 样式优化 Agent system prompt 加载器。
// 手册以文件为真相源，落在该 Agent 的空间 workspace/agents/style-optimizer/：
//   - agent.md          ：标题 / TL;DR / 分节 / 高亮的排版协议
//   - memory/LEARNINGS.md：每日进化沉淀的经验（若存在则注入，见 engine/evolve.js）
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const STYLE_DIR = join(ROOT, "workspace", "agents", "style-optimizer");

// 读取该 Agent 每日进化沉淀的经验（不存在则空）。作为「附加手册」注入，核心 agent.md 保持稳定。
function readLearnings(spaceDir) {
  try { return readFileSync(join(spaceDir, "memory", "LEARNINGS.md"), "utf8").trim(); } catch { return ""; }
}

export function buildStyleAgentSystem() {
  const base = readFileSync(join(STYLE_DIR, "agent.md"), "utf8");
  const learn = readLearnings(STYLE_DIR);
  return learn ? `${base}\n\n# 从过往任务中沉淀的经验（每日自动进化，可被人工审阅覆盖）\n\n${learn}` : base;
}
