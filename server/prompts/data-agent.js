// 数据分析 Agent system prompt 加载器。
// 手册与取数知识都以文件为真相源，落在该 Agent 的空间
// workspace/agents/data-analysis/：
//   - agent.md          ：操作手册（5 阶段 SOP + 业务线路由表 + 输出协议），用 {{KNOWLEDGE_*}} 占位
//   - knowledge/*.md    ：业务线取数知识模板（表/列/口径）——运行时真相源，请替换为你的真实业务知识
//   - memory/LEARNINGS.md：每日进化沉淀的经验（若存在则注入，见 engine/evolve.js）
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const AGENT_DIR = join(ROOT, "workspace", "agents", "data-analysis");
const K = (f) => readFileSync(join(AGENT_DIR, "knowledge", f), "utf8");

// 读取该 Agent 每日进化沉淀的经验（不存在则空）。作为「附加手册」注入，核心 agent.md 保持稳定。
function readLearnings(spaceDir) {
  try { return readFileSync(join(spaceDir, "memory", "LEARNINGS.md"), "utf8").trim(); } catch { return ""; }
}

export function buildDataAgentSystem() {
  const manual = readFileSync(join(AGENT_DIR, "agent.md"), "utf8");
  const base = manual
    .split("{{KNOWLEDGE_CC}}").join(K("content-center.md"))
    .split("{{KNOWLEDGE_BM}}").join(K("browser.md"))
    .split("{{KNOWLEDGE_BF}}").join(K("browser-feed.md"))
    .split("{{KNOWLEDGE_SR}}").join(K("search.md"))
    .split("{{KNOWLEDGE_NV}}").join(K("novel.md"));
  const learn = readLearnings(AGENT_DIR);
  return learn ? `${base}\n\n# 从过往任务中沉淀的经验（每日自动进化，可被人工审阅覆盖）\n\n${learn}` : base;
}
