import { readDecisions } from "./store.js";
import { getTrust, saveTrust, checkLevelUp, shouldAutoAnswer } from "./trust.js";
import { countL2 } from "./experience.js";

export async function calibrate(uid, tid, sseEmit) {
  const trust = getTrust(uid);
  const oldLevel = trust.level;

  const decisions = readDecisions(tid);
  let hasCorrectionsInTask = false;

  for (const dec of decisions) {
    trust.total_decisions++;

    const type = dec.type || "uncategorized";
    trust.by_type[type] = trust.by_type[type] || {
      total: 0, approved: 0, corrected: 0, escalate_only: false,
    };
    trust.by_type[type].total++;

    if (dec.user_feedback === "approved") {
      trust.approved++;
      trust.by_type[type].approved++;
      if (trust.consecutive_corrections[type]) {
        delete trust.consecutive_corrections[type];
      }
    } else if (dec.user_feedback === "corrected") {
      trust.corrected++;
      trust.by_type[type].corrected++;
      trust.consecutive_corrections[type] = (trust.consecutive_corrections[type] || 0) + 1;
      hasCorrectionsInTask = true;
    }
  }

  trust.approval_rate = trust.total_decisions > 0
    ? trust.approved / trust.total_decisions : 0;
  trust.correction_rate = trust.total_decisions > 0
    ? trust.corrected / trust.total_decisions : 0;

  for (const [type, count] of Object.entries(trust.consecutive_corrections)) {
    if (count >= 3) {
      if (!trust.by_type[type]) {
        trust.by_type[type] = { total: 0, approved: 0, corrected: 0, escalate_only: false };
      }
      trust.by_type[type].escalate_only = true;
    }
  }

  for (const [type, info] of Object.entries(trust.by_type)) {
    if (info.escalate_only) {
      if (!trust.consecutive_corrections[type]) {
        info.escalate_only = false;
      }
    }
  }

  if (!hasCorrectionsInTask) {
    trust.consecutive_clean = (trust.consecutive_clean || 0) + 1;
  } else {
    trust.consecutive_clean = 0;
  }

  const expCount = countL2(uid);
  const newLevel = checkLevelUp(trust, expCount);
  const upgraded = newLevel !== null && newLevel !== oldLevel;

  if (upgraded) {
    trust.level = newLevel;
  }

  trust.total_tasks++;

  saveTrust(uid, trust);

  if (upgraded && sseEmit) {
    try {
      sseEmit("trust_level", {
        from: oldLevel,
        to: newLevel,
        reason: getUpgradeReason(oldLevel, newLevel, trust, expCount),
      });
    } catch {}
  }

  return {
    oldLevel,
    newLevel: trust.level,
    upgraded,
    dashboard: trust,
  };
}

export function processFeedback(uid, decisionId, action, correctedValue) {
  const trust = getTrust(uid);
  saveTrust(uid, trust);
  return trust;
}

function getUpgradeReason(from, to, trust, expCount) {
  if (from === "L1" && to === "L2") {
    return `累计${trust.total_tasks}次任务 + 认可率${Math.round(trust.approval_rate * 100)}% ≥ 80%`;
  }
  if (from === "L2" && to === "L3") {
    return `累计${trust.total_tasks}次任务 + 认可率${Math.round(trust.approval_rate * 100)}% ≥ 90% + 经验包${expCount}条 ≥ 3条`;
  }
  if (from === "L3" && to === "L4") {
    return `累计${trust.total_tasks}次任务 + 认可率${Math.round(trust.approval_rate * 100)}% ≥ 95% + 连续${trust.consecutive_clean}次零纠正 ≥ 10次`;
  }
  return "";
}
