// 通用数据查询适配器（只读 SQL）。
//
// 设计目标：让 MagicTwin 开箱即用，不绑定任何特定数据平台。
// 默认返回示例数据（演示模式）；通过环境变量可接入真实数据源。
//
// 接入真实数据源的方式（任选其一）：
//   1. 设 QUERY_BACKEND=sqlite + SQLITE_PATH=/path/to/data.db （需 Node >= 22 的 node:sqlite）
//   2. 设 QUERY_BACKEND=command + QUERY_COMMAND="your-cli {sql}" （自定义 CLI，输出 JSON）
//   3. 直接修改本文件底部的 adapter 实现（参考 SQLite 适配器注释）
//
// 安全：只允许 SELECT / WITH...SELECT，硬拒 DDL/DML/多语句。
import "../env.js";
import { execFile } from "node:child_process";

const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|MERGE|GRANT|REVOKE|CALL|REPLACE|SET|USE)\b/i;

function stripComments(sql) {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .trim();
}

/**
 * 校验只读。返回 {ok, reason?}
 */
export function validateSelectOnly(sql) {
  const bare = stripComments(sql).replace(/;\s*$/, "");
  if (!bare) return { ok: false, reason: "空 SQL" };
  if (bare.includes(";")) return { ok: false, reason: "禁止多语句（含分号分隔）" };
  const first = bare.match(/^\s*([a-zA-Z]+)/);
  const kw = first ? first[1].toUpperCase() : "";
  if (kw !== "SELECT" && kw !== "WITH") {
    return { ok: false, reason: `只允许 SELECT / WITH 查询，检测到 ${kw || "未知"}` };
  }
  if (FORBIDDEN.test(bare)) {
    return { ok: false, reason: "检测到写/DDL 关键字，已拒绝（只读模式）" };
  }
  return { ok: true };
}

// —— 示例数据（演示模式）——
// 当未配置真实数据源时，对 SELECT 返回一组示例数据，让编排链路可完整跑通。
function sampleData(sql) {
  const lower = sql.toLowerCase();
  if (lower.includes("count")) {
    return { columns: ["cnt"], rows: [[1280]], colTypes: ["bigint"] };
  }
  return {
    columns: ["date", "metric_value", "dimension_a"],
    colTypes: ["int", "bigint", "string"],
    rows: [
      [20260701, 12500, "A"],
      [20260702, 13200, "A"],
      [20260703, 11800, "B"],
      [20260704, 14100, "A"],
      [20260705, 10900, "B"],
      [20260706, 13500, "A"],
      [20260707, 11200, "B"],
    ],
  };
}

// —— 命令行适配器：调用外部 CLI 执行 SQL，期望输出 JSON {columns:[{name,type}], rows:[[...]]} ——
function runCommandQuery(sql, command) {
  const cmd = command.replace("{sql}", sql);
  const [bin, ...args] = cmd.split(/\s+/);
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 120000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve({ ok: false, error: String(err.message).slice(0, 200) });
      try {
        const data = JSON.parse((stdout || "").trim());
        if (data && Array.isArray(data.columns) && Array.isArray(data.rows)) {
          return resolve(data);
        }
      } catch {}
      return resolve({ ok: false, error: "外部命令返回的数据无法解析为 JSON" });
    });
  });
}

/**
 * 执行只读查询。
 * @param {string} sql
 * @returns {Promise<{ok:boolean, sql:string, ms:number, columns?:string[], rows?:any[][], records?:object[], rowCount?:number, truncated?:boolean, error?:string, code?:string}>}
 */
export function runQuery(sql) {
  const check = validateSelectOnly(sql);
  const t0 = Date.now();
  if (!check.ok) {
    return Promise.resolve({ ok: false, sql, ms: 0, error: check.reason, code: "SQL_BLOCKED" });
  }

  const backend = process.env.QUERY_BACKEND || "sample";
  const rowLimit = Number(process.env.QUERY_ROW_LIMIT || 2000);

  if (backend === "sample") {
    // 演示模式：返回示例数据
    const data = sampleData(sql);
    const columns = data.columns;
    let rows = data.rows;
    const truncated = rows.length > rowLimit;
    if (truncated) rows = rows.slice(0, rowLimit);
    const records = rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])));
    return Promise.resolve({ ok: true, sql, ms: Date.now() - t0, columns, rows, records, rowCount: rows.length, truncated, colTypes: data.colTypes || [] });
  }

  if (backend === "command") {
    const command = process.env.QUERY_COMMAND;
    if (!command) {
      return Promise.resolve({ ok: false, sql, ms: 0, error: "QUERY_BACKEND=command 但未设 QUERY_COMMAND", code: "BACKEND_NOT_CONFIGURED" });
    }
    return runCommandQuery(sql, command).then((result) => {
      const ms = Date.now() - t0;
      if (result.ok === false) {
        return { ok: false, sql, ms, error: result.error, code: "QUERY_ERROR" };
      }
      const columns = result.columns.map((c) => c.name || c);
      let rows = result.rows;
      const truncated = rows.length > rowLimit;
      if (truncated) rows = rows.slice(0, rowLimit);
      const records = rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])));
      return { ok: true, sql, ms, columns, rows, records, rowCount: rows.length, truncated, colTypes: result.columns.map((c) => c.type || "string") };
    });
  }

  // 未知 backend
  return Promise.resolve({ ok: false, sql, ms: 0, error: `不支持的 QUERY_BACKEND: ${backend}（可选: sample / command）`, code: "BACKEND_NOT_CONFIGURED" });
}

/**
 * 是否配置了真实数据源（非演示模式）。
 */
export function hasRealBackend() {
  const backend = process.env.QUERY_BACKEND || "sample";
  return backend !== "sample";
}
