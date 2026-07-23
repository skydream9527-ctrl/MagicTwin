// 自定义 Agent 支持：上传 agent.md + 知识文件，自动注册到花名册。
// 存储：workspace/agents/{key}/ 下创建目录和文件。
// 运行时动态加入 roster（不修改 roster.js 源码）。
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const AGENTS_DIR = join(ROOT, "workspace", "agents");
const CUSTOM_INDEX = join(AGENTS_DIR, "custom-agents.json");

function readCustomIndex() {
  if (!existsSync(CUSTOM_INDEX)) return [];
  try { return JSON.parse(readFileSync(CUSTOM_INDEX, "utf8")); } catch { return []; }
}

function writeCustomIndex(index) {
  if (!existsSync(AGENTS_DIR)) mkdirSync(AGENTS_DIR, { recursive: true });
  writeFileSync(CUSTOM_INDEX, JSON.stringify(index, null, 2));
}

export function createCustomAgent(spec) {
  if (!spec.key || !spec.name) throw new Error("key 和 name 必填");
  const key = spec.key.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase().slice(0, 32);

  const agentDir = join(AGENTS_DIR, key);
  if (!existsSync(agentDir)) mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(agentDir, "knowledge"), { recursive: true });
  mkdirSync(join(agentDir, "memory"), { recursive: true });

  const agentMd = spec.agentMd || `# ${spec.name}\n\n${spec.role || "自定义工具 Agent"}\n`;
  writeFileSync(join(agentDir, "agent.md"), agentMd);

  if (spec.knowledgeFiles && Array.isArray(spec.knowledgeFiles)) {
    for (const f of spec.knowledgeFiles) {
      if (f.name && f.content) {
        const safeName = f.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        writeFileSync(join(agentDir, "knowledge", safeName), f.content);
      }
    }
  }

  const entry = {
    key,
    name: spec.name,
    icon: spec.icon || "🤖",
    color: spec.color || "#8a8a8a",
    tagline: spec.tagline || "",
    role: spec.role || "",
    capabilities: spec.capabilities || [],
    status: "published",
    custom: true,
    createdAt: new Date().toISOString(),
  };

  const index = readCustomIndex();
  const existing = index.findIndex(a => a.key === key);
  if (existing >= 0) index[existing] = entry; else index.push(entry);
  writeCustomIndex(index);

  return entry;
}

export function listCustomAgents() {
  return readCustomIndex();
}

export function deleteCustomAgent(key) {
  const index = readCustomIndex().filter(a => a.key !== key);
  writeCustomIndex(index);
}

export function getCustomAgentSpecs() {
  return readCustomIndex().map(a => ({
    key: a.key,
    kind: "tool",
    name: a.name,
    icon: a.icon,
    color: a.color,
    tagline: a.tagline,
    role: a.role,
    capabilities: a.capabilities || [],
    status: a.status || "published",
    space: `workspace/agents/${a.key}`,
    boundary: "面对的甲方是 Twin 而非用户本人；不替用户拍板。",
    responsibilities: [],
    custom: true,
  }));
}
