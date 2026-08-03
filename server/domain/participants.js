import { getRosterEntry, isToolAgentKey } from "./roster.js";

const MAX_PARTICIPANTS = 18;

function cleanId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function shortModel(model) {
  const value = String(model || "");
  const slash = value.indexOf("/");
  return slash >= 0 ? value.slice(slash + 1) : value;
}

function nextId(agentKey, index, used) {
  const base = `p-${cleanId(agentKey) || "agent"}-${index + 1}`;
  let id = base;
  let suffix = 2;
  while (used.has(id)) id = `${base}-${suffix++}`;
  return id;
}

/**
 * 把前端的“讨论分身”清理成可持久化、可路由的参与者实例。
 * 同一个 agentKey 可以出现多次；每个实例拥有独立 id、name 与 model。
 */
export function normalizeParticipants(raw, options = {}) {
  if (!Array.isArray(raw)) return [];
  if (raw.length > MAX_PARTICIPANTS) throw new Error(`讨论分身最多 ${MAX_PARTICIPANTS} 个`);

  const dispatchable = options.dispatchable instanceof Set
    ? options.dispatchable
    : new Set(options.dispatchable || []);
  const available = options.availableModels instanceof Set
    ? options.availableModels
    : new Set(options.availableModels || []);
  const defaults = options.models || {};
  const used = new Set();

  return raw.map((item, index) => {
    const agentKey = String(item?.agentKey || "").trim();
    if (!isToolAgentKey(agentKey) || (dispatchable.size && !dispatchable.has(agentKey))) {
      throw new Error(`第 ${index + 1} 个分身的人设不可调度：${agentKey || "（空）"}`);
    }

    const model = String(item?.model || defaults[agentKey] || "").trim();
    if (!model) throw new Error(`第 ${index + 1} 个分身没有选择模型`);
    if (available.size && !available.has(model)) {
      throw new Error(`模型不在当前可用清单中：${model}`);
    }

    let id = cleanId(item?.id);
    if (!id || used.has(id) || id === "twin" || id === "user" || id === "system") {
      id = nextId(agentKey, index, used);
    }
    used.add(id);

    const agent = getRosterEntry(agentKey);
    const fallbackName = `${agent?.name || agentKey} · ${shortModel(model)}`;
    const name = String(item?.name || fallbackName).trim().slice(0, 80) || fallbackName;
    return { id, agentKey, name, model };
  });
}

export function legacyParticipants(team = [], models = {}) {
  return (team || []).filter(isToolAgentKey).map((agentKey, index) => {
    const agent = getRosterEntry(agentKey);
    const model = String(models[agentKey] || "").trim();
    return {
      id: agentKey,
      agentKey,
      name: agent?.name || agentKey,
      model,
      legacy: true,
      order: index,
    };
  });
}

export { MAX_PARTICIPANTS };
