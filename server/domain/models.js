// 模型下拉列表精简：大模型网关通常返回上百个模型，整张表铺给用户没法选。
// 规则（对齐前端按供应商分组的下拉）：
//   1. 每个供应商最多保留 3 个模型
//   2. 供应商自家的模型优先（OpenAI → gpt/o、Anthropic → claude、智谱 → glm、月之暗面 → kimi、字节 → doubao…），
//      转售别家的模型只在自家模型不够 3 个时补位
//   3. 其余按版本从新到旧；同版本优先基础款、优先不带日期戳的规范名
// 另外三类冗余直接丢弃：
//   - 同版本同档位的别名 / 日期快照（claude-haiku-4-5 与 claude-haiku-4-5-20251001）
//   - 负载均衡副本（gpt-5.2-codex-1 … -9）
//   - 本项目用不上的非文本模型（语音 / 视觉 / 向量）
// 版本号支持点号（gpt-5.2、kimi-k2.6）、短横（claude-opus-4-8、doubao-seed-2-1）与日期戳（-260628）。
// 网关的 /v1/models 只给 id / owned_by / model_type，没有发布时间，所以"最新"只能从命名推断。
import { RECOMMENDED_MODELS } from "../config.js";

// 各供应商的自家产品线（按解析出的产品线首词匹配）。
// 可根据你使用的网关供应商扩展
const FIRST_PARTY = {
  anthropic: ["claude"],
  azure_openai: ["gpt", "o"],
  baidu_qianfan: ["ernie"],
  deepseek: ["deepseek"],
  google: ["gemini", "gemma"],
  minimax: ["minimax", "abab"],
  moonshot: ["kimi"],
  openai: ["gpt", "o"],
  tencent: ["hunyuan"],
  tongyi: ["qwen", "qwq", "qvq", "tongyi"],
  vertex_ai: ["gemini", "gemma"],
  volcengine: ["doubao", "seed"],
  volcengine_maas: ["doubao", "seed"],
  zhipuai: ["glm", "chatglm", "autoglm"],
};

// 命名规则跟不上产品迭代的老产品线：版本数字比新线还大（abab6.5 vs MiniMax-M3），显式降权
const LEGACY_FAMILIES = new Set(["abab"]);

// 非对话模型标记：命中即从候选里剔除（本项目所有 Agent 都是文本 + JSON 协议）
const NON_CHAT_PATTERNS = [
  /asr/, /tts/, /ocr/, /voice/, /audio/, /transcribe/, /speech/,
  /vision/, /(^|[-/.])vl([-/.]|$)/, /image/, /video/,
  /embedding/, /rerank/, /computer-use/,
];

// 发布阶段 / 无区分度的词：不参与产品线与版本身份（gemini-3.1-pro-preview 与 gemini-2.5-pro 同产品线）
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
 *   provider   供应商（id 的第一段，与前端 optgroup 分组口径一致）
 *   family     产品线首词（mimo / glm / qwen / claude…），用于判断是否供应商自家模型
 *   series     供应商前缀 + 完整产品线名，用于识别同产品线的别名
 *   variantKey 版本号之后的档位词（pro、mini、codex、32b…）
 */
export function parseModelId(id) {
  const segs = String(id).split("/");
  const name = segs.pop() || "";
  const prefix = segs.join("/");
  const provider = segs[0] || "";
  const raw = name.toLowerCase();
  const nonChat = NON_CHAT_PATTERNS.some((re) => re.test(raw));
  const tokens = normalizeDates(raw).split("-").filter(Boolean);

  const familyWords = [];  // 首个版本号之前的词 → 产品线
  const variants = [];     // 版本号之后的词 → 档位
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

    // 裸整数：紧跟在短横版本号后面的算版本段（claude-opus-4-8）；
    // 点号版本号后面、或中间隔了词的结尾数字算副本序号（gpt-5.2-2、gpt-5-codex-3）
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
      if (head && head !== "v") addWord(head);   // deepseek-r1 → 产品线 deepseek；qwen3.5 → qwen
      if (tail) variants.push(tail);             // gpt-4o → 档位 o；glm-4.5v → 档位 v
      let parts = nums.split(".").map(Number);
      // qwen25-coder 这类省略点号的写法：两位整数按 主.次 读，避免被当成 v25
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

// 供应商内排序：自家模型优先 → 老产品线靠后 → 版本号新的优先
//            → 档位少的基础款优先 → 不带日期戳的规范名优先 → 非副本优先
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
 * @param {string[]} [opts.pinned]     必须保留的模型（推荐模型、默认模型、各 Agent 已保存的选择）
 * @returns {string[]} 精简后的模型 id（字典序，下拉里按供应商聚集）
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
    const seen = new Set();   // 同产品线 + 同版本 + 同档位视为同一个模型的别名 / 快照 / 副本
    let count = 0;

    const dedupeKey = (info) => `${info.series}@${info.version.join(".")}@${info.variantKey}`;
    const take = (info) => { seen.add(dedupeKey(info)); kept.add(info.id); count++; };

    // 已保存 / 推荐的模型先占名额，保证页面上的已选项不会消失
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
