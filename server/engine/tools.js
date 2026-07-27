// 工具层：将所有 Agent 可调用动作统一收敛到此处，方便扩展
// 支持 query/execute_python/read_skill/write_file/now，后续加工具只需在 TOOLS 注册

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runQuery } from "../integrations/data-query.js";
import { runPython } from "../integrations/sandbox.js";
import { CONFIG } from "../config.js";
import { saveSql, saveData, saveFile } from "../domain/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");

function workspacePath() {
  return path.join(ROOT, "workspace");
}

// 控制流类型（不需要走工具执行）
export const CONTROL_TYPES = new Set(["ask", "report", "styled"]);

function safeName(prefix, raw) {
  return (raw || prefix).replace(/[^\w.\-]/g, "_").slice(0, 80);
}

async function ensureArtifactsDir(tid) {
  const dir = path.join(workspacePath(), "tasks", tid, "artifacts");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

const TOOLS = {
  query: {
    capability: "query",
    aliases: [],
    async execute(a, ctx) {
      const name = safeName(`T${ctx.steps || 0}`, a.name);
      if (!a.sql || !String(a.sql).trim()) {
        return { retry: true, correction: "【格式错误】type=\"query\" 必须带非空 sql 字段（SELECT 语句）。请补全后重新输出。" };
      }
      const sql = String(a.sql).trim();
      const callEvent = { text: a.purpose || "执行查询", sql, name };
      const res = await runQuery(sql);
      saveSql(ctx.tid, name, sql);
      if (res.ok) saveData(ctx.tid, name, { sql, columns: res.columns, records: res.records });
      const resultEvent = {
        name, ok: res.ok, ms: res.ms,
        rowCount: res.rowCount, columns: res.columns, colTypes: res.colTypes,
        records: res.ok ? res.records.slice(0, 200) : undefined,
        error: res.error, code: res.code,
      };
      let forLLM;
      if (res.ok) {
        const sample = res.records.slice(0, 80);
        const more = res.rowCount > sample.length ? `（仅前 ${sample.length} 行，共 ${res.rowCount} 行）` : "";
        forLLM = `【查询结果 ${name}】成功 ${res.rowCount} 行，${res.ms}ms。列：${res.columns.join(", ")}${more}\n数据(JSON)：${JSON.stringify(sample)}`;
      } else {
        forLLM = `【查询失败 ${name}】${res.error}（code=${res.code}）。请读报错改 SQL 重试，不要重复同样错误。`;
      }
      return { callEvent, resultEvent, forLLM };
    },
  },

  execute_python: {
    capability: "execute",
    aliases: ["execute"],
    async execute(a, ctx) {
      const name = safeName(`E${ctx.steps || 0}`, a.name);
      if (!a.code || !String(a.code).trim()) {
        return { retry: true, correction: "【格式错误】type=\"execute_python\" 必须带非空 code 字段。请补全后重新输出。" };
      }
      const callEvent = { text: a.purpose || "执行代码", code: a.code, name, lang: "python" };
      const res = await runPython(String(a.code));
      const resultEvent = {
        name, ok: res.ok, ms: res.ms,
        stdout: res.ok ? (res.stdout || "").slice(0, 8000) : undefined,
        stderr: (res.stderr || "").slice(0, 4000),
        error: res.error, code: res.code, lang: "python",
      };
      let forLLM;
      if (res.ok) {
        const out = (res.stdout || "").slice(0, 4000);
        const err = (res.stderr || "").slice(0, 1500);
        forLLM = `【代码执行结果 ${name}】成功（${res.ms}ms）。\nstdout:\n${out || "(无输出)"}${err ? `\nstderr(警告):\n${err}` : ""}`;
      } else {
        forLLM = `【代码执行失败 ${name}】${res.error}（code=${res.code}）。\n${res.stderr ? `stderr:\n${(res.stderr || "").slice(0, 2500)}` : ""}\n请读报错改代码重试。`;
      }
      return { callEvent, resultEvent, forLLM };
    },
  },

  read_skill: {
    capability: null,
    aliases: [],
    async execute(a) {
      if (!a.skill_id) return { retry: true, correction: "read_skill 必须带 skill_id 字段。" };
      const skillDir = path.join(workspacePath(), "twin", "knowledge", "skills", String(a.skill_id));
      const rel = a.path ? String(a.path).replace(/\.\./g, "") : "SKILL.md";
      const fp = path.join(skillDir, rel);
      let text = "";
      try {
        text = await fs.readFile(fp, "utf8");
      } catch {
        return { retry: false, forLLM: `read_skill 失败：技能 ${a.skill_id}/${rel} 不存在。请检查 skill_id/path 后重试，或在 report 中说明需要该技能。` };
      }
      const forLLM = `【技能文档 ${a.skill_id}/${rel}】\n${text.slice(0, 12000)}${text.length > 12000 ? `\n（截断，原文 ${text.length} 字）` : ""}`;
      return { callEvent: { text: `读技能 ${a.skill_id}`, name: `read_${a.skill_id}` }, resultEvent: { name: `read_${a.skill_id}`, ok: true, content: text.slice(0, 4000) }, forLLM };
    },
  },

  write_file: {
    capability: null,
    aliases: [],
    async execute(a, ctx) {
      if (!a.path || !a.content) return { retry: true, correction: "write_file 必须带 path 和 content 字段。" };
      const rel = String(a.path).replace(/\.\./g, "").replace(/^[\/\\]+/, "");
      const dir = await ensureArtifactsDir(ctx.tid);
      const fp = path.join(dir, rel);
      await fs.mkdir(path.dirname(fp), { recursive: true });
      const content = String(a.content);
      await fs.writeFile(fp, content, "utf8");
      saveFile(ctx.tid, rel, content);
      const forLLM = `write_file 成功：已写入 ${rel}（${content.length} 字符），可在任务产物区查看。`;
      return { callEvent: { text: `写文件 ${rel}`, name: `write_${rel}` }, resultEvent: { name: `write_${rel}`, ok: true, path: rel, size: content.length }, forLLM };
    },
  },

  now: {
    capability: null,
    aliases: [],
    async execute() {
      const d = new Date();
      const forLLM = `【当前时间】${d.toISOString()}（UTC）；本地 ${d.toLocaleString()}`;
      return { callEvent: { text: "获取当前时间", name: "now" }, resultEvent: { name: "now", ok: true, iso: d.toISOString() }, forLLM };
    },
  },
};

export function toolFor(type) {
  if (!type) return null;
  if (TOOLS[type]) return TOOLS[type];
  for (const t of Object.values(TOOLS)) {
    if (t.aliases && t.aliases.includes(type)) return t;
  }
  return null;
}

export async function runTool(type, action, ctx) {
  const tool = toolFor(type);
  if (!tool) throw new Error(`未知工具类型: ${type}`);
  return tool.execute(action, ctx);
}
