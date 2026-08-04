// 技能运行时（C1）：扫描 workspace/skills/*/SKILL.md，解析 frontmatter，建索引；
// 供 read_skill 工具按需读取，供 prompt 注入「可用技能索引」。零依赖（不引 YAML 库）。
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname, sep } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS_DIR = join(ROOT, "workspace", "skills");

// —— 极简 frontmatter 解析（零依赖）——
// 支持：--- ... --- 块内 `key: value`、多行 `- item` 列表、内联 `[a, b]`。够解析 SKILL.md 头部。
function unquote(s) { return String(s).replace(/^['"]|['"]$/g, "").trim(); }

function parseFrontmatter(text) {
  const m = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(\r?\n|$)/);
  if (!m) return { data: {}, body: text };
  const data = {};
  let curKey = null;
  for (const rawLine of m[1].split(/\r?\n/)) {
    if (!rawLine.trim() || /^\s*#/.test(rawLine)) continue;
    const li = rawLine.match(/^\s*-\s+(.*)$/);
    if (li && curKey) {
      if (!Array.isArray(data[curKey])) data[curKey] = [];
      data[curKey].push(unquote(li[1]));
      continue;
    }
    const kv = rawLine.match(/^([A-Za-z0-9_\-]+)\s*:\s*(.*)$/);
    if (kv) {
      const key = kv[1];
      const val = kv[2].trim();
      if (val === "") { data[key] = []; curKey = key; }
      else if (val.startsWith("[") && val.endsWith("]")) {
        data[key] = val.slice(1, -1).split(",").map((s) => unquote(s.trim())).filter(Boolean);
        curKey = null;
      } else { data[key] = unquote(val); curKey = null; }
    }
  }
  return { data, body: text.slice(m[0].length) };
}

// INTRO.zh.md 首个非空/非标题行，作为无 frontmatter description 时的兜底简介。
function introFallback(dir) {
  try {
    const t = readFileSync(join(dir, "INTRO.zh.md"), "utf8");
    for (const line of t.split(/\r?\n/)) {
      const s = line.trim();
      if (s && !s.startsWith("#") && !s.startsWith("---")) return s.slice(0, 120);
    }
  } catch {}
  return "";
}

// —— 扫描并缓存索引（skill 静态，启动后缓存；新增 skill 需重启或 listSkills(true)）——
let _cache = null;
export function listSkills(force = false) {
  if (_cache && !force) return _cache;
  const out = [];
  let dirs = [];
  try { dirs = readdirSync(SKILLS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { dirs = []; }
  for (const d of dirs) {
    const dir = join(SKILLS_DIR, d.name);
    const skillMd = join(dir, "SKILL.md");
    if (!existsSync(skillMd)) continue;
    let fm = {};
    try { fm = parseFrontmatter(readFileSync(skillMd, "utf8")).data; } catch {}
    const triggers = Array.isArray(fm.triggers) ? fm.triggers
      : (Array.isArray(fm.when_to_use) ? fm.when_to_use
        : (fm.triggers ? [fm.triggers] : []));
    out.push({
      id: d.name,
      name: fm.name || d.name,
      description: fm.description || fm.desc || introFallback(dir),
      triggers,
      dir,
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  _cache = out;
  return out;
}

export function hasSkill(id) {
  return listSkills().some((s) => s.id === id);
}

// 注入 prompt 的「可用技能索引」：id + 一句话 + 触发词（精简，不含全文）。
//
// 预算内降级策略（重要）：技能变多后索引会超出上下文预算。此时**绝不能整条丢掉某个技能** ——
// id 是 `read_skill` 的唯一入口，一个技能从索引里消失就等于 Agent 完全不知道它存在。
// 所以按「先砍触发词 → 再压缩描述 → 最后只留 id」三档降级，保证全部 id 始终在列。
const INDEX_HEAD = `# 可用技能索引（先判断是否命中，再用 read_skill 读取全文）

用法：输出 { "type":"read_skill", "skill_id":"<id>" }；需要参考资料再加 "path":"references/xxx.md"。

`;

/**
 * @param {object} [opts]
 *   maxChars  索引文本的字符上限（0/未给 = 不限制）
 */
export function skillIndexText(opts = {}) {
  const skills = listSkills();
  if (!skills.length) return "";
  const budget = Number(opts.maxChars) || 0;

  // level 0：完整（描述 + 触发词）；1：只留描述；2：描述截到 40 字；3：只留 id
  const render = (level) => {
    const lines = skills.map((s) => {
      const fallbackName = s.name && s.name !== s.id ? s.name : "";
      let desc = s.description || fallbackName;
      if (level >= 3) desc = "";
      else if (level === 2 && desc.length > 40) desc = desc.slice(0, 40) + "…";
      const trig = level === 0 ? (s.triggers || []).slice(0, 6).join(" / ") : "";
      return `- \`${s.id}\`${desc ? `：${desc}` : ""}${trig ? `（触发：${trig}）` : ""}`;
    });
    return INDEX_HEAD + lines.join("\n");
  };

  for (let level = 0; level <= 3; level++) {
    const text = render(level);
    if (!budget || text.length <= budget) return text;
  }
  // 连「只留 id」都超预算：宁可超出也保住完整 id 列表，不做截断（截断会切出半个 id，反而误导）
  return render(3);
}

// —— 读取某技能的 SKILL.md 或其目录下参考资料（带路径穿越防护）——
const READABLE = new Set([".md", ".yaml", ".yml", ".json", ".txt", ".sql", ".csv"]);
const MAX_READ = 200 * 1024;

export function readSkill(id, subpath) {
  const safeId = String(id || "").trim();
  if (!safeId || safeId.includes("/") || safeId.includes("\\") || safeId.includes("..")) {
    return { ok: false, code: "SKILL_NOT_FOUND" };
  }
  const base = join(SKILLS_DIR, safeId);
  if (!existsSync(base) || !statSync(base).isDirectory()) return { ok: false, code: "SKILL_NOT_FOUND" };

  const rel = subpath ? String(subpath).replace(/^[\\/]+/, "") : "SKILL.md";
  const abs = normalize(join(base, rel));
  const baseNorm = normalize(base);
  if (abs !== baseNorm && !abs.startsWith(baseNorm + sep)) return { ok: false, code: "SKILL_PATH_DENIED" };
  if (!existsSync(abs) || !statSync(abs).isFile()) return { ok: false, code: "SKILL_FILE_NOT_FOUND" };
  if (!READABLE.has(extname(abs).toLowerCase())) return { ok: false, code: "SKILL_FILE_NOT_READABLE" };

  try {
    let content = readFileSync(abs, "utf8");
    let truncated = false;
    if (content.length > MAX_READ) { content = content.slice(0, MAX_READ) + "\n…[截断]"; truncated = true; }
    return { ok: true, id: safeId, path: rel, content, truncated };
  } catch { return { ok: false, code: "SKILL_READ_ERROR" }; }
}
