// Agent 详情与「相关文件」的服务端逻辑（供 /api/agents 与 /api/agent/:key）。
// 身份 / 职责 / 边界 / 关联文件清单来自单一真相源 domain/roster.js；此处负责：
//   - 组装概要（列表）与详情；
//   - 按白名单路径读取关联文件内容（agent.md 手册、取数知识、技能包、参考档案）。
// 安全：路径来自 roster 白名单（用户只能选 key，不能传路径），读取时仍做 ROOT 前缀校验防穿越；
//       二进制 / 不可预览类型只给元信息不读内容。
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";
import { CONFIG } from "../config.js";
import { ROSTER, getRosterEntry } from "./roster.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", ".."); // domain -> server -> 项目根

// 可在线预览的纯文本类型；其余（.zip 等）只展示元信息
const TEXT_EXT = new Set([".md", ".js", ".mjs", ".cjs", ".txt", ".json", ".sql", ".css", ".html", ".yml", ".yaml"]);
const MAX_FILE = 500 * 1024; // 单文件预览上限，超出截断

// modelOf：从 agent-config.json 读用户保存的模型，回退到 CONFIG.models.<key>
// 支持任意 roster 中登记的 Agent，新增 Agent 自动可用。
function modelOf(key) {
  try {
    const saved = JSON.parse(readFileSync(join(ROOT, "agent-config.json"), "utf8"));
    if (saved[key]) return saved[key];
  } catch {}
  return CONFIG.models[key] || "";
}

// 读取单个关联文件的元信息（可读文本还会带 content）
function loadFile(f) {
  const abs = normalize(join(ROOT, f.path));
  const ext = extname(abs).toLowerCase();
  const readable = TEXT_EXT.has(ext);
  const info = {
    path: f.path, title: f.title, group: f.group, desc: f.desc || "",
    ext: ext.replace(/^\./, ""), readable, exists: false, size: 0, content: null, truncated: false,
  };
  if (!abs.startsWith(ROOT)) return info; // 防路径穿越
  try {
    if (!existsSync(abs) || !statSync(abs).isFile()) return info;
    info.exists = true;
    info.size = statSync(abs).size;
    if (readable) {
      const raw = readFileSync(abs, "utf8");
      if (raw.length > MAX_FILE) { info.content = raw.slice(0, MAX_FILE); info.truncated = true; }
      else info.content = raw;
    }
  } catch { /* 读失败则保持 content=null，前端降级展示 */ }
  return info;
}

// 供 /api/agents：所有 Agent 的概要（不含文件内容）
export function getAgentList() {
  return ROSTER.map((a) => ({
    key: a.key, kind: a.kind, name: a.name, icon: a.icon, color: a.color,
    tagline: a.tagline, model: modelOf(a.key),
    capabilities: a.capabilities || [],
    fileCount: (a.files || []).length,
  }));
}

// 供 /api/agent/:key：单个 Agent 详情 + 关联文件（含可读文本内容）
export function getAgentDetail(key) {
  const a = getRosterEntry(key);
  if (!a) return null;
  return {
    key: a.key, kind: a.kind, name: a.name, icon: a.icon, color: a.color, tagline: a.tagline,
    role: a.role, responsibilities: a.responsibilities, boundary: a.boundary,
    capabilities: a.capabilities || [],
    model: modelOf(a.key),
    files: (a.files || []).map(loadFile),
  };
}
