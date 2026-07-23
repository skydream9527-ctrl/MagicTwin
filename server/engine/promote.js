// 记忆晋升：将 LEARNINGS.md 中的经验条目晋升到 agent.md 核心手册。
// 人工审阅后调用，不自动执行。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { getRosterEntry } from "../domain/roster.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function readLearnings(agentKey) {
  const a = getRosterEntry(agentKey);
  if (!a) return [];
  const fp = join(ROOT, a.space, "memory", "LEARNINGS.md");
  if (!existsSync(fp)) return [];
  const content = readFileSync(fp, "utf8");
  const lines = content.split("\n").filter(l => /^[-\d]/.test(l.trim()));
  return lines.map((l, i) => ({ index: i, text: l.replace(/^[-\d.]+\s*/, "").trim() }));
}

export function promoteToAgentMd(agentKey, entryIndices) {
  const a = getRosterEntry(agentKey);
  if (!a) throw new Error("Agent 不存在");

  const learnings = readLearnings(agentKey);
  const toPromote = entryIndices.map(i => learnings[i]).filter(Boolean);
  if (toPromote.length === 0) throw new Error("无有效条目可晋升");

  const agentMdPath = join(ROOT, a.space, "agent.md");
  let md = existsSync(agentMdPath) ? readFileSync(agentMdPath, "utf8") : `# ${a.name}\n`;

  const SECTION_HEADER = "\n\n## 从经验中沉淀的规则（自动晋升）\n\n";
  if (!md.includes("从经验中沉淀的规则")) {
    md += SECTION_HEADER;
  }

  const newEntries = toPromote.map(e => `- ${e.text}`).join("\n");
  md += newEntries + "\n";
  writeFileSync(agentMdPath, md);

  const learningsFp = join(ROOT, a.space, "memory", "LEARNINGS.md");
  if (existsSync(learningsFp)) {
    const content = readFileSync(learningsFp, "utf8");
    const lines = content.split("\n");
    const promoted = new Set(toPromote.map(e => e.text));
    const remaining = lines.filter(l => !promoted.has(l.replace(/^[-\d.]+\s*/, "").trim()));
    writeFileSync(learningsFp, remaining.join("\n"));
  }

  return { promoted: toPromote.length, entries: toPromote.map(e => e.text) };
}
