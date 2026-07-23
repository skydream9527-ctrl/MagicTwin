// 风险分级矩阵配置：读写 risk-config.json。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RULES_DIR = join(ROOT, "workspace", "users", "u_local", "twin", "knowledge", "rules");
const JSON_PATH = join(RULES_DIR, "risk-config.json");

const DEFAULT_CONFIG = {
  levels: {
    low: { action: "auto_answer", requires_human: false, stance: "可以直接代答，事后记录即可" },
    medium: { action: "auto_answer_with_log", requires_human: false, stance: "可以代答，但要明确记录决策理由" },
    high: { action: "escalate", requires_human: true, stance: "必须升级给用户确认，Twin不能自行决定" },
  },
  rules: [
    { id: "rk_high_write", level: "high", signals: ["写入", "删除", "修改", "执行", "提交", "发布", "删除数据", "drop table", "delete from", "update set"], example: "执行写操作/修改线上数据", rationale: "写操作有不可逆风险，必须人工确认", escalate_question: "检测到可能的写操作，是否确认执行？", enabled: true },
    { id: "rk_high_out_of_scope", level: "high", signals: ["超出目标", "和任务无关", "越权", "scope creep"], example: "用户要求执行超出初始目标范围的操作", rationale: "越权操作需要用户明确授权", escalate_question: "这个操作不在当前任务范围内，是否确认继续？", enabled: true },
    { id: "rk_high_expensive", level: "high", signals: ["全表扫描", "大表", "cartesian", "笛卡尔积"], example: "执行可能耗费大量资源的重查询", rationale: "资源消耗型操作需要确认", escalate_question: "这个查询可能非常耗费资源，是否确认执行？", enabled: true },
    { id: "rk_high_judgment", level: "high", signals: ["对外发布", "结论定性", "归因", "下结论", "责任归属"], example: "需要做出业务判断或归因结论", rationale: "业务判断和归因需要负责人确认", escalate_question: "涉及业务判断/归因，是否确认这个结论？", enabled: true },
    { id: "rk_medium_caliber", level: "medium", signals: ["口径选择", "时间范围", "维度选择", "指标定义"], example: "选择分析口径、时间范围、维度", rationale: "口径选择影响分析结果，需要记录理由", escalate_question: "", enabled: true },
  ],
  thresholds: {
    auto_answer_max_risk: "medium",
    always_escalate: ["rk_high_write", "rk_high_out_of_scope", "rk_high_expensive", "rk_high_judgment"],
  },
};

function ensureDir() {
  try { mkdirSync(RULES_DIR, { recursive: true }); } catch {}
}

export function getRiskConfig() {
  ensureDir();
  if (existsSync(JSON_PATH)) {
    try {
      const cfg = JSON.parse(readFileSync(JSON_PATH, "utf8"));
      return { ...DEFAULT_CONFIG, ...cfg, levels: { ...DEFAULT_CONFIG.levels, ...(cfg.levels || {}) } };
    } catch {}
  }
  writeFileSync(JSON_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
  return DEFAULT_CONFIG;
}

export function saveRiskConfig(config) {
  if (!config || typeof config !== "object") throw new Error("无效配置");
  ensureDir();
  writeFileSync(JSON_PATH, JSON.stringify(config, null, 2));
}
