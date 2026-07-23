import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKSPACE = join(ROOT, "workspace");
const SHARED_EXP = join(WORKSPACE, "shared", "experience");

function userCasesDir(uid) { return join(WORKSPACE, "users", uid, "twin", "knowledge", "cases"); }
function candidatesDir(uid) { return join(userCasesDir(uid), "_candidates"); }
function ensureDir(d) { mkdirSync(d, { recursive: true }); }

export function create(uid, spec) {
  const dir = userCasesDir(uid);
  ensureDir(dir);

  const slug = slugify(spec.scene || "untitled");
  const ts = new Date().toISOString().split("T")[0];
  const name = `${slug}-${Date.now().toString(36)}.md`;
  const path = join(dir, name);

  const content = buildMarkdown(spec);
  writeFileSync(path, content);
  return path;
}

export function promote(uid, candidateId) {
  try {
    const candPath = join(candidatesDir(uid), candidateId.endsWith(".json") ? candidateId : `${candidateId}.json`);
    if (!existsSync(candPath)) return null;

    const data = JSON.parse(readFileSync(candPath, "utf8"));
    const path = create(uid, data);

    const newPath = candPath.replace(".json", ".promoted.json");
    writeFileSync(newPath, readFileSync(candPath));

    return path;
  } catch { return null; }
}

export function createCandidate(uid, reflectOutput) {
  const dir = candidatesDir(uid);
  ensureDir(dir);

  const ts = new Date().toISOString().split("T")[0];
  const name = `${reflectOutput.tid || Date.now().toString(36).slice(0, 6)}_reflect.json`;
  const path = join(dir, name);

  const output = {
    ...reflectOutput,
    created_at: ts,
    level: "L1",
  };
  writeFileSync(path, JSON.stringify(output, null, 2));
  return path;
}

export function get(uid, id) {
  const dir = userCasesDir(uid);
  if (existsSync(dir)) {
    const f = findFile(dir, id);
    if (f) return { path: join(dir, f), level: "L2", content: readFileSync(join(dir, f), "utf8") };
  }

  const cand = candidatesDir(uid);
  if (existsSync(cand)) {
    const f = findFile(cand, id);
    if (f) return { path: join(cand, f), level: "L1", content: JSON.parse(readFileSync(join(cand, f), "utf8")) };
  }

  return null;
}

export function list(uid) {
  const results = [];
  const dir = userCasesDir(uid);

  if (existsSync(dir)) {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith(".") || entry === "_candidates") continue;
      const full = join(dir, entry);
      if (extname(entry) === ".md") {
        results.push({
          id: basename(entry, ".md"),
          scene: extractScene(full),
          tags: extractTags(full),
          level: "L2",
          path: full,
        });
      }
    }
  }

  return results.sort((a, b) => (b.id || "").localeCompare(a.id || ""));
}

export function listCandidates(uid) {
  const results = [];
  const dir = candidatesDir(uid);
  if (!existsSync(dir)) return results;

  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json") || entry.includes(".promoted")) continue;
    try {
      const data = JSON.parse(readFileSync(join(dir, entry), "utf8"));
      results.push({ id: basename(entry, ".json"), scene: data.scene, confidence: data.confidence, level: "L1", path: join(dir, entry) });
    } catch {}
  }

  return results.sort((a, b) => b.id.localeCompare(a.id));
}

export function search(uid, sceneKeywords, topK = 3) {
  const allCases = [];

  const l2Dir = userCasesDir(uid);
  if (existsSync(l2Dir)) {
    for (const entry of readdirSync(l2Dir)) {
      if (!entry.endsWith(".md")) continue;
      const path = join(l2Dir, entry);
      allCases.push({ source: "L2", path, ...parseExp(path) });
    }
  }

  if (existsSync(SHARED_EXP)) {
    for (const entry of readdirSync(SHARED_EXP)) {
      if (!entry.endsWith(".md")) continue;
      const path = join(SHARED_EXP, entry);
      allCases.push({ source: "L3", path, ...parseExp(path) });
    }
  }

  if (!allCases.length) return [];

  return rankAndSlice(allCases, sceneKeywords, topK);
}

export function update(uid, id, spec) {
  const dir = userCasesDir(uid);
  if (!existsSync(dir)) return false;

  const f = findFile(dir, id);
  if (!f) return false;

  const content = buildMarkdown(spec);
  writeFileSync(join(dir, f), content);
  return true;
}

export function remove(uid, id) {
  const dir = userCasesDir(uid);
  if (!existsSync(dir)) return false;

  const f = findFile(dir, id);
  if (!f) return false;

  try { writeFileSync(join(dir, f.replace(".md", ".deleted.md")), readFileSync(join(dir, f))); } catch {}
  return true;
}

export function countL2(uid) {
  return list(uid).length;
}

export function countL3() {
  if (!existsSync(SHARED_EXP)) return 0;
  return readdirSync(SHARED_EXP).filter(f => f.endsWith(".md")).length;
}

function buildMarkdown(spec) {
  const parts = [];
  parts.push(`# 场景\n${spec.scene || "未命名场景"}`);
  if (spec.key_decisions) {
    const d = Array.isArray(spec.key_decisions) ? spec.key_decisions : [spec.key_decisions];
    parts.push(`\n## 关键决策\n${d.map(x => `- ${x}`).join("\n")}`);
  }
  if (spec.approach) parts.push(`\n## 正确做法\n${spec.approach}`);
  if (spec.pitfalls) {
    const p = Array.isArray(spec.pitfalls) ? spec.pitfalls : [spec.pitfalls];
    parts.push(`\n## 坑点\n${p.map(x => `- ${x}`).join("\n")}`);
  }
  if (spec.sql_templates) {
    const s = Array.isArray(spec.sql_templates) ? spec.sql_templates : [spec.sql_templates];
    parts.push(`\n## SQL模板\n${s.map(x => `- ${x}`).join("\n")}`);
  }
  if (spec.tags) {
    const t = Array.isArray(spec.tags) ? spec.tags : [spec.tags];
    parts.push(`\n## 标签\n${t.map(x => x.startsWith("#") ? x : `#${x}`).join(" ")}`);
  }
  return parts.join("\n") + "\n";
}

function parseExp(path) {
  try {
    const md = readFileSync(path, "utf8");
    return {
      scene: extractSceneFromMd(md),
      key_decisions: extractField(md, "关键决策"),
      approach: extractField(md, "正确做法"),
      pitfalls: extractField(md, "坑点"),
      sql_templates: extractField(md, "SQL模板"),
      tags: extractTagsFromMd(md),
    };
  } catch {
    return { scene: "", key_decisions: "", approach: "", pitfalls: "", sql_templates: "", tags: [] };
  }
}

function extractScene(path) {
  try {
    const md = readFileSync(path, "utf8");
    return extractSceneFromMd(md);
  } catch { return ""; }
}

function extractSceneFromMd(md) {
  const m = md.match(/^# 场景\n(.+)/m);
  return m ? m[1].trim() : "";
}

function extractTags(path) { try { return extractTagsFromMd(readFileSync(path, "utf8")); } catch { return []; } }

function extractTagsFromMd(md) {
  const m = md.match(/^## 标签\n(.+)/m);
  if (!m) return [];
  const text = m[1].trim();
  return text.split(/\s+/).filter(t => t.startsWith("#")).map(t => t.replace(/^#+/, ""));
}

function extractField(md, fieldName) {
  const regex = new RegExp(`^## ${fieldName}\\n([\\s\\S]*?)(?=^## |$)`, "m");
  const m = md.match(regex);
  return m ? m[1].trim() : "";
}

const SOURCE_WEIGHT = { L2: 1.5, L3: 1.0 };
const FIELD_WEIGHTS = { tag: 3, scene: 2, body: 1 };

function rankAndSlice(cases, keywords, topK) {
  if (!keywords || !keywords.length) return [];

  const lowerKeywords = keywords.map(k => k.toLowerCase());

  return cases
    .map(c => {
      const tags = (c.tags || []).map(t => t.toLowerCase());
      const scene = (c.scene || "").toLowerCase();
      const body = [
        c.key_decisions || "",
        c.approach || "",
        c.pitfalls || "",
        c.sql_templates || "",
      ].join(" ").toLowerCase();

      let tagHits = 0, sceneHits = 0, bodyHits = 0;
      for (const kw of lowerKeywords) {
        if (tags.some(t => t.includes(kw) || kw.includes(t))) tagHits++;
        if (scene.includes(kw)) sceneHits++;
        if (body.includes(kw)) bodyHits++;
      }

      const rawScore = tagHits * FIELD_WEIGHTS.tag + sceneHits * FIELD_WEIGHTS.scene + bodyHits * FIELD_WEIGHTS.body;
      const sourceMultiplier = SOURCE_WEIGHT[c.source] || 1.0;
      const score = rawScore * sourceMultiplier;

      return { ...c, score };
    })
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function slugify(text) {
  return text
    .replace(/[^\w\u4e00-\u9fff]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 40) || "exp";
}

function findFile(dir, id) {
  if (!existsSync(dir)) return null;
  for (const entry of readdirSync(dir)) {
    if (entry === id || entry === `${id}.md` || basename(entry, ".md") === id) {
      return entry;
    }
  }
  return null;
}
