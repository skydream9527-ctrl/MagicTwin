// 模型下拉列表精简：网关上有大量可调模型，整张表铺给用户没法选。
// 规则（对齐前端按供应商分组的下拉）：
//   1. 每个供应商最多保留 3 个模型
//   2. 供应商自家的模型优先，转售别家的模型只在自家模型不够 3 个时补位
//   3. 其余按版本从新到旧；同版本优先基础款、优先不带日期戳的规范名
// 另外三类冗余直接丢弃：
//   - 同版本同档位的别名 / 日期快照
//   - 负载均衡副本
//   - 本项目用不上的非文本模型（语音 / 视觉 / 向量）
import { RECOMMENDED_MODELS } from "../config.js";

// 各供应商的自家产品线（按解析出的产品线首词匹配）。
const FIRST_PARTY = {
  azure_openai: ["gpt", "o"],
  baidu_qianfan: ["ernie"],
  deepseek: ["deepseek"],
  minimax: ["minimax", "abab"],
  moonshot: ["kimi"],
  streamlake: ["kwaipilot", "kwai"],
  tencent: ["hunyuan"],
  tongyi: ["qwen", "qwq", "qvq", "farui", "tongyi"],
  vertex_ai: ["gemini", "gemma"],
  volcengine_maas: ["doubao", "seed"],
  xiaomi: ["mimo", "milm", "midashenglm"],
  zhipuai: ["glm", "chatglm", "autoglm"],
};

// 命名规则跟不上产品迭代的老产品线：显式降权
const LEGACY_FAMILIES = new Set(["abab"]);

// 非对话模型标记：命中即从候选里剔除（本项目所有 Agent 都是文本 + JSON 协议）
const NON_CHAT_PATTERNS = [
  /asr/, /tts/, /ocr/, /voice/, /audio/, /transcribe/, /speech/,
  /vision/, /(^|[-/.])vl([-/.]|$)/, /image/, /video/,
  /embedding/, /rerank/, /computer-use/,
];

// 发布阶段 / 无区分度的词：不参与产品线与版本身份
const STAGE_WORDS = new Set(["preview", "latest", "exp", "pt", "chat"]);

// 规格 / 量化标记：属于同一产品线下的规格差异，不单独成产品线
const isSizeToken = (t) => /^a?\d+(\.\d+)?[bk]$/.test(t) || /^(int4|int8|fp8|bf16|awq|gptq|gp)$/.test(t);

// 把 2026-02-15 / 10-2025 这类被短横拆开的日期先合成单个 token，避免被当成版本号
function normalizeDates(name) {
  return name
    .replace(/(20\d{2})-(\d{2})-(\d{2})/g, "$1$2$3")
    .replace(/(\d{2})-(20\d{2})/g, "$2$1");
}

/**
 * 解析模型 id。
 * @returns {{id, provider, family, series, variantKey, version, date, replica, firstParty, legacy, nonChat}}
 */
export function parseModelId(id) {
  const segs = String(id).split("/");
  const name = segs.pop() || "";
  const prefix = segs.join("/");
  const provider = segs[0] || "";
  const raw = name.toLowerCase();
  const nonChat = NON_CHAT_PATTERNS.some((re) => re.test(raw));
  const tokens = normalizeDates(raw).split("-").filter(Boolean);

  const familyWords = [];
  const variants = [];
  const version = [];
  let date = 0;
  let replica = 0;
  let lastWasVersion = false;
  let lastVersionDotted = false;

  const addWord = (w) => { (version.length ? variants : familyWords).push(w); };

  tokens.forEach((tok, i) => {
    const isLast = i === tokens.length - 1;

    if (/^\d{4}$/.test(tok) || /^\d{6}$/.test(tok) || /^\d{8}$/.test(tok)) {
      date = Math.max(date, Number(tok));
      lastWasVersion = false;
      return;
    }

    if (/^\d{1,2}$/.test(tok)) {
      const continuesVersion = !version.length || (lastWasVersion && !lastVersionDotted);
      if (continuesVersion) {
        version.push(Number(tok));
        lastWasVersion = true;
        lastVersionDotted = false;
      } else if (isLast) {
        replica = Number(tok);
        lastWasVersion = false;
      } else {
        variants.push(tok);
        lastWasVersion = false;
      }
      return;
    }

    if (isSizeToken(tok)) { addWord(tok); lastWasVersion = false; return; }

    const m = tok.match(/^([a-z.]*?)(\d+(?:\.\d+)*)([a-z]*)$/);
    if (m) {
      const [, head, nums, tail] = m;
      if (head && head !== "v") addWord(head);
      if (tail) variants.push(tail);
      let parts = nums.split(".").map(Number);
      if (parts.length === 1 && head && parts[0] >= 10 && parts[0] <= 99) {
        parts = String(parts[0]).split("").map(Number);
      }
      for (const n of parts) version.push(n);
      lastWasVersion = true;
      lastVersionDotted = nums.includes(".") || parts.length > 1;
      return;
    }

    lastWasVersion = false;
    if (STAGE_WORDS.has(tok)) return;
    addWord(tok);
  });

  const family = familyWords[0] || "";
  return {
    id,
    provider,
    family,
    series: `${prefix}|${familyWords.join("-")}`,
    variantKey: variants.join("-"),
    version,
    date,
    replica,
    firstParty: (FIRST_PARTY[provider] || []).includes(family),
    legacy: LEGACY_FAMILIES.has(family),
    nonChat,
  };
}

function cmpVersionDesc(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = (b[i] ?? -1) - (a[i] ?? -1);
    if (diff) return diff;
  }
  return 0;
}

const flag = (v) => (v ? 1 : 0);

function byPriority(a, b) {
  const variantCount = (info) => (info.variantKey ? info.variantKey.split("-").length : 0);
  return (flag(b.firstParty) - flag(a.firstParty))
    || (flag(a.legacy) - flag(b.legacy))
    || cmpVersionDesc(a.version, b.version)
    || (variantCount(a) - variantCount(b))
    || (flag(a.date) - flag(b.date))
    || (b.date - a.date)
    || (a.replica - b.replica)
    || a.id.localeCompare(b.id);
}

/**
 * 每个供应商只保留 keepPerProvider 个模型（自家模型优先，其余按版本从新到旧）。
 * @param {string[]} ids               网关返回的全部模型 id
 * @param {object}   [opts]
 * @param {number}   [opts.keepPerProvider=3]
 * @param {string[]} [opts.pinned]     必须保留的模型
 * @returns {string[]} 精简后的模型 id
 */
export function slimModelList(ids, opts = {}) {
  const keepPerProvider = Number.isFinite(opts.keepPerProvider) ? opts.keepPerProvider : 3;
  const available = new Set(ids || []);
  const pinned = new Set((opts.pinned || []).filter((m) => available.has(m)));

  const byProvider = new Map();
  for (const id of available) {
    const info = parseModelId(id);
    if (info.nonChat && !pinned.has(id)) continue;
    if (!byProvider.has(info.provider)) byProvider.set(info.provider, []);
    byProvider.get(info.provider).push(info);
  }

  const kept = new Set();
  for (const list of byProvider.values()) {
    list.sort(byPriority);
    const seen = new Set();
    let count = 0;

    const dedupeKey = (info) => `${info.series}@${info.version.join(".")}@${info.variantKey}`;
    const take = (info) => { seen.add(dedupeKey(info)); kept.add(info.id); count++; };

    for (const info of list) if (pinned.has(info.id) && !seen.has(dedupeKey(info))) take(info);
    for (const info of list) {
      if (count >= keepPerProvider) break;
      if (seen.has(dedupeKey(info))) continue;
      take(info);
    }
  }

  for (const id of pinned) kept.add(id);
  return [...kept].sort((a, b) => a.localeCompare(b));
}

/** 供 /api/models 使用：精简网关清单，并保证推荐模型与各 Agent 已选模型不被裁掉。 */
export function buildModelChoices(ids, configuredModels = []) {
  return slimModelList(ids, { pinned: [...RECOMMENDED_MODELS, ...configuredModels] });
}
