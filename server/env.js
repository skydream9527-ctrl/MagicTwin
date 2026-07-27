// 零依赖 .env 加载器。
//
// Node 18 没有稳定可用的 --env-file，因此在服务端模块加载配置前主动读取项目根目录的 .env。
// 已存在的进程环境变量优先，不会被 .env 覆盖。
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function unquote(value) {
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' || first === "'") && last === first) {
    const inner = value.slice(1, -1);
    if (first === "'") return inner;
    return inner.replace(/\\(n|r|t|"|\\)/g, (_, ch) => ({
      n: "\n",
      r: "\r",
      t: "\t",
      '"': '"',
      "\\": "\\",
    })[ch]);
  }
  return value.replace(/\s+#.*$/, "").trim();
}

export function loadEnvFile(path = process.env.ENV_FILE || ".env") {
  const filePath = isAbsolute(path) ? path : join(ROOT, path);
  if (!existsSync(filePath)) return { loaded: false, path: filePath, count: 0 };

  let count = 0;
  const text = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = unquote(rawValue.trim());
    count++;
  }
  return { loaded: true, path: filePath, count };
}

loadEnvFile();
