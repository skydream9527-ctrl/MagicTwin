// 技能运行时（C1）：扫描 workspace/skills/*/SKILL.md，解析 frontmatter，建索引；
// 供 read_skill 工具按需读取，供 prompt 注入「可用技能索引」。零依赖（不引 YAML 库）。
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname, sep } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS_DIR = join(ROOT, "workspace", "skills");

// —— 极简 frontmatter 解析（零依赖）——
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
export function skillIndexText() {
  const skills = listSkills();
  if (!skills.length) return "";
  const lines = skills.map((s) => {
    const trig = (s.triggers || []).slice(0, 6).join(" / ");
    const desc = s.description ? `：${s.description}` : (s.name && s.name !== s.id ? `：${s.name}` : "");
    return `- \`${s.id}\`${desc}${trig ? `（触发：${trig}）` : ""}`;
  });
  return `# 可用技能索引（先判断是否命中，再用 read_skill 读取全文）

用法：输出 { "type":"read_skill", "skill_id":"<id>" }；需要参考资料再加 "path":"references/xxx.md"。

${lines.join("\n")}`;
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
