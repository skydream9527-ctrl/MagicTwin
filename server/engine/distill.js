// Twin 画像蒸馏引擎：从工作空间文件自动提取用户画像。
// 读取配置的外部工作空间路径（或本地 Twin profile），用 LLM 蒸馏出结构化画像。
// API：GET /api/twin/distill → 蒸馏状态；POST /api/twin/distill → 手动触发蒸馏。
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { CONFIG } from "../config.js";
import { chat, hasKey } from "../integrations/llm.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TWIN_DIR = join(ROOT, "workspace", "users", "u_local", "twin");
const PROFILE_PATH = join(TWIN_DIR, "profile.md");
const HISTORY_DIR = join(TWIN_DIR, "memory", "profile-history");

let lastRun = null;
let lastStatus = "idle";
let lastError = "";

const SOURCE_FILES = [
  "AGENTS.md", "USER.md", "CURRENT.md", "WORK-PLAN.md",
  "MEMORY.md", "DECISIONS.md", "WORKFLOWS.md",
];

function readSourceFiles(wsPath) {
  const found = [];
  if (!wsPath || !existsSync(wsPath)) return found;
  for (const name of SOURCE_FILES) {
    const fp = join(wsPath, name);
    try {
      if (existsSync(fp) && statSync(fp).isFile()) {
        const content = readFileSync(fp, "utf8").trim();
        if (content) found.push({ name, path: fp, content: content.slice(0, 8000), lastModified: statSync(fp).mtime.toISOString() });
      }
    } catch { /* skip */ }
  }
  return found;
}

export function getDistillStatus() {
  const wsPath = CONFIG.distill && CONFIG.distill.workspacePath;
  const sources = readSourceFiles(wsPath);
  return {
    lastRun,
    status: lastStatus,
    error: lastError,
    workspacePath: wsPath || "(未配置)",
    sourceFiles: sources.map(s => ({ name: s.name, lastModified: s.lastModified })),
    profileExists: existsSync(PROFILE_PATH),
    profileLastModified: existsSync(PROFILE_PATH) ? statSync(PROFILE_PATH).mtime.toISOString() : null,
  };
}

export async function runDistill() {
  if (!hasKey()) throw new Error("LLM_API_KEY 未配置");
  lastStatus = "running";
  lastError = "";

  const wsPath = CONFIG.distill && CONFIG.distill.workspacePath;
  const model = (CONFIG.distill && CONFIG.distill.model) || CONFIG.twinModel;

  let sources = readSourceFiles(wsPath);

  let existingProfile = "";
  if (existsSync(PROFILE_PATH)) {
    existingProfile = readFileSync(PROFILE_PATH, "utf8").trim().slice(0, 12000);
  }

  if (sources.length === 0 && !existingProfile) {
    lastStatus = "error";
    lastError = "无可蒸馏的源文件（请配置 DISTILL_WORKSPACE 环境变量）";
    throw new Error(lastError);
  }

  const sourceText = sources.map(s => `### ${s.name}\n\n${s.content}`).join("\n\n---\n\n");
  const systemPrompt = `你是一个用户画像蒸馏引擎。你的任务是从用户的工作空间文件中提取结构化的用户画像信息。

请从以下内容中提取：
1. 用户基本信息（角色、团队、职责）
2. 决策风格（保守/激进、偏好）
3. 常用指标口径默认值
4. 业务坑点与硬性规则
5. 说话风格与交付偏好
6. 当前重点工作与优先级
7. 关注的核心指标

输出格式：Markdown，清晰分节，简洁有力。只输出画像内容，不加解释。`;

  const userContent = sources.length > 0
    ? `以下是用户工作空间的核心文件内容：\n\n${sourceText}`
    : `以下是用户的现有画像（请基于此优化和更新）：\n\n${existingProfile}`;

  try {
    const result = await chat({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      maxTokens: 3000,
      temperature: 0.2,
    });

    const newProfile = result.content || "";
    if (!newProfile.trim()) {
      lastStatus = "error";
      lastError = "LLM 返回空内容";
      throw new Error(lastError);
    }

    if (existsSync(PROFILE_PATH)) {
      if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const backupPath = join(HISTORY_DIR, `profile-${ts}.md`);
      writeFileSync(backupPath, readFileSync(PROFILE_PATH, "utf8"));
    }

    const header = `<!-- 蒸馏时间：${new Date().toISOString()} | 来源：${sources.map(s => s.name).join(", ") || "现有画像优化"} -->\n\n`;
    writeFileSync(PROFILE_PATH, header + newProfile);

    lastRun = new Date().toISOString();
    lastStatus = "success";
    return { ok: true, profile: newProfile.slice(0, 500) + "…" };
  } catch (err) {
    if (lastStatus === "running") lastStatus = "error";
    lastError = err.message || String(err);
    throw err;
  }
}
