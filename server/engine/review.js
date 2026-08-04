// 到期回看引擎（收敛标准重启与重议章节）。
// 解决的问题：结论收口之后没人管，错了也没人发现，或者靠谁临时想起来才重开讨论。
// 做法：收口时写下 review_at + review_questions + restart_condition（由 orchestrator 落到 meta.review），
//       这里到期主动扫描 → 生成回填简报 → 人给出三态判定（成立 / 部分成立 / 推翻）→ 判定结果决定是否重议及重议档位。
//
// 三态判定：
//   成立     → 延长 review_at，不开场，沉淀为可复用经验
//   部分成立 → R1 或 R2 重议（继承事实层，重议判断层）
//   推翻     → R2 或 R3 重议（口径变更一律 R3，事实层也要重验），并检查是不是护栏漏了一条
//
// 一切降级不阻塞：无任务、无 review 字段、写文件失败都不抛异常。
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { CONFIG } from "../config.js";
import { listTasks, getMeta, updateMeta, appendEvent, appendDiscussion } from "../domain/store.js";
import { defaultReviewAt } from "./discussion.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REVIEW_DIR = join(ROOT, "workspace", "reviews");

export const VERDICTS = ["成立", "部分成立", "推翻"];
// 判定 → 重议档位。R1 局部修正 / R2 结论重议 / R3 前提重议。
const SCOPE_BY_VERDICT = { 成立: null, 部分成立: "R2", 推翻: "R3" };

export function todayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 收集所有到期未回填的结论。返回按 review_at 升序的数组。
 *  注意：已回填、正等着重议的（reopen_pending）不在此列——它们缺的是「要不要重议」的决定，不是回填，
 *  混在一起会让每日简报反复提醒同一件已经判过的事。 */
export function collectDue(now = new Date()) {
  const today = todayStr(now);
  const out = [];
  for (const meta of listTasks()) {
    const r = meta && meta.review;
    if (!r || !r.review_at) continue;
    if (r.status === "done" || r.status === "closed") continue;     // 已收尾
    if (r.status === "reopen_pending") continue;                    // 已回填，待重议
    if (String(r.review_at) > today) continue;                      // 未到期
    out.push({
      tid: meta.tid,
      goal: meta.goal || "",
      status: meta.status || "",
      mode: meta.mode || "normal",
      review_at: r.review_at,
      overdue_days: daysBetween(r.review_at, today),
      questions: Array.isArray(r.review_questions) ? r.review_questions : [],
      restart_condition: r.restart_condition || "",
      verdict_text: r.verdict_text || "",
      reopen_count: Number(r.reopen_count || 0),
      notified_at: r.notified_at || "",
    });
  }
  return out.sort((a, b) => (a.review_at < b.review_at ? -1 : 1));
}

/** 已回填判定为「部分成立 / 推翻」、正等着重议决定的结论（按 R1/R2/R3 定重议范围）。 */
export function collectReopenPending() {
  const out = [];
  for (const meta of listTasks()) {
    const r = meta && meta.review;
    if (!r || r.status !== "reopen_pending") continue;
    const last = (Array.isArray(r.results) ? r.results : []).slice(-1)[0] || {};
    out.push({
      tid: meta.tid, goal: meta.goal || "", review_at: r.review_at || "",
      verdict: last.verdict || "", scope: last.scope || "", gap_reason: last.gap_reason || "",
      lesson: last.lesson || "", reopen_count: Number(r.reopen_count || 0),
      blocked: Number(r.reopen_count || 0) >= 3, // 第 3 次起不再自动重议
    });
  }
  return out;
}

function daysBetween(from, to) {
  const a = new Date(`${from}T00:00:00`), b = new Date(`${to}T00:00:00`);
  const d = Math.round((b - a) / 86400000);
  return Number.isFinite(d) ? Math.max(0, d) : 0;
}

/** 简报正文（人可读，落 workspace/reviews/YYYY-MM-DD.md）。 */
function buildDigest(date, due) {
  const lines = [
    `# 到期回看简报 · ${date}`,
    "",
    `共 ${due.length} 条结论到期待回填。`,
    "",
    "| 任务 | 目标 | 回看日期 | 逾期天数 | 已重议次数 |",
    "|---|---|---|---|---|",
    ...due.map((d) => `| \`${d.tid}\` | ${String(d.goal).slice(0, 40)} | ${d.review_at} | ${d.overdue_days} | ${d.reopen_count} |`),
    "",
    "## 逐条检查项",
    "",
  ];
  for (const d of due) {
    lines.push(`### ${d.tid}｜${String(d.goal).slice(0, 60)}`);
    lines.push("");
    if (d.verdict_text) lines.push(`- 当初结论：${String(d.verdict_text).slice(0, 300)}`);
    lines.push(`- 回看时间：${d.review_at}（逾期 ${d.overdue_days} 天）`);
    if (d.restart_condition) lines.push(`- 重启条件：${d.restart_condition}`);
    lines.push(`- 待检查问题：`);
    for (const q of (d.questions.length ? d.questions : ["（收口时未写具体检查问题，按当初判定标准复核）"])) lines.push(`  - [ ] ${q}`);
    lines.push("");
    lines.push(`- 回填方式：\`POST /api/task/${d.tid}/review\`，body: { verdict: "成立|部分成立|推翻", actual, gap_reason, lesson }`);
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push("判定为「部分成立 / 推翻」时定重议档位：R1 局部修正（原场补一轮）· R2 结论重议（继承事实层）· R3 前提重议（口径变更，事实层也要重验）。");
  lines.push("判定为「推翻」时必须额外检查：是不是验收清单 / 护栏漏了一条。");
  return lines.join("\n");
}

/**
 * 扫描到期回看。
 * @param {object} opts
 *   opts.write   是否写简报文件（默认 true）
 * @returns {{date, due, digestPath}}
 */
export async function scanDueReviews({ write = true } = {}) {
  const date = todayStr();
  const due = collectDue();
  let digestPath = "";

  if (due.length && write) {
    try {
      mkdirSync(REVIEW_DIR, { recursive: true });
      digestPath = join(REVIEW_DIR, `${date}.md`);
      writeFileSync(digestPath, buildDigest(date, due));
    } catch { digestPath = ""; }
  }

  // 每条到期结论在其任务空间里留痕（当天只留一次），任务被重新打开时能看到这条提醒。
  for (const d of due) {
    if (d.notified_at === date) continue;
    try {
      appendEvent(d.tid, {
        actor: "system", kind: "review_due", channel: "main",
        text: `结论到期回看（${d.review_at}${d.overdue_days ? `，逾期 ${d.overdue_days} 天` : ""}）：请对照检查项回填判定（成立 / 部分成立 / 推翻）。`,
        questions: d.questions, restart_condition: d.restart_condition,
      });
      appendDiscussion(d.tid, { kind: "review_due", review_at: d.review_at, overdue_days: d.overdue_days, questions: d.questions });
      const meta = getMeta(d.tid);
      updateMeta(d.tid, { review: { ...(meta && meta.review ? meta.review : {}), status: "due", notified_at: date } });
    } catch { /* 单条失败不影响其余 */ }
  }

  return { date, due, digestPath };
}

/**
 * 回填一条到期判定。
 * @param {string} tid
 * @param {object} result { verdict, actual, gap_reason, lesson, rule_added, scope, caliber_changed }
 * @returns {{ok, verdict, scope, next, review_at}|{ok:false, error}}
 */
export function recordReviewResult(tid, result = {}) {
  const meta = getMeta(tid);
  if (!meta) return { ok: false, error: "task not found" };
  const verdict = String(result.verdict || "").trim();
  if (!VERDICTS.includes(verdict)) return { ok: false, error: `verdict 必须是 ${VERDICTS.join(" / ")} 之一` };

  const prev = meta.review || {};
  // 档位：显式指定优先；口径变更一律 R3（事实层也要重验）；否则按判定三态映射。
  let scope = ["R1", "R2", "R3"].includes(String(result.scope || "").toUpperCase()) ? String(result.scope).toUpperCase() : SCOPE_BY_VERDICT[verdict];
  if (scope && result.caliber_changed) scope = "R3";

  const record = {
    at: todayStr(),
    verdict,
    actual_vs_expected: String(result.actual || "").trim(),
    gap_reason: String(result.gap_reason || "").trim(),
    lesson: String(result.lesson || "").trim(),
    rule_added: String(result.rule_added || "").trim(),
    scope: scope || "",
  };

  // 成立：不开场，延长回看；其余：标记待重议，重议次数 +1
  const nextReviewAt = verdict === "成立" ? defaultReviewAt(CONFIG.review.defaultDays) : prev.review_at;
  const patch = {
    ...prev,
    status: verdict === "成立" ? "pending" : "reopen_pending",
    review_at: nextReviewAt,
    notified_at: "",
    results: [...(Array.isArray(prev.results) ? prev.results : []), record],
    reopen_count: verdict === "成立" ? Number(prev.reopen_count || 0) : Number(prev.reopen_count || 0) + 1,
  };
  updateMeta(tid, { review: patch });

  const next = verdict === "成立"
    ? `结论仍成立，不开场；回看时间延长到 ${nextReviewAt}${record.lesson ? "；经验已记录" : ""}`
    : `按 ${scope} 档重议：${scope === "R1" ? "原场补一轮，只重算被质疑的那个数" : scope === "R2" ? "新开一场，继承已定事实，重议判断层" : "新开一场，口径/前提已变，事实层也要重验"}`;

  try {
    appendDiscussion(tid, { kind: "review_result", ...record, next, reopen_count: patch.reopen_count });
    appendEvent(tid, {
      actor: "system", kind: "review_result", channel: "main",
      text: `回看判定：${verdict}${record.gap_reason ? `（偏差原因：${record.gap_reason}）` : ""}。${next}`,
      verdict, scope: record.scope, lesson: record.lesson,
    });
  } catch { /* 留痕失败不影响判定生效 */ }

  if (patch.reopen_count >= 3) {
    try {
      appendEvent(tid, {
        actor: "system", kind: "notice", channel: "main",
        text: `该议题已重议 ${patch.reopen_count} 次：不再自动重议。要么由决策人显式批准，要么转为长期观察项定期回填、不再开场。`,
      });
    } catch {}
  }
  return { ok: true, verdict, scope: record.scope, next, review_at: nextReviewAt, reopen_count: patch.reopen_count };
}

/** 重议开场时要注入的上下文，供 orchestrator / 前端复用。 */
export function reopenBrief(tid) {
  const meta = getMeta(tid);
  if (!meta || !meta.review) return "";
  const r = meta.review;
  const last = (Array.isArray(r.results) ? r.results : []).slice(-1)[0] || {};
  const lines = [
    `【本场是重议（${last.scope || "R2"} 档）· 不要从零开始】`,
    r.verdict_text ? `上一版结论：${r.verdict_text}` : "",
    last.verdict ? `回看判定：${last.verdict}${last.actual_vs_expected ? `（实际：${last.actual_vs_expected}）` : ""}${last.gap_reason ? `；偏差原因：${last.gap_reason}` : ""}` : "",
    Array.isArray(r.facts) && r.facts.length ? `已定事实（可继承，除 R3 档外不必重验）：\n${r.facts.map((f) => `- ${f}`).join("\n")}` : "",
    Array.isArray(r.disagreements) && r.disagreements.length ? `上次未决分歧：\n${r.disagreements.map((d) => `- ${typeof d === "string" ? d : (d.point || JSON.stringify(d))}`).join("\n")}` : "",
    last.lesson ? `上次踩的坑：${last.lesson}` : "",
    `本次重议只处理被推翻的那一层，且开场焦点必须自带判定标准。`,
  ].filter(Boolean);
  return lines.join("\n");
}
