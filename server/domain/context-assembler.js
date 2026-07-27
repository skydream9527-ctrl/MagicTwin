import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { getRosterEntry } from "./roster.js";
import { buildTwinSystem } from "../prompts/twin.js";
import { buildDataAgentSystem } from "../prompts/data-agent.js";
import { buildStyleAgentSystem } from "../prompts/style-agent.js";
import { buildToolSystem } from "../prompts/generic.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKSPACE = join(ROOT, "workspace");

const ROLE_MAX = Number(process.env.CTX_ROLE_MAX_TOKENS || 2000);
const SKILL_MAX = Number(process.env.CTX_SKILL_MAX_TOKENS || 3000);
const EXP_MAX = Number(process.env.CTX_EXP_MAX_TOKENS || 1000);
const TASK_MAX = Number(process.env.CTX_TASK_MAX_TOKENS || 2000);
const EXP_TOP_K = Number(process.env.EXPERIENCE_TOP_K || 3);
const CHARS_PER_TOKEN = 2.5;

function tokLen(text) { return Math.ceil((text || "").length / CHARS_PER_TOKEN); }
function readTrim(p) { try { return existsSync(p) ? readFileSync(p, "utf8").trim() : ""; } catch { return ""; } }
function readOrNull(p) { try { return existsSync(p) ? readFileSync(p, "utf8") : null; } catch { return null; } }

async function assembleRole(agentKey, uid) {
  let roleBlock = "";
  try {
    if (agentKey === "twin") roleBlock = buildTwinSystem();
    else if (agentKey === "data") roleBlock = buildDataAgentSystem();
    else if (agentKey === "style") roleBlock = buildStyleAgentSystem();
    else roleBlock = buildToolSystem(agentKey);
  } catch (err) {
    const entry = getRosterEntry(agentKey);
    const spaceRel = (entry && entry.space) || join("workspace", "agents", agentKey);
    const agentMd = readTrim(join(ROOT, spaceRel, "agent.md"));
    roleBlock = agentMd || `# ${(entry && entry.name) || agentKey}\n\n${(entry && entry.role) || "通用工具 Agent（agent.md 未配置）"}`;
  }
  return { roleBlock, roleTokens: tokLen(roleBlock) };
}

async function assembleSkill(agentKey) {
  if (["twin", "data", "style"].includes(agentKey)) return { skillBlock: "", skillTokens: 0 };

  const skills = [];

  const kyuubiSkill = join(WORKSPACE, "skills", "kyuubi", "SKILL.md");
  if (existsSync(kyuubiSkill)) {
    const content = readFileSync(kyuubiSkill, "utf8");
    const core = extractCore(content, ["## 使用", "## 约束", "## 安全"]);
    if (core) skills.push(core);
  }

  if (["data", "data-analysis", "nl-sql"].includes(agentKey)) {
    const nlSqlSkill = join(WORKSPACE, "skills", "nl-mapping-table-sql", "SKILL.md");
    if (existsSync(nlSqlSkill)) {
      const content = readFileSync(nlSqlSkill, "utf8");
      const core = extractCore(content, ["## 概述", "## 使用"]);
      if (core) skills.push(core);
    }
  }

  if (["style", "style-optimizer", "report-writer"].includes(agentKey)) {
    const feishuSkill = join(WORKSPACE, "skills", "feishu", "SKILL.md");
    if (existsSync(feishuSkill)) {
      const content = readFileSync(feishuSkill, "utf8");
      const core = extractCore(content, ["## 概述", "## 使用"]);
      if (core) skills.push(core);
    }
  }

  const knowledgeDir = join(WORKSPACE, "agents", agentKey, "knowledge");
  if (existsSync(knowledgeDir)) {
    const indexYaml = join(knowledgeDir, "index.yaml");
    if (existsSync(indexYaml)) {
      const yaml = readFileSync(indexYaml, "utf8");
      skills.push(yaml.slice(0, 600));
    }
  }

  const skillBlock = skills.join("\n\n---\n\n");
  return { skillBlock: skillBlock.slice(0, SKILL_MAX), skillTokens: tokLen(skillBlock) };
}

function extractCore(md, headings) {
  const lines = md.split("\n");
  const result = [];
  let capturing = false;

  for (const line of lines) {
    const isHeading = headings.some(h => line.startsWith(h));
    if (isHeading) {
      capturing = true;
      result.push(line);
      continue;
    }
    if (capturing && line.startsWith("## ") && !headings.includes(line.trim())) {
      capturing = false;
      continue;
    }
    if (capturing) result.push(line);
  }

  return result.length > 1 ? result.join("\n").slice(0, 1500) : null;
}

let _experienceModule = null;
function getExperienceModule() {
  if (!_experienceModule) {
    try {
      import("./experience.js").then(m => { _experienceModule = m; });
    } catch {}
  }
  return _experienceModule;
}

async function assembleExperience(agentKey, uid, sceneKeywords) {
  const expModule = getExperienceModule();
  if (!expModule || !sceneKeywords || !sceneKeywords.length) {
    return { expBlock: "", expTokens: 0 };
  }

  try {
    const results = await expModule.search(uid, sceneKeywords, EXP_TOP_K);
    if (!results || !results.length) return { expBlock: "", expTokens: 0 };

    const isTool = agentKey !== "twin";
    const blocks = results.map((r, i) => {
      const parts = [];
      parts.push(`经验${i + 1}: ${r.scene} (匹配度:${Math.round((r.score || 0) * 100)}%)`);

      if (!isTool && r.key_decisions) {
        parts.push(`- 关键决策: ${r.key_decisions}`);
      }
      if (isTool && r.approach) {
        parts.push(`- 正确做法: ${r.approach}`);
      }
      if (r.pitfalls) {
        parts.push(`- 注意: ${r.pitfalls}`);
      }
      if (isTool && r.sql_templates) {
        parts.push(`- SQL模板: ${r.sql_templates}`);
      }

      return parts.join("\n");
    });

    const expBlock = `以下是你从历史任务中积累的经验 (Top-${results.length}匹配):\n\n` + blocks.join("\n\n");
    return { expBlock: expBlock.slice(0, EXP_MAX), expTokens: tokLen(expBlock) };
  } catch {
    return { expBlock: "", expTokens: 0 };
  }
}

async function assembleTask(taskContext) {
  const parts = [];
  if (taskContext.goal) {
    parts.push(`## 用户目标\n${taskContext.goal}`);
  }
  if (taskContext.subTask) {
    parts.push(`## 当前子任务\n${taskContext.subTask}`);
  }
  if (taskContext.sceneKeywords && taskContext.sceneKeywords.length) {
    parts.push(`## 场景关键词\n${taskContext.sceneKeywords.join(", ")}`);
  }

  const taskBlock = parts.join("\n\n");
  return { taskBlock: taskBlock.slice(0, TASK_MAX), taskTokens: tokLen(taskBlock) };
}

export async function assemble(agentKey, uid = "u_local", taskContext = {}) {
  const [role, skill, exp, task] = await Promise.all([
    assembleRole(agentKey, uid),
    assembleSkill(agentKey),
    assembleExperience(agentKey, uid, taskContext.sceneKeywords),
    assembleTask(taskContext),
  ]);

  const sections = [role.roleBlock];
  if (skill.skillBlock) sections.push(skill.skillBlock);
  if (exp.expBlock) sections.push(exp.expBlock);
  if (task.taskBlock) sections.push(task.taskBlock);

  const prompt = sections.join("\n\n---\n\n");
  const total = role.roleTokens + skill.skillTokens + exp.expTokens + task.taskTokens;

  if (process.env.CTX_DEBUG === "1") {
    console.log(`[context-assembler] ${agentKey}: 角色${role.roleTokens}t + 技能${skill.skillTokens}t + 项目${exp.expTokens}t + 任务${task.taskTokens}t = ${total}t / ~${(total / CHARS_PER_TOKEN).toFixed(0)} chars`);
  }

  return prompt;
}

export async function assembleLight(agentKey, uid = "u_local") {
  const role = await assembleRole(agentKey, uid);
  return role.roleBlock;
}

export async function assembleForReflect(agentKey, uid = "u_local") {
  const [role, skill] = await Promise.all([
    assembleRole(agentKey, uid),
    assembleSkill(agentKey),
  ]);
  return [role.roleBlock, skill.skillBlock].filter(Boolean).join("\n\n---\n\n");
}

export function extractSceneKeywords(goal) {
  if (!goal) return [];
  const builtin = {
    "归因": ["归因", "定位", "为什么", "下降", "上升", "波动", "变化", "异常", "异动"],
    "取数": ["取数", "查询", "查一下", "帮我查", "数据", "统计"],
    "报表": ["报表", "周报", "日报", "月报", "报告", "自动"],
    "实验": ["实验", "AB", "ab", "显著性", "对照组", "实验组"],
    "灰度": ["灰度", "版本", "放量"],
  };

  const keywords = [];
  for (const [, patterns] of Object.entries(builtin)) {
    for (const p of patterns) {
      if (goal.toLowerCase().includes(p.toLowerCase()) && !keywords.includes(p)) {
        keywords.push(p);
      }
    }
  }
  return keywords;
}

export const CONTEXT_CONFIG = {
  ROLE_MAX, SKILL_MAX, EXP_MAX, TASK_MAX, EXP_TOP_K, CHARS_PER_TOKEN,
};
