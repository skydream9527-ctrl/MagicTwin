// 讨论标准的判定内核：把收敛标准里的规则做成可执行判定，不依赖LLM硬约束，避免空转/假收敛。
// 每个函数都标注对应规则号，改规则先改文档再改这里：
//   DC-08 焦点必须单一且自带判定标准        → validateFocus
//   DC-11/12/13/14 增量四类 · 证据分级 · 空轮 → classifyGain / classifyEvidence / isRestated
//   DC-15 三问续议闸门（主闸）              → decideNext
//   DC-16 分歧三分法（事实/口径/价值）       → classifyContention
//   DC-20 升级只问一个最小问题              → validateEscalate
//   DC-22/30 收口必带重启条件与回看时间      → normalizeCloseFields / defaultReviewAt
//   DC-37 打回三可（可判定/可执行/可验收）    → validateRework
//
// 设计约束：
//   - 纯函数、不碰文件系统、不抛异常。任何判不了的情况一律「放行 + 给 reason」，绝不让讨论卡死（降级不阻塞）。
//   - 判定结果都带 reason，由调用方（orchestrator）写进 discussion.jsonl，保证每次判定可回溯。
import { CONFIG } from "../config.js";

// ── 增量四类（DC-11）与证据分级（DC-12）────────────────────────
export const GAIN = { EVIDENCE: "E", ARGUMENT: "A", REBUT: "R", CONSTRAINT: "C", NONE: "0" };
const GAIN_LABEL = { E: "新证据", A: "新论点", R: "明确反对", C: "新约束", 0: "无增量" };
export const gainLabel = (g) => GAIN_LABEL[g] || "无增量";

const VALID_GAIN = new Set(["E", "A", "R", "C", "0"]);
const VALID_LEVEL = new Set(["A", "B", "C", "D"]);

// 文本归一化：去标点空白，只留中英数字，用于复述检测。
function norm(s) {
  return String(s || "").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}
// 二元组 Jaccard 相似度（够用且零依赖；用于识别「换词复述」反模式）。
function similarity(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const grams = (t) => { const s = new Set(); for (let i = 0; i < t.length - 1; i++) s.add(t.slice(i, i + 2)); return s; };
  const sa = grams(x), sb = grams(y);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const g of sa) if (sb.has(g)) inter++;
  return inter / (sa.size + sb.size - inter);
}
/** 是否是对既有发言的复述（DC-14 空轮判定的一部分）。prev 为此前发言文本数组。 */
export function isRestated(content, prev = [], threshold = 0.72) {
  return (prev || []).some((p) => similarity(content, p) >= threshold);
}

/** 证据分级（DC-12）。A=本场真实取数结果，B=有数字的可核验依据，C=推断，D=无依据。 */
export function classifyEvidence(action = {}, { hasQueried = false } = {}) {
  const explicit = String(action.evidence_level || "").toUpperCase();
  if (VALID_LEVEL.has(explicit)) return explicit;
  const ev = String(action.evidence || "").trim();
  if (!ev) return "D";
  const hasNumber = /\d/.test(ev);
  if (hasQueried && hasNumber) return "A";
  if (hasNumber) return "B";
  return "C";
}

/**
 * 判定一次发言的增量（DC-11/13/14）。
 * 优先采信模型自报的 gain，但复述一律压到 0——复述不可能带来新信息。
 * @returns {{gain:string, level:string, reason:string}}
 */
export function classifyGain(action = {}, { prevContents = [], hasQueried = false } = {}) {
  const level = classifyEvidence(action, { hasQueried });
  if (action.type === "pass") return { gain: GAIN.NONE, level: "D", reason: "pass：本轮无补充" };

  const content = String(action.content || action.message || "").trim();
  const evidence = String(action.evidence || "").trim();
  const stance = String(action.stance || "").toLowerCase();
  if (!content) return { gain: GAIN.NONE, level, reason: "空发言" };
  if (isRestated(content, prevContents)) return { gain: GAIN.NONE, level, reason: "与已有发言高度重复（复述不计增量）" };

  const selfReported = String(action.gain || "").toUpperCase();
  if (VALID_GAIN.has(selfReported)) {
    // 自报 E（新证据）但没给依据：降级为新论点，避免「口头断言当证据」
    if (selfReported === "E" && !evidence) return { gain: GAIN.ARGUMENT, level, reason: "自报新证据但未给依据，降级为新论点" };
    return { gain: selfReported, level, reason: `自报增量 ${gainLabel(selfReported)}` };
  }

  if (evidence) return { gain: GAIN.EVIDENCE, level, reason: "带可核验依据" };
  if (stance === "challenge") return { gain: GAIN.REBUT, level, reason: "指名反对并给出理由" };
  if (stance === "support") return { gain: GAIN.NONE, level, reason: "纯附议不计增量（计共识票）" };
  if (stance === "ask") return { gain: GAIN.NONE, level, reason: "追问未带判定标准，不计增量" };
  if (/口径|红线|禁止|必须|不可逆|预算|人力|期限/.test(content)) return { gain: GAIN.CONSTRAINT, level, reason: "引入硬约束" };
  return { gain: GAIN.ARGUMENT, level, reason: "视为新论点" };
}

// ── 分歧三分法（DC-16）────────────────────────────────────────
const CALIBER_HINT = /口径|时间窗|自然日|t-1|去重|分母|分子|统计方式|极值|单位|环比定义|同比定义|官方看板|对齐|定义不一致/i;
const VALUE_HINT = /优先级|要不要|该不该|值不值|做不做|资源|排期|人力|投入|取舍|风险偏好|先做|p0|p1|战略|方向/i;

/** 把一条分歧归类为 fact（查数）/ caliber（查规则）/ value（问决策人）。显式 kind 优先。 */
export function classifyContention(input = {}) {
  const explicit = String(input.kind || "").toLowerCase();
  if (["fact", "caliber", "value"].includes(explicit)) return explicit;
  const text = `${input.point || ""} ${input.content || ""} ${input.intent || ""}`;
  if (CALIBER_HINT.test(text)) return "caliber";
  if (VALUE_HINT.test(text)) return "value";
  return "fact";
}
const CONTENTION_ACTION = {
  fact: { decision: "ACT", how: "去查数裁决（query），不要再辩" },
  caliber: { decision: "ACT", how: "去查口径真相源裁决（官方口径 / 默认规则），不要再辩" },
  value: { decision: "ESCALATE", how: "升级决策人拍板，数据不可能裁决价值取舍" },
};
export const contentionHint = (kind) => CONTENTION_ACTION[kind] || CONTENTION_ACTION.fact;

// ── 三问续议闸门（DC-15，主闸）─────────────────────────────────
/**
 * 每轮末判定下一步。返回 { decision, reason, q1, q2, q3 }。
 * decision ∈ CONTINUE | CONVERGE | ESCALATE | ACT | CLOSE_FORCED | ABORT
 * @param {object} s 讨论状态快照
 *   s.round            已发生的发言轮数
 *   s.maxRounds        轮次上限
 *   s.budgetUsedRatio  0~1，步数 / token 预算用量
 *   s.emptyRounds      连续空轮数（DC-14）
 *   s.openContention   未决分歧数组，每项 {id, kind, point}
 *   s.sameFocusRounds  当前焦点已连续讨论几轮
 *   s.located          异常类议题是否已完成事实定位（DC-09）
 *   s.isAnomaly        是否异常/异动类议题
 *   s.redlineHit       是否命中红线 / 越权 / 依赖缺失
 */
export function decideNext(s = {}) {
  const cfg = CONFIG.discussion;
  const q1 = (s.openContention || []).length > 0;      // 还有未决分歧吗
  const q2 = (s.lastRoundGain || 0) > 0;               // 上一轮有增量吗
  const q3 = (s.budgetUsedRatio || 0) < 1 && (s.round || 0) < (s.maxRounds || 6); // 预算够再判一次吗
  const base = { q1, q2, q3 };

  if (s.redlineHit) return { decision: "ABORT", reason: "命中红线 / 越权 / 依赖缺失，无产出终止", ...base };
  if (!q3) return { decision: "CLOSE_FORCED", reason: `预算耗尽（轮次 ${s.round}/${s.maxRounds}），强制收口`, ...base };
  if (!q1) {
    // 「没有分歧」只有在所有参会人都发过言之后才成立——否则那只是「还没人说话」。
    const unheard = Math.max(0, Number(s.panelSize || 0) - Number(s.spokenCount || 0));
    if (unheard > 0) {
      return { decision: "CONTINUE", reason: `暂无人提出分歧，但还有 ${unheard} 位专家没发过言——全员未发言前不算「无分歧」`, unheard, ...base };
    }
    return { decision: "CONVERGE", reason: "全员已发言且无未决分歧，没有可议的了", ...base };
  }
  if (s.isAnomaly && !s.located) return { decision: "ACT", reason: "异动类议题事实未定位（范围/口径/链路/影响），先取数再辩", ...base };
  if ((s.emptyRounds || 0) >= cfg.stallLimit) return { decision: "CONVERGE", reason: `连续 ${s.emptyRounds} 轮空轮，判定僵局`, ...base };

  // 只对「尚未被处置过」的分歧转动作 / 升级：同一条分歧最多路由一次，避免反复叫人查同一个数。
  const top = (s.openContention || []).find((c) => c && !c.handled);
  if (top) {
    const contentionKind = classifyContention(top);
    const hint = contentionHint(contentionKind);
    if (contentionKind === "fact" || contentionKind === "caliber") {
      return { decision: hint.decision, reason: `首要分歧是${contentionKind === "fact" ? "事实" : "口径"}分歧：${hint.how}`, contentionKind, contentionId: top.id, ...base };
    }
    if (contentionKind === "value") {
      return { decision: "ESCALATE", reason: `首要分歧是价值分歧：${hint.how}`, contentionKind, contentionId: top.id, ...base };
    }
  }
  if ((s.sameFocusRounds || 0) >= cfg.sameFocusMax) {
    return { decision: "CONVERGE", reason: `同一焦点已连续 ${s.sameFocusRounds} 轮未判定，说明不可判，转收束`, ...base };
  }
  if ((s.budgetUsedRatio || 0) >= cfg.convergeAt) {
    return { decision: "CONVERGE", reason: `预算已到 ${Math.round((s.budgetUsedRatio || 0) * 100)}% 水位，留余量收口`, ...base };
  }
  return { decision: "CONTINUE", reason: "三问皆成立，可以再判一轮", ...base };
}

/** 把闸门结论翻译成给主持人的指令文本（由 orchestrator 注入其上下文）。 */
export function directiveFor(verdict, ctx = {}) {
  const focus = ctx.focus ? `当前焦点「${ctx.focus}」。` : "";
  switch (verdict.decision) {
    case "ACT":
      return `【判定：转动作，不再辩论】${verdict.reason}。${focus}请点名一位有查数能力的专家去取数（grant，prompt 里明确要查什么、按什么口径），或直接收口把这条列为待补数据。禁止让专家继续就此互辩。`;
    case "ESCALATE":
      return `【判定：升级决策人】${verdict.reason}。${focus}请立即 close 收口：结论里把这条分歧登记清楚（各方立场 + 为何未解决 + 需要谁拍板），next_steps 第一条写明「需决策人拍板 + 两个可选项及代价」。`;
    case "CONVERGE":
      return ctx.summarized
        ? `【判定：进入收束 · 已小结过】${verdict.reason}。你本轮已经做过小结，**不要再 summarize**，现在直接输出 close 收口（verdict + consensus + disagreements + next_steps + restart_condition + review_at + review_questions 一次写全）。`
        : `【判定：进入收束】${verdict.reason}。请先做一次阶段小结（summarize：已定事实 / 未决分歧 / 可否收口），紧接着下一步就输出 close 收口。不要再开新一轮点名，也不要连续小结两次。`;
    case "CLOSE_FORCED":
      return `【判定：强制收口】${verdict.reason}。请直接输出 close，把已有结论、未决分歧、下一步、重启条件与回看时间写全。`;
    case "ABORT":
      return `【判定：终止】${verdict.reason}。请输出 close，说明终止原因、已获得的部分结论与恢复条件。`;
    default: {
      const pending = Array.isArray(ctx.pending) && ctx.pending.length
        ? `本场还没发言的专家：${ctx.pending.join("、")}——请优先点名他们，别在同一个人身上来回。`
        : "优先点名可能有不同看法的人去回应上一位，而不是让大家轮流独白。";
      return `【判定：可以继续】${verdict.reason}。${focus}请点名下一位专家发言（grant，含 speaker + to + prompt + focus/criteria）。${pending}`;
    }
  }
}

// ── DC-08 焦点必须单一且自带判定标准 ────────────────────────────
/** 校验 grant / roundtable 里的焦点。返回 {ok, missing:[], hint}。 */
export function validateFocus(action = {}) {
  const focus = String(action.focus || "").trim();
  const criteria = String(action.criteria || action.focus_criteria || "").trim();
  const missing = [];
  if (!focus) missing.push("focus（本轮要判定的那一个问题）");
  if (criteria.length < 6) missing.push("criteria（判定标准：满足什么就算成立）");
  const questionMarks = (focus.match(/[？?]/g) || []).length;
  if (questionMarks > 1 || /(另外|同时还要|以及.*吗)/.test(focus)) missing.push("单焦点（发现多个问题：请拆开，一轮只判一个）");
  return {
    ok: missing.length === 0,
    missing,
    hint: missing.length ? `焦点不合格，缺：${missing.join("；")}。示例：focus="问题是否成立？" criteria="满足X条件则成立"。` : "",
  };
}

// ── DC-37 打回三可：可判定 / 可执行 / 可验收 ────────────────────
const CRITERIA_ID = /\b(pc|rt)_[a-z0-9_]+/i;
/** 校验 rework 动作。返回 {ok, missing:[], hint}。 */
export function validateRework(action = {}) {
  const ids = []
    .concat(action.criteria_ids || action.criteria_id || [])
    .flatMap((x) => String(x).split(/[,\s、]+/))
    .filter(Boolean);
  const msg = String(action.message || "").trim();
  const passLine = String(action.pass_line || action.acceptance || "").trim();
  const missing = [];
  if (!ids.some((id) => CRITERIA_ID.test(id)) && !CRITERIA_ID.test(msg)) {
    missing.push("criteria_ids（违反了验收清单哪一条）");
  }
  if (msg.length < 20) missing.push("要补什么（具体到维度 / 口径 / 时间窗）");
  if (!passLine && !/过关|算通过|标准是|补到/.test(msg)) missing.push("pass_line（补到什么程度算过关）");
  return {
    ok: missing.length === 0,
    missing,
    ids: ids.filter((id) => CRITERIA_ID.test(id)),
    hint: missing.length
      ? `打回不合格（DC-37 三可原则），缺：${missing.join("；")}。请重写：criteria_ids 引用验收标准，message 说清补什么，pass_line 说清过关线。无效打回不消耗打回额度，但必须重写。`
      : "",
  };
}

/** 打回额度用尽后的三选一指令（DC-36）。 */
export function reworkExhaustedHint(agentKey, agentName, count) {
  return `【打回额度已用尽（DC-36）】你已对「${agentName}」的这份交付物打回 ${count} 次，不允许再打回。两次未过通常说明任务定义、口径或能力匹配有问题，继续打回是在错误的层面上使劲。请在三条路里选一条并说明理由：
1) 接受带缺陷交付：直接交付，并在交付内容里显式写明缺陷、影响范围与适用边界；
2) 升级决策人：type="escalate"（target="user"），只问一个最小问题 + 给两个可选项及代价 + 说明你的默认建议；
3) 换人换法：type="assign" 换一个更合适的 Agent 或把任务拆小重派，message 说清为什么原路径走不通。
下一步只输出这三者之一。`;
}

// ── DC-20 升级只问一个最小问题 ─────────────────────────────────
/** 校验 escalate 动作。返回 {ok, missing:[], hint}。 */
export function validateEscalate(action = {}) {
  const msg = String(action.message || "").trim();
  const options = Array.isArray(action.options) ? action.options.filter((o) => String(o).trim()) : [];
  const missing = [];
  const questionMarks = (msg.match(/[？?]/g) || []).length;
  if (questionMarks > 1) missing.push("一次只问一个最小问题（发现多个问号：把非关键的自己代答或留到交付后再问）");
  if (options.length < 2) missing.push("options（至少两个可选项，含「不做」这一项）");
  if (!/建议|默认|倾向|推荐/.test(msg)) missing.push("默认建议（说明你倾向哪个、以及如果不回你会怎么走）");
  return {
    ok: missing.length === 0,
    missing,
    hint: missing.length
      ? `升级不合格（DC-20 升级纪律），缺：${missing.join("；")}。请重写：message 只问那个「不回答就无法继续」的问题，并写明你的默认建议；options 给 2 个以上选项及代价。`
      : "",
  };
}

// ── DC-22 / DC-30 收口必带重启条件与回看时间 ────────────────────
/** 本地时区的 YYYY-MM-DD。 */
function ymd(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 默认回看日期：今天 + days（本地时区，YYYY-MM-DD）。 */
export function defaultReviewAt(days = CONFIG.review.defaultDays, from = new Date()) {
  const d = new Date(from.getTime());
  d.setDate(d.getDate() + Math.max(1, Number(days) || 14));
  return ymd(d);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/**
 * 归一化收口的重启字段（DC-22 / DC-30 / DC-35）：缺失则补默认值并说明补了什么。
 * @returns {{review_at, review_questions, restart_condition, filled:string[]}}
 */
export function normalizeCloseFields(action = {}, { goal = "" } = {}) {
  const filled = [];
  let reviewAt = String(action.review_at || "").trim();
  const today = ymd(new Date());
  if (!DATE_RE.test(reviewAt)) { reviewAt = defaultReviewAt(); filled.push("review_at"); }
  else if (reviewAt <= today) { reviewAt = defaultReviewAt(); filled.push("review_at（原值不是将来的日期）"); }

  let questions = Array.isArray(action.review_questions)
    ? action.review_questions.map((q) => String(q).trim()).filter(Boolean)
    : String(action.review_questions || "").split(/[\n；;]+/).map((q) => q.trim()).filter(Boolean);
  if (!questions.length) {
    questions = [`结论是否仍然成立（对照当初的判定标准复核）？`, `next_steps 是否已按期完成？`];
    filled.push("review_questions");
  }

  let restart = String(action.restart_condition || "").trim();
  if (restart.length < 6) {
    restart = `出现新数据推翻已定事实 / 相关规则/口径变更 / 决策人提出新要求时重议；否则 ${reviewAt} 到期复核（判定人：决策人）`;
    filled.push("restart_condition");
  }
  return { review_at: reviewAt, review_questions: questions, restart_condition: restart, filled };
}

/** 收口字段缺失时给 Twin 的补写提示（先要求它自己补，反复缺失才自动兜底）。 */
export function closeFieldsHint(filled = []) {
  return `【收口产出物不完整（DC-22 / DC-30）】缺少：${filled.join("、")}。请重新输出同一个结论，并补上：
- restart_condition：什么条件满足后重议（触发条件 + 判定人 + 兜底回看时间）；
- review_at：回看日期（YYYY-MM-DD，运营级 1~2 周 / 战术级 2~4 周 / 依赖实验数据的按观测周期）；
- review_questions：到期要检查的具体问题，必须可判定（写「指标是否达标」而不是「看看效果」）。
其余字段保持不变，不要重新分析。`;
}

/** 把结构化下一步渲染成单行字符串（前端事件里只放字符串，结构化版本落日志）。 */
export function formatNextSteps(steps = []) {
  return normalizeNextSteps(steps).map((s) => `${s.action}（责任人：${s.owner} · 期限：${s.due} · 过关标准：${s.done_when}）`);
}

/** 把分歧登记渲染成单行字符串（DC-24 的可读形态）。 */
export function formatDisagreements(list = []) {
  const KIND_LABEL = { fact: "事实分歧→查数", caliber: "口径分歧→查规则", value: "价值分歧→问决策人" };
  return (Array.isArray(list) ? list : [list]).filter(Boolean).map((d) => {
    if (typeof d === "string") return d;
    const kind = classifyContention(d);
    const parts = [String(d.point || d.text || "").trim() || "（未写明分歧点）"];
    parts.push(`[${KIND_LABEL[kind] || kind}]`);
    if (d.why_open) parts.push(`未解决原因：${d.why_open}`);
    if (d.need_to_resolve) parts.push(`需要：${d.need_to_resolve}`);
    if (d.owner) parts.push(`待 ${d.owner} 处理`);
    return parts.join(" · ");
  });
}

/** 最小闭环校验（DC-22）：下一步要有责任人 / 期限 / 完成标准，缺的用 [待确认] 占位而非虚构。 */
export function normalizeNextSteps(steps = []) {
  const arr = Array.isArray(steps) ? steps : [String(steps || "")].filter(Boolean);
  return arr.map((raw) => {
    const s = typeof raw === "string" ? { action: raw } : { ...raw };
    const text = String(s.action || s.text || "").trim();
    const owner = String(s.owner || "").trim() || "[待确认]";
    const due = String(s.due || s.deadline || "").trim() || "[待确认]";
    const done = String(s.done_when || s.acceptance || "").trim() || "[待确认]";
    return { action: text, owner, due, done_when: done };
  }).filter((s) => s.action);
}
