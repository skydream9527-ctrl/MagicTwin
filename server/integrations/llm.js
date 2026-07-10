// LLM 网关客户端（OpenAI 兼容）。
// 通过 LLM_BASE_URL 配置你的 OpenAI 兼容端点（如 https://api.openai.com/v1）。
// model 名格式取决于你的网关：OpenAI 原生用 "gpt-4o"，支持 {owner}/{id} 的网关用 "openai/gpt-4o"。
// key 解析顺序：
//   1. $LLM_API_KEY
//   2. ~/.config/magictwin/credentials  (export LLM_API_KEY=...)
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// 基地址：通过 LLM_BASE_URL 配置你的 OpenAI 兼容端点。
// 形如 https://api.openai.com/v1 或其他兼容网关（末尾不带 /chat/completions）。
const BASE_URL = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const CHAT_URL = `${BASE_URL}/chat/completions`;
const MODELS_URL = `${BASE_URL}/models`;
const KEY_RE = /^sk-[A-Za-z0-9_-]{16,196}$/;

let cachedKey = null;

function fromEnv() {
  const k = (process.env.LLM_API_KEY || "").trim();
  return KEY_RE.test(k) ? k : null;
}

function fromCredentials() {
  try {
    const text = readFileSync(join(homedir(), ".config", "magictwin", "credentials"), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*export\s+LLM_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) {
        const k = m[1].trim().replace(/^['"]|['"]$/g, "");
        if (KEY_RE.test(k)) return k;
      }
    }
  } catch {}
  return null;
}

export function loadKey() {
  if (cachedKey) return cachedKey;
  cachedKey = fromEnv() || fromCredentials();
  return cachedKey;
}

export function hasKey() {
  return !!loadKey();
}

// 底层 HTTP POST：用 node:https（非内置 fetch）。
// 原因：内置 fetch(undici) 的 headers/body 超时默认约 300s 是硬上限，无法在零依赖下放宽；
// 改用 https 后超时完全由我们自己的定时器控制，可设任意大（支持很慢的推理模型 + 大 prompt）。
// 超时以 code="LLM_TIMEOUT" 的错误 reject —— 编排层的 callAgent 据此退避重试。
function requestJson({ url, headers, payload, timeoutMs }) {
  return new Promise((resolve, reject) => {
    import("node:https").then(({ default: https }) => {
      const u = new URL(url);
      const body = Buffer.from(JSON.stringify(payload), "utf8");
      const req = https.request(
        {
          method: "POST",
          hostname: u.hostname,
          port: u.port || 443,
          path: u.pathname + u.search,
          headers: { ...headers, "Content-Length": body.length },
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => { clearTimeout(timer); resolve({ status: res.statusCode || 0, text: Buffer.concat(chunks).toString("utf8") }); });
        }
      );
      const timer = setTimeout(() => {
        const e = new Error(`LLM 请求超时（${timeoutMs}ms 内未完成）`);
        e.code = "LLM_TIMEOUT";
        req.destroy(e);
      }, timeoutMs);
      req.on("error", (err) => { clearTimeout(timer); reject(err); });
      req.write(body);
      req.end();
    }).catch(reject);
  });
}

/**
 * 调用一次 chat completion（OpenAI 兼容）。
 * @param {object} opts
 * @param {string} opts.model  模型名（如 gpt-4o，或支持 {owner}/{id} 的网关用 openai/gpt-4o）
 * @param {Array}  opts.messages  [{role, content}]
 * @param {number} [opts.maxTokens=2048]
 * @param {number} [opts.temperature=0.3]
 * @param {number} [opts.timeoutMs=600000]  单次调用超时（默认 10 分钟；由 https 层自控，可设任意大）
 * @returns {Promise<{content:string, reasoning:string, usage:object, ms:number, model:string}>}
 */
export async function chat({ model, messages, maxTokens = 2048, temperature = 0.3, timeoutMs = 600000 }) {
  const key = loadKey();
  if (!key) {
    const err = new Error("LLM_KEY_NOT_CONFIGURED");
    err.code = "LLM_KEY_NOT_CONFIGURED";
    throw err;
  }

  const once = async (temp) => {
    const t0 = Date.now();
    const { status, text } = await requestJson({
      url: CHAT_URL,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      payload: { model, messages, max_tokens: maxTokens, temperature: temp },
      timeoutMs,
    });
    const ms = Date.now() - t0;
    if (status < 200 || status >= 300) {
      const err = new Error(`LLM_HTTP_${status}: ${text.slice(0, 500)}`);
      err.code = `LLM_HTTP_${status}`;
      err.status = status;
      err.body = text;
      throw err;
    }
    let data;
    try { data = JSON.parse(text); }
    catch { const e = new Error("LLM_BAD_JSON: 响应不是合法 JSON"); e.code = "LLM_BAD_JSON"; e.body = text.slice(0, 500); throw e; }
    const msg = data?.choices?.[0]?.message || {};
    return {
      content: (msg.content || "").trim(),
      reasoning: (msg.reasoning_content || "").trim(),
      usage: data.usage || {},
      ms,
      model,
    };
  };

  try {
    return await once(temperature);
  } catch (err) {
    // 某些模型只接受 temperature=1，命中该错误则自动用 1 重试一次
    if (err.status === 400 && /temperature/i.test(err.body || err.message || "") && temperature !== 1) {
      return await once(1);
    }
    throw err;
  }
}

// 列出网关上的 LLM 模型（去重，返回可直接用作 model 参数的字符串）。
let _modelCache = null;
export async function listModels() {
  if (_modelCache) return _modelCache;
  const key = loadKey();
  if (!key) return [];
  try {
    const resp = await fetch(MODELS_URL, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!resp.ok) return [];
    const data = JSON.parse(await resp.text());
    const seen = new Set();
    const out = [];
    for (const m of data.data || []) {
      const id = m.id || m.name;
      if (!id) continue;
      const callAs = m.owned_by ? `${m.owned_by}/${id}` : id;
      if (seen.has(callAs)) continue;
      seen.add(callAs);
      out.push(callAs);
    }
    out.sort((a, b) => a.localeCompare(b));
    _modelCache = out;
    return out;
  } catch {
    return [];
  }
}
