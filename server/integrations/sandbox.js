// 代码执行沙箱（Python）。
//
// 设计目标：让 code-runner Agent 的 execute 能力开箱即用，同时保证安全。
// 默认禁用（返回明确错误），需显式开启才执行代码；开启后通过子进程调用
// 本机 python3，带超时、资源隔离建议、stdout/stderr 回喂。
//
// 接入方式（任选其一）：
//   1. 设 SANDBOX_ENABLED=1 + SANDBOX_PYTHON=python3 （本机直接执行，仅建议开发环境）
//   2. 设 SANDBOX_ENABLED=1 + SANDBOX_COMMAND="docker run --rm --network=none
//      --memory=512m --cpus=1 -i python:3.12-slim" （生产推荐：Docker 隔离）
//   3. 直接修改本文件底部的 adapter 实现（接外部沙箱服务 API 等）
//
// 安全：
//   - 默认禁用（SANDBOX_ENABLED 未设或为 0 时返回 SANDBOX_DISABLED）
//   - 强制超时（默认 30s，可设 SANDBOX_TIMEOUT_MS）
//   - 代码通过 stdin 传入，避免命令注入
//   - 生产环境强烈建议用 SANDBOX_COMMAND 接 Docker / gVisor / 远程沙箱服务
import { spawn } from "node:child_process";

const ENABLED = process.env.SANDBOX_ENABLED === "1" || process.env.SANDBOX_ENABLED === "true";
const PYTHON = process.env.SANDBOX_PYTHON || "python3";
const TIMEOUT_MS = Number(process.env.SANDBOX_TIMEOUT_MS || 30000);
const MAX_OUTPUT = Number(process.env.SANDBOX_MAX_OUTPUT || 20000); // stdout/stderr 各自截断上限

/**
 * 是否已启用沙箱（供 /api/health 与 orchestrator 判断能力是否真实可用）
 */
export function isSandboxEnabled() {
  return ENABLED;
}

/**
 * 执行一段 Python 代码。
 * @param {string} code  Python 源码（通过 stdin 传入，避免命令注入）
 * @returns {Promise<{ok:boolean, stdout:string, stderr:string, ms:number, code?:number, error?:string}>}
 */
export async function runPython(code) {
  if (!ENABLED) {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      ms: 0,
      code: "SANDBOX_DISABLED",
      error: "代码沙箱未启用。设 SANDBOX_ENABLED=1 开启（开发用 python3，生产用 SANDBOX_COMMAND 接 Docker）。",
    };
  }
  if (!code || typeof code !== "string") {
    return { ok: false, stdout: "", stderr: "", ms: 0, code: "EMPTY_CODE", error: "代码为空" };
  }

  const startedAt = Date.now();
  // 解析 SANDBOX_COMMAND（如有）：拆成 argv，末尾会以 stdin 传代码
  const command = process.env.SANDBOX_COMMAND;
  let cmd, args;
  if (command) {
    const parts = command.split(/\s+/).filter(Boolean);
    cmd = parts[0];
    args = parts.slice(1).concat(["-"]); // 末尾 - 让 python 从 stdin 读
  } else {
    cmd = PYTHON;
    args = ["-"]; // python3 - 从 stdin 读代码
  }

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let killed = false;
    const child = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        // 给沙箱一个最小环境：PYTHONPATH 不继承外部，避免 import 已装包做坏事
        PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
        LANG: "en_US.UTF-8",
        LC_ALL: "en_US.UTF-8",
        PYTHONIOENCODING: "utf-8",
        MPLBACKEND: "Agg", // matplotlib 无显示环境时用 Agg 后端
      },
      // 不继承 cwd（避免访问项目文件），在临时目录跑
      cwd: "/tmp",
    });

    const timer = setTimeout(() => {
      killed = true;
      try { child.kill("SIGKILL"); } catch {}
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > MAX_OUTPUT) {
        if (!truncated) { stdout = stdout.slice(0, MAX_OUTPUT) + "\n…[输出已截断]"; truncated = true; }
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > MAX_OUTPUT) {
        if (!truncated) { stderr = stderr.slice(0, MAX_OUTPUT) + "\n…[stderr 已截断]"; truncated = true; }
      }
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        stdout,
        stderr: stderr + `\n[spawn error] ${err.message}`,
        ms: Date.now() - startedAt,
        code: "SPAWN_FAILED",
        error: `无法启动沙箱进程：${err.message}（检查 SANDBOX_PYTHON=${PYTHON} 或 SANDBOX_COMMAND）`,
      });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      const ms = Date.now() - startedAt;
      if (killed) {
        return resolve({
          ok: false,
          stdout,
          stderr: stderr + `\n[超时] 代码执行超过 ${TIMEOUT_MS}ms 被强制终止`,
          ms,
          code: "TIMEOUT",
          error: `执行超时（${TIMEOUT_MS}ms）`,
        });
      }
      if (exitCode !== 0) {
        return resolve({
          ok: false,
          stdout,
          stderr,
          ms,
          code: "EXIT_" + exitCode,
          error: `Python 退出码 ${exitCode}`,
        });
      }
      resolve({ ok: true, stdout, stderr, ms });
    });

    // 通过 stdin 传入代码，避免命令行参数注入
    try {
      child.stdin.write(code);
      child.stdin.end();
    } catch (err) {
      clearTimeout(timer);
      try { child.kill("SIGKILL"); } catch {}
      resolve({
        ok: false,
        stdout,
        stderr: stderr + `\n[stdin error] ${err.message}`,
        ms: Date.now() - startedAt,
        code: "STDIN_FAILED",
        error: `无法写入代码到沙箱：${err.message}`,
      });
    }
  });
}
