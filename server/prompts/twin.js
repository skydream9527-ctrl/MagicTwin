// Twin（数字分身）system prompt 加载器。
// Twin 是用户私有的特权 Agent，其手册与画像都以文件为真相源，
// 落在 Twin 的用户空间 workspace/users/u_local/twin/：
//   - agent.md           ：操作手册（编排 / @ 提及路由 / 代答 / 交付协议），用 {{PROFILE}} 占位
//   - profile.md         ：用户画像（gitignore，绝不提交）；缺失时回退到 profile.example.md
//   - profile.example.md ：脱敏示例画像，开箱即用，新用户 cp 一份再自行编辑
//   - memory/LEARNINGS.md：每日进化沉淀的经验（若存在则注入，见 engine/evolve.js）
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TWIN_DIR = join(ROOT, "workspace", "users", "u_local", "twin");

// profile.md 不存在时回退到 profile.example.md，保证克隆即可运行。
// 若两者都不存在，给出明确占位，避免启动崩溃（降级不阻塞，对齐设计哲学 #9）。
function loadProfile() {
  const real = join(TWIN_DIR, "profile.md");
  if (existsSync(real)) return readFileSync(real, "utf8");
  const example = join(TWIN_DIR, "profile.example.md");
  if (existsSync(example)) {
    // 仅提示一次，避免日志噪声
    if (!loadProfile._warned) {
      console.warn(`[twin] 未找到 profile.md，已回退到 profile.example.md（示例画像）。\n      请 cp profile.example.md profile.md 并替换为你的真实画像。`);
      loadProfile._warned = true;
    }
    return readFileSync(example, "utf8");
  }
  return "（用户画像缺失：请创建 workspace/users/u_local/twin/profile.md）";
}

// 读取该 Agent 每日进化沉淀的经验（不存在则空）。作为「附加手册」注入，核心 agent.md 保持稳定。
function readLearnings(spaceDir) {
  try { return readFileSync(join(spaceDir, "memory", "LEARNINGS.md"), "utf8").trim(); } catch { return ""; }
}

export function buildTwinSystem() {
  const manual = readFileSync(join(TWIN_DIR, "agent.md"), "utf8");
  const profile = loadProfile();
  const base = manual.split("{{PROFILE}}").join(profile);
  const learn = readLearnings(TWIN_DIR);
  return learn ? `${base}\n\n# 从过往任务中沉淀的经验（每日自动进化，可被人工审阅覆盖）\n\n${learn}` : base;
}
