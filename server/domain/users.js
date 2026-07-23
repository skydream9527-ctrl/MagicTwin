// 多用户空间管理：用户注册、空间路由、隔离边界。
// 设计：每个用户有独立的 Twin 空间（workspace/users/{uid}/twin/）。
// 默认用户 u_local（向后兼容），支持通过环境变量 IDW_MULTI_USER_ENABLED=1 启用多用户。
// 团队空间：workspace/teams/{teamId}/（共享经验包/知识）。
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const USERS_DIR = join(ROOT, "workspace", "users");
const TEAMS_DIR = join(ROOT, "workspace", "teams");
const USERS_INDEX = join(USERS_DIR, "users.json");

const DEFAULT_UID = "u_local";

export function isMultiUserEnabled() {
  return process.env.IDW_MULTI_USER_ENABLED === "1";
}

export function resolveUid(reqHeaders) {
  if (!isMultiUserEnabled()) return DEFAULT_UID;
  const uid = reqHeaders && reqHeaders["x-user-id"];
  return (uid && typeof uid === "string" && uid.trim()) ? uid.trim() : DEFAULT_UID;
}

export function userSpacePath(uid) {
  return join(USERS_DIR, uid || DEFAULT_UID, "twin");
}

export function userExperiencePath(uid) {
  return join(USERS_DIR, uid || DEFAULT_UID, "experience");
}

export function teamSpacePath(teamId) {
  return join(TEAMS_DIR, teamId);
}

export function ensureUserSpace(uid) {
  const twinDir = userSpacePath(uid);
  if (existsSync(twinDir)) return;

  mkdirSync(twinDir, { recursive: true });
  mkdirSync(join(twinDir, "knowledge"), { recursive: true });
  mkdirSync(join(twinDir, "knowledge", "rules"), { recursive: true });
  mkdirSync(join(twinDir, "memory"), { recursive: true });

  const defaultAgentMd = `# Twin · 数字分身\n\n你是用户的数字分身，负责协调各专业 Agent 完成用户的任务。\n\n{{PROFILE}}\n\n{{KNOWLEDGE}}\n\n{{AGENTS}}`;
  writeFileSync(join(twinDir, "agent.md"), defaultAgentMd);

  writeFileSync(join(twinDir, "profile.md"), `# 用户画像\n\n> 待蒸馏。使用平台后将自动从工作习惯中提取画像。`);
}

export function ensureTeamSpace(teamId) {
  const dir = teamSpacePath(teamId);
  if (existsSync(dir)) return;
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "experience"), { recursive: true });
  mkdirSync(join(dir, "knowledge"), { recursive: true });
}

export function listUsers() {
  if (!existsSync(USERS_INDEX)) {
    if (!existsSync(USERS_DIR)) return [{ uid: DEFAULT_UID, name: "本地用户" }];
    return readdirSync(USERS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name !== ".gitkeep")
      .map(d => ({ uid: d.name, name: d.name === DEFAULT_UID ? "本地用户" : d.name }));
  }
  try { return JSON.parse(readFileSync(USERS_INDEX, "utf8")); } catch { return []; }
}

export function registerUser(uid, name) {
  if (!uid || typeof uid !== "string") throw new Error("uid 不能为空");
  const sanitized = uid.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32);
  ensureUserSpace(sanitized);

  const users = listUsers();
  if (users.find(u => u.uid === sanitized)) return { uid: sanitized, name, exists: true };
  users.push({ uid: sanitized, name: name || sanitized, createdAt: new Date().toISOString() });
  if (!existsSync(USERS_DIR)) mkdirSync(USERS_DIR, { recursive: true });
  writeFileSync(USERS_INDEX, JSON.stringify(users, null, 2));
  return { uid: sanitized, name, exists: false };
}

export function listTeams() {
  if (!existsSync(TEAMS_DIR)) return [];
  return readdirSync(TEAMS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => ({ teamId: d.name }));
}

export function agentMemoryForUser(agentKey, uid) {
  return join(ROOT, "workspace", "agents", agentKey, "memory", "by-user", uid || DEFAULT_UID);
}

export function agentMemoryForTeam(agentKey, teamId) {
  return join(ROOT, "workspace", "agents", agentKey, "memory", "by-team", teamId);
}
