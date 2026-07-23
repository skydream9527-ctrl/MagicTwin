import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKSPACE = join(ROOT, "workspace");

function userKnowledgeDir(uid) { return join(WORKSPACE, "users", uid, "twin", "knowledge"); }
function trustPath(uid) { return join(userKnowledgeDir(uid), "rules", "trust.json"); }
function riskYamlPath(uid) { return join(userKnowledgeDir(uid), "rules", "risk_matrix.yaml"); }

const DEFAULT_TRUST = {
  level: "L1",
  total_tasks: 0,
  total_decisions: 0,
  approved: 0,
  corrected: 0,
  approval_rate: 0,
  correction_rate: 0,
  by_type: {},
  consecutive_corrections: {},
  consecutive_clean: 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const LEVEL_ORDER = { L1: 1, L2: 2, L3: 3, L4: 4 };
const LEVEL_LABELS = { L1: "全程监工", L2: "审计模式", L3: "例外管理", L4: "全权委托" };

const UPGRADE_RULES = {
  L1_TO_L2: { tasks: 3, approval_rate: 0.80 },
  L2_TO_L3: { tasks: 10, approval_rate: 0.90, experience_packs: 3 },
  L3_TO_L4: { tasks: 30, approval_rate: 0.95, consecutive_clean: 10 },
};

const DEFAULT_TYPE_MIN_LEVEL = {
  caliber_selection: "L1",
  dimension_drilldown: "L2",
  time_range: "L1",
  table_selection: "L2",
  report_format: "L1",
};

export function getTrust(uid) {
  try {
    const path = trustPath(uid);
    if (existsSync(path)) {
      const data = JSON.parse(readFileSync(path, "utf8"));
      return { ...DEFAULT_TRUST, ...data };
    }
  } catch {}
  return { ...DEFAULT_TRUST };
}

export function saveTrust(uid, trust) {
  try {
    const dir = join(userKnowledgeDir(uid), "rules");
    if (!existsSync(dir)) {
      try { mkdirSync(dir, { recursive: true }); } catch {}
    }
    trust.updated_at = new Date().toISOString();
    writeFileSync(trustPath(uid), JSON.stringify(trust, null, 2));
    return trust;
  } catch { return trust; }
}

export function resetTrust(uid) {
  const trust = { ...DEFAULT_TRUST, created_at: new Date().toISOString() };
  return saveTrust(uid, trust);
}

export function shouldAutoAnswer(type, trust) {
  if (trust.by_type[type] && trust.by_type[type].escalate_only) return false;

  const minLevel = DEFAULT_TYPE_MIN_LEVEL[type] || "L2";
  const userLevel = LEVEL_ORDER[trust.level] || 1;
  const required = LEVEL_ORDER[minLevel] || 2;

  return userLevel >= required;
}

export function checkLevelUp(trust, experienceCount = 0) {
  const current = trust.level || "L1";

  if (current === "L1") {
    const rule = UPGRADE_RULES.L1_TO_L2;
    if (trust.total_tasks >= rule.tasks && trust.approval_rate >= rule.approval_rate) {
      return "L2";
    }
  }

  if (current === "L2") {
    const rule = UPGRADE_RULES.L2_TO_L3;
    if (trust.total_tasks >= rule.tasks && trust.approval_rate >= rule.approval_rate && (experienceCount || 0) >= rule.experience_packs) {
      return "L3";
    }
  }

  if (current === "L3") {
    const rule = UPGRADE_RULES.L3_TO_L4;
    if (trust.total_tasks >= rule.tasks && trust.approval_rate >= rule.approval_rate && trust.consecutive_clean >= rule.consecutive_clean) {
      return "L4";
    }
  }

  return null;
}

export function dashboard(uid, experienceCount = 0) {
  const trust = getTrust(uid);
  const result = {
    level: trust.level,
    label: LEVEL_LABELS[trust.level] || "未知",
    total_tasks: trust.total_tasks,
    total_decisions: trust.total_decisions,
    approved: trust.approved,
    corrected: trust.corrected,
    approval_rate: trust.approval_rate,
    correction_rate: trust.correction_rate,
    by_type: [],
    next_level: null,
    highest_performance: "——",
    needs_attention: "——",
  };

  const types = Object.entries(trust.by_type || {})
    .map(([type, info]) => ({
      type,
      total: info.total,
      approved: info.approved,
      corrected: info.corrected,
      rate: info.total ? info.approved / info.total : 0,
      escalate_only: info.escalate_only || false,
    }))
    .sort((a, b) => b.total - a.total);
  result.by_type = types;

  if (types.length) {
    const best = types.reduce((a, b) => (a.rate > b.rate ? a : b), types[0]);
    const worst = types.reduce((a, b) => (a.rate < b.rate ? a : b), types[0]);
    result.highest_performance = `${best.type} (${Math.round(best.rate * 100)}%认可率, ${best.total}次)`;
    if (worst.rate < 0.6) {
      result.needs_attention = `${worst.type} (${Math.round(worst.rate * 100)}%认可率)`;
    }
  }

  const current = trust.level || "L1";
  if (current === "L1") {
    result.next_level = {
      level: "L2", label: "审计模式",
      requirements: {
        tasks: { current: trust.total_tasks, target: 3, met: trust.total_tasks >= 3 },
        approval_rate: { current: trust.approval_rate, target: 0.8, met: trust.approval_rate >= 0.8 },
      },
    };
  } else if (current === "L2") {
    result.next_level = {
      level: "L3", label: "例外管理",
      requirements: {
        tasks: { current: trust.total_tasks, target: 10, met: trust.total_tasks >= 10 },
        approval_rate: { current: trust.approval_rate, target: 0.9, met: trust.approval_rate >= 0.9 },
        experience_packs: { current: experienceCount, target: 3, met: experienceCount >= 3 },
      },
    };
  } else if (current === "L3") {
    result.next_level = {
      level: "L4", label: "全权委托",
      requirements: {
        tasks: { current: trust.total_tasks, target: 30, met: trust.total_tasks >= 30 },
        approval_rate: { current: trust.approval_rate, target: 0.95, met: trust.approval_rate >= 0.95 },
        consecutive_clean: { current: trust.consecutive_clean, target: 10, met: trust.consecutive_clean >= 10 },
      },
    };
  }

  return result;
}

export { LEVEL_ORDER, LEVEL_LABELS, UPGRADE_RULES, DEFAULT_TYPE_MIN_LEVEL };
