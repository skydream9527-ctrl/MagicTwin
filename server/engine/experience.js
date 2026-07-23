// 经验包引擎：存储、检索、自动提取经验包。
// 数据存储：workspace/experience/index.json + workspace/experience/packs/{id}.json
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { CONFIG } from "../config.js";
import { chat, hasKey } from "../integrations/llm.js";
import { getMeta, readEvents, readDecisions } from "../domain/store.js";
import { questionsToText, answersToText } from "../domain/events.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXP_DIR = join(ROOT, "workspace", "experience");
const PACKS_DIR = join(EXP_DIR, "packs");
const INDEX_PATH = join(EXP_DIR, "index.json");

function ensureDirs() {
  if (!existsSync(EXP_DIR)) mkdirSync(EXP_DIR, { recursive: true });
  if (!existsSync(PACKS_DIR)) mkdirSync(PACKS_DIR, { recursive: true });
}

function readIndex() {
  ensureDirs();
  if (!existsSync(INDEX_PATH)) return [];
  try { return JSON.parse(readFileSync(INDEX_PATH, "utf8")); } catch { return []; }
}

function writeIndex(index) {
  ensureDirs();
  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
}

function readPack(id) {
  const fp = join(PACKS_DIR, `${id}.json`);
  if (!existsSync(fp)) return null;
  try { return JSON.parse(readFileSync(fp, "utf8")); } catch { return null; }
}

function writePack(pack) {
  ensureDirs();
  writeFileSync(join(PACKS_DIR, `${pack.id}.json`), JSON.stringify(pack, null, 2));
}

export function listExperience(query = {}) {
  const index = readIndex();
  let result = index;
  if (query.status) result = result.filter(p => p.status === query.status);
  if (query.q) {
    const q = query.q.toLowerCase();
    result = result.filter(p =>
      (p.title || "").toLowerCase().includes(q) ||
      (p.tags || []).some(t => t.toLowerCase().includes(q)) ||
      (p.category || "").toLowerCase().includes(q)
    );
  }
  return result;
}

export function getExperience(id) {
  return readPack(id);
}

export function saveExperience(pack) {
  if (!pack.id) pack.id = `exp-${Date.now()}-${randomUUID().slice(0, 4)}`;
  if (!pack.createdAt) pack.createdAt = new Date().toISOString();
  pack.updatedAt = new Date().toISOString();
  if (!pack.status) pack.status = "draft";
  if (!pack.usageCount) pack.usageCount = 0;

  writePack(pack);

  const index = readIndex();
  const existing = index.findIndex(p => p.id === pack.id);
  const summary = { id: pack.id, title: pack.title, category: pack.category, status: pack.status, tags: pack.tags || [], createdAt: pack.createdAt, updatedAt: pack.updatedAt, usageCount: pack.usageCount };
  if (existing >= 0) index[existing] = summary; else index.push(summary);
  writeIndex(index);

  return pack;
}

export function deleteExperience(id) {
  const fp = join(PACKS_DIR, `${id}.json`);
  if (existsSync(fp)) unlinkSync(fp);
  const index = readIndex().filter(p => p.id !== id);
  writeIndex(index);
}

export async function extractFromTask(taskId) {
  if (!hasKey()) throw new Error("LLM_API_KEY 未配置");
  const meta = getMeta(taskId);
  if (!meta) throw new Error("任务不存在");

  const events = readEvents(taskId);
  const decisions = readDecisions(taskId);

  const eventSummary = events.slice(0, 30).map(e => {
    if (e.kind === "goal") return `目标：${e.text || e.goal}`;
    if (e.kind === "query") return `查询：${(e.sql || e.text || "").slice(0, 150)}`;
    if (e.kind === "report") return `结论：${(e.summary || e.text || "").slice(0, 200)}`;
    if (e.kind === "ask") return `确认项：${questionsToText(e.questions, "; ").slice(0, 150)}`;
    if (e.kind === "answer") return `代答：${answersToText(e.answers, "; ").slice(0, 150)}`;
    if (e.kind === "deliver") return `交付：${(e.summary || e.text || "").slice(0, 200)}`;
    return "";
  }).filter(Boolean).join("\n");

  const decisionSummary = decisions.slice(0, 10).map(d =>
    `Q: ${d.question || ""} → A: ${d.answer || ""}`
  ).join("\n");

  const prompt = `你是一个经验包提取引擎。请从以下任务执行记录中提取一个可复用的经验包。

## 任务信息
- 目标：${meta.goal}
- 状态：${meta.status}

## 执行过程
${eventSummary}

## 决策记录
${decisionSummary}

请输出严格 JSON 格式（不要 markdown 代码块）：
{
  "title": "一句话标题",
  "category": "分类（如：波动归因/AB实验/报告生成/数据查询）",
  "tags": ["标签1", "标签2"],
  "content": {
    "scenario": "适用场景描述",
    "approach": "分析方法/步骤",
    "key_findings": ["关键发现"],
    "pitfalls": ["踩坑记录/注意事项"]
  }
}`;

  const model = CONFIG.distill?.model || CONFIG.twinModel;
  const result = await chat({
    model,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 2000,
    temperature: 0.2,
  });

  let parsed;
  try {
    const text = (result.content || "").trim().replace(/^```json?\s*/i, "").replace(/```$/, "").trim();
    parsed = JSON.parse(text);
  } catch {
    throw new Error("LLM 输出无法解析为 JSON");
  }

  const pack = {
    id: `exp-${Date.now()}-${randomUUID().slice(0, 4)}`,
    title: parsed.title || meta.goal,
    category: parsed.category || "未分类",
    status: "draft",
    createdAt: new Date().toISOString(),
    sourceTaskId: taskId,
    tags: parsed.tags || [],
    content: parsed.content || {},
    usageCount: 0,
  };

  return saveExperience(pack);
}

export function searchRelevant(text, topN = 3) {
  if (!text) return [];
  const index = readIndex().filter(p => p.status === "verified");
  if (index.length === 0) return [];

  const keywords = text.toLowerCase().split(/[\s,，。！？；：、]+/).filter(w => w.length > 1);
  const scored = index.map(p => {
    let score = 0;
    const pText = `${p.title} ${p.category} ${(p.tags || []).join(" ")}`.toLowerCase();
    for (const kw of keywords) {
      if (pText.includes(kw)) score++;
    }
    return { ...p, score };
  }).filter(s => s.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN).map(s => readPack(s.id)).filter(Boolean);
}

export function markUsed(id) {
  const pack = readPack(id);
  if (!pack) return;
  pack.usageCount = (pack.usageCount || 0) + 1;
  pack.lastUsed = new Date().toISOString();
  writePack(pack);
  const index = readIndex();
  const i = index.findIndex(p => p.id === id);
  if (i >= 0) { index[i].usageCount = pack.usageCount; writeIndex(index); }
}
