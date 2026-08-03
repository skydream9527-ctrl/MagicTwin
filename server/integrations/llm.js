// 多供应商 LLM 客户端（OpenAI Chat Completions 兼容）。
// 前端保存带命名空间的模型 ID，服务端按前缀自动路由：
//   minimax/MiniMax-M2.7
//   volcengine/doubao-seed-2-0-lite-260215
// 密钥只从进程环境 / 服务器私密 .env 读取，不会返回给浏览器。
import "../env.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { mockChat } from "./mock-llm.js";

const BACKEND = (process.env.LLM_BACKEND || "mock").trim().toLowerCase();

function csv(value) {
  return [...new Set(String(value || "").split(",").map((item) => item.trim()).filter(Boolean))];
}

function cleanBaseUrl(value, fallback) {
  return String(value || fallback).replace(/\/+$/, "");
}

// OpenAI 兼容网关的 key 不一定以 sk- 开头（例如火山方舟使用 UUID 形态）。
export function isValidApiKey(value) {
  if (typeof value !== "string") return false;
  const key = value.trim();
  return key.length >= 16 && key.length <= 512 && !/\s/.test(key);
}

function keyFromEnv(name) {
  const value = String(process.env[name] || "").trim();
  return isValidApiKey(value) ? value : null;
}

function fromCredentials() {
  try {
    const text = readFileSync(join(homedir(), ".config", "magictwin", "credentials"), "utf8");
    for (const line of text.split("\n")) {
      const match = line.match(/^\s*export\s+LLM_API_KEY\s*=\s*(.+?)\s*$/);
      if (!match) continue;
      const key = match[1].trim().replace(/^['"]|['"]$/g, "");
      if (isValidApiKey(key)) return key;
    }
  } catch {}
  return null;
}

let cachedLegacyKey = null;
export function loadKey() {
  if (cachedLegacyKey) return cachedLegacyKey;
  cachedLegacyKey = keyFromEnv("LLM_API_KEY") || fromCredentials();
  return cachedLegacyKey;
}

const PROVIDERS = [
  {
    id: "minimax",
    label: "MiniMax",
    baseUrl: cleanBaseUrl(process.env.MINIMAX_BASE_URL, "https://api.minimaxi.com/v1"),
    key: () => keyFromEnv("MINIMAX_API_KEY"),
    models: csv(process.env.MINIMAX_MODELS),
  },
  {
    id: "volcengine",
    label: String(process.env.VOLCENGINE_BASE_URL || "").includes("/api/coding/")
      ? "火山引擎 · Coding Plan"
      : "火山引擎 · 豆包",
    baseUrl: cleanBaseUrl(process.env.VOLCENGINE_BASE_URL, "https://ark.cn-beijing.volces.com/api/v3"),
    key: () => keyFromEnv("VOLCENGINE_API_KEY"),
    models: csv(process.env.VOLCENGINE_MODELS),
  },
  {
    id: "openai-compatible",
    label: "OpenAI 兼容网关",
    baseUrl: cleanBaseUrl(process.env.LLM_BASE_URL, "https://api.openai.com/v1"),
    key: loadKey,
    models: csv(process.env.LLM_MODELS),
    legacy: true,
  },
];

const providerById = new Map(PROVIDERS.map((provider) => [provider.id, provider]));
let modelCache = null;

function namespaced(provider, model) {
  const value = String(model || "").trim();
  if (!value) return "";
  if (provider.legacy) return value;
  return value.startsWith(`${provider.id}/`) ? value : `${provider.id}/${value}`;
}

/** 纯函数：拆分前端使用的命名空间模型 ID。 */
export function parseRoutedModel(model) {
  const value = String(model || "").trim();
  const slash = value.indexOf("/");
  if (slash > 0) {
    const prefix = value.slice(0, slash);
    if (providerById.has(prefix) && prefix !== "openai-compatible") {
      return { providerId: prefix, model: value.slice(slash + 1) };
    }
  }
  return { providerId: "", model: value };
}

function configuredProviders() {
  return PROVIDERS.filter((provider) => !!provider.key());
}

function resolveProvider(model) {
  const routed = parseRoutedModel(model);
  if (routed.providerId) {
    const provider = providerById.get(routed.providerId);
    if (!provider?.key()) {
      const error = new Error(`LLM_PROVIDER_NOT_CONFIGURED: ${routed.providerId}`);
      error.code = "LLM_PROVIDER_NOT_CONFIGURED";
      throw error;
    }
    return { provider, model: routed.model };
  }

  const normalized = routed.model.toLowerCase();
  const inferred = normalized.startsWith("minimax") || normalized.startsWith("abab")
    ? providerById.get("minimax")
    : normalized.startsWith("doubao") || normalized.startsWith("seed")
      ? providerById.get("volcengine")
      : null;
  if (inferred?.key()) return { provider: inferred, model: routed.model };

  const legacy = providerById.get("openai-compatible");
  if (legacy.key()) return { provider: legacy, model: routed.model };

  const active = configuredProviders();
  if (active.length === 1) return { provider: active[0], model: routed.model };

  const error = new Error(`LLM_MODEL_PROVIDER_UNKNOWN: ${model}`);
  error.code = "LLM_MODEL_PROVIDER_UNKNOWN";
  throw error;
}

export function hasKey() {
  return BACKEND === "mock" || configuredProviders().length > 0;
}

export function llmBackend() {
  if (BACKEND === "mock") return "mock";
  return configuredProviders().length > 1 ? "multi" : BACKEND;
}

/** 只返回非敏感的连接状态，供页面显示。 */
export function providerStatus() {
  if (BACKEND === "mock") {
    return [{ id: "mock", label: "LLM Mock", configured: true, models: ["mock/magictwin"] }];
  }
  return PROVIDERS.map((provider) => ({
    id: provider.id,
    label: provider.label,
    configured: !!provider.key(),
    models: provider.models.map((model) => namespaced(provider, model)),
  }));
}

// 底层 HTTP POST：使用 node:https，让超时完全由编排层控制。
function requestJson({ url, headers, payload, timeoutMs }) {
  return new Promise((resolve, reject) => {
    import("node:https").then(({ default: https }) => {
      const target = new URL(url);
      const body = Buffer.from(JSON.stringify(payload), "utf8");
      const req = https.request(
        {
          method: "POST",
          hostname: target.hostname,
          port: target.port || 443,
          path: target.pathname + target.search,
          headers: { ...headers, "Content-Length": body.length },
        },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            clearTimeout(timer);
            resolve({ status: res.statusCode || 0, text: Buffer.concat(chunks).toString("utf8") });
          });
        }
      );
      const timer = setTimeout(() => {
        const error = new Error(`LLM 请求超时（${timeoutMs}ms 内未完成）`);
        error.code = "LLM_TIMEOUT";
        req.destroy(error);
      }, timeoutMs);
      req.on("error", (error) => { clearTimeout(timer); reject(error); });
      req.write(body);
      req.end();
    }).catch(reject);
  });
}

/** MiniMax 的 OpenAI 兼容返回可能把思考放在 content 的 <think> 标签里。 */
export function extractThinking(content, reasoning = "") {
  const source = String(content || "");
  const blocks = [];
  const cleaned = source.replace(/<think>([\s\S]*?)<\/think>/gi, (_, thought) => {
    if (String(thought).trim()) blocks.push(String(thought).trim());
    return "";
  }).trim();
  return {
    content: cleaned,
    reasoning: [String(reasoning || "").trim(), ...blocks].filter(Boolean).join("\n\n"),
  };
}

/** 调用一次 chat completion。模型前缀决定使用哪个供应商。 */
export async function chat({ model, messages, maxTokens = 2048, temperature = 0.3, timeoutMs = 600000 }) {
  if (BACKEND === "mock") {
    return mockChat({ model: model || "mock/magictwin", messages, maxTokens, temperature, timeoutMs });
  }

  const { provider, model: upstreamModel } = resolveProvider(model);
  const key = provider.key();
  if (!key) {
    const error = new Error("LLM_KEY_NOT_CONFIGURED");
    error.code = "LLM_KEY_NOT_CONFIGURED";
    throw error;
  }

  const once = async (temp) => {
    const startedAt = Date.now();
    const { status, text } = await requestJson({
      url: `${provider.baseUrl}/chat/completions`,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      payload: { model: upstreamModel, messages, max_tokens: maxTokens, temperature: temp },
      timeoutMs,
    });
    const ms = Date.now() - startedAt;
    if (status < 200 || status >= 300) {
      const error = new Error(`LLM_HTTP_${status}: ${text.slice(0, 500)}`);
      error.code = `LLM_HTTP_${status}`;
      error.status = status;
      error.body = text;
      throw error;
    }

    let data;
    try { data = JSON.parse(text); }
    catch {
      const error = new Error("LLM_BAD_JSON: 响应不是合法 JSON");
      error.code = "LLM_BAD_JSON";
      error.body = text.slice(0, 500);
      throw error;
    }
    const message = data?.choices?.[0]?.message || {};
    const normalized = provider.id === "minimax"
      ? extractThinking(message.content, message.reasoning_content)
      : { content: String(message.content || "").trim(), reasoning: String(message.reasoning_content || "").trim() };
    return {
      ...normalized,
      usage: data.usage || {},
      ms,
      model: namespaced(provider, upstreamModel),
    };
  };

  try {
    return await once(temperature);
  } catch (error) {
    // 部分推理模型只接受 temperature=1，命中后自动重试一次。
    if (error.status === 400 && /temperature/i.test(error.body || error.message || "") && temperature !== 1) {
      return await once(1);
    }
    throw error;
  }
}

async function fetchProviderModels(provider) {
  if (!provider.key()) return [];
  if (provider.models.length) return provider.models.map((model) => namespaced(provider, model));
  try {
    const response = await fetch(`${provider.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${provider.key()}` },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return [];
    const data = JSON.parse(await response.text());
    const ids = (data.data || []).map((item) => item.id || item.name).filter(Boolean);
    return [...new Set(ids.map((id) => namespaced(provider, id)))];
  } catch {
    return [];
  }
}

/** 合并所有已配置供应商的模型，返回可直接保存的命名空间 ID。 */
export async function listModels() {
  if (BACKEND === "mock") return ["mock/magictwin"];
  if (modelCache) return modelCache;
  const lists = await Promise.all(PROVIDERS.map(fetchProviderModels));
  modelCache = [...new Set(lists.flat())].sort((a, b) => a.localeCompare(b));
  return modelCache;
}
