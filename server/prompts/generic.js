// 通用工具 Agent system prompt 加载器。
//
// 取代之前 twin/data/style 三个专用加载器的「工具 Agent」部分（twin 仍是特例，由 twin.js 加载）。
// 任何在 roster 中登记的 kind=tool Agent，都可以通过 buildToolSystem(key) 拼出其 system prompt：
//
//   agent.md 手册  →  知识占位符替换  →  追加统一协议  →  追加每日进化经验
//
// 知识占位符约定（任选其一，两者可混用）：
//   - 字母序：{{KNOWLEDGE_A}} {{KNOWLEDGE_B}} ... 按 knowledge/*.md 文件名字母序映射
//   - 文件名序：{{KNOWLEDGE_CONTENT_CENTER}} 对应 content-center.md（uppercase + - → _）
//   - 未被任何占位符引用的 knowledge 文件不会被自动追加（agent.md 应主动 {{KNOWLEDGE_X}} 引用）
//   - 未匹配任何文件的占位符被清空为 ""（避免 LLM 看到字面量）
//
// 与各 Agent 的 agent.md 解耦：agent.md 只描述「我是谁、做什么、输出协议」，
// 知识库 / 协议 / 进化经验都由本加载器在运行时拼接。
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getRosterEntry } from "../domain/roster.js";
import { buildProtocolWithCapabilities } from "./protocol.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// 读取该 Agent 每日进化沉淀的经验（不存在则空）。作为「附加手册」注入，核心 agent.md 保持稳定。
function readLearnings(spaceDir) {
  try { return readFileSync(join(spaceDir, "memory", "LEARNINGS.md"), "utf8").trim(); } catch { return ""; }
}

// 收集 knowledge/*.md 文件并构造两套占位符映射
function buildKnowledgeMap(agentDir) {
  const kdir = join(agentDir, "knowledge");
  if (!existsSync(kdir)) return { files: [], map: new Map() };
  const files = readdirSync(kdir).filter((f) => f.endsWith(".md")).sort(); // 字母序稳定
  const map = new Map();
  files.forEach((f, i) => {
    const content = readFileSync(join(kdir, f), "utf8");
    // 字母序：A, B, C, ...
    const letter = String.fromCharCode(65 + i);
    map.set(`{{KNOWLEDGE_${letter}}}`, content);
    // 文件名序：content-center.md → CONTENT_CENTER
    const stem = f.replace(/\.md$/, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
    map.set(`{{KNOWLEDGE_${stem}}}`, content);
  });
  return { files, map };
}

/**
 * 构造任意工具 Agent 的 system prompt。
 * @param {string} key roster 中的 agent key（twin 除外）
 * @returns {string} 拼好的 system prompt
 */
export function buildToolSystem(key) {
  const entry = getRosterEntry(key);
  if (!entry) throw new Error(`[generic] unknown agent key: ${key}`);
  if (entry.kind !== "tool") throw new Error(`[generic] ${key} is not a tool agent (kind=${entry.kind})`);

  const agentDir = join(ROOT, entry.space);
  const manualPath = join(agentDir, "agent.md");
  if (!existsSync(manualPath)) {
    throw new Error(`[generic] agent.md not found at ${manualPath}`);
  }
  let prompt = readFileSync(manualPath, "utf8");

  // 1) 知识占位符替换
  const { map: kmap } = buildKnowledgeMap(agentDir);
  for (const [placeholder, content] of kmap) {
    prompt = prompt.split(placeholder).join(content);
  }
  // 2) 清理未匹配的 {{KNOWLEDGE_*}} 占位符（避免 LLM 看到字面量）
  prompt = prompt.replace(/\{\{KNOWLEDGE_[A-Z0-9_]+\}\}/g, "");

  // 3) 追加统一协作协议（含 capability 专属段）
  const caps = Array.isArray(entry.capabilities) ? entry.capabilities : [];
  prompt = `${prompt}\n\n${buildProtocolWithCapabilities(caps)}`;

  // 4) 追加每日进化经验
  const learn = readLearnings(agentDir);
  if (learn) {
    prompt = `${prompt}\n\n# 从过往任务中沉淀的经验（每日自动进化，可被人工审阅覆盖）\n\n${learn}`;
  }

  return prompt;
}

// 兼容旧 API：buildDataAgentSystem() / buildStyleAgentSystem() 仍可用，
// 但建议新代码直接用 buildToolSystem(key)。
export function buildDataAgentSystem() { return buildToolSystem("data"); }
export function buildStyleAgentSystem() { return buildToolSystem("style"); }
