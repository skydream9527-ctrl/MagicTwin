# 贡献指南 · Contributing to MagicTwin

感谢你对 MagicTwin 的兴趣！本文档说明如何参与贡献。请先阅读 [README](./README.md) 了解项目定位与架构。

---

## 行为准则

参与本项目即代表你同意遵守 [Code of Conduct](./CODE_OF_CONDUCT.md)。请在所有交流中保持尊重与友善。

---

## 我可以贡献什么

- **Bug 修复**：在 [Issues](../../issues) 中找带 `bug` 标签的条目
- **新特性**：先在 Issue 里讨论设计，达成共识后再开工
- **文档改进**：README、注释、示例、架构图，欢迎随时提 PR
- **新适配器**：为更多 LLM 或数据源写适配器（见下文「适配器规范」）
- **示例与范例**：在 `examples/` 提供新的演示脚本、知识包样例
- **测试**：补充边界用例、回归测试

---

## 开发流程

### 1. Fork & 克隆

```bash
git clone https://github.com/<你的用户名>/MagicTwin.git
cd MagicTwin
npm install   # 本项目零运行时依赖，但建议仍执行以校验 engines 字段
```

### 2. 准备本地环境

```bash
cp .env.example .env
# 至少配置 LLM_API_KEY（或任何 OpenAI 兼容 key）
cp workspace/users/u_local/twin/profile.example.md workspace/users/u_local/twin/profile.md
# 编辑 profile.md 填入你自己的画像（Twin 据此代表你做低风险决策）
```

### 3. 创建分支

```bash
git checkout -b feat/your-feature    # 新特性
git checkout -b fix/your-bugfix      # bug 修复
git checkout -b docs/your-docs       # 文档
```

### 4. 编码约定

- **语言**：纯 ES Modules，Node.js >= 18，**零第三方运行时依赖**（保持 `npm start` 即起的体验）
- **注释**：中文注释，先写「为什么」再写「是什么」
- **风格**：2 空格缩进，双引号字符串，无分号（与现有代码一致）
- **错误处理**：外部依赖缺失时返回 `*_NOT_CONFIGURED`，不阻塞启动（见设计哲学 #9）
- **安全**：写操作 / DDL / 跨空间读取必须走 HITL，绝不静默执行

### 5. 自测

```bash
npm start
# 访问 http://localhost:8787，跑通一个完整的 Twin ⇄ Data ⇄ Style 协作
```

至少跑通以下一个场景：
- 配置好 LLM key，给 Twin 一个数据分析目标，旁观完整协作到交付
- 未配置数据查询时，验证演示模式返回示例数据且不崩

### 6. 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>(<scope>): <subject>

<body>
```

- `type`：`feat` / `fix` / `docs` / `refactor` / `chore` / `test` / `perf`
- `scope`：`orchestrator` / `llm` / `data-query` / `prompts` / `web` / `store` / `docs` 等
- 示例：`feat(orchestrator): 支持 Twin 主动暂停长任务`

### 7. 提交 PR

- PR 标题遵循上述提交规范
- 在 PR 描述里说明：**改了什么、为什么改、如何自测的、是否影响向后兼容**
- 若改动涉及编排状态机或安全边界，请重点说明
- 等待 review，欢迎在 PR 里讨论

---

## 适配器规范（重要）

新增 LLM 或数据源适配器时请：

1. 落在 `server/integrations/<name>.js`，导出与现有 `llm.js` / `data-query.js` 一致的接口
2. **缺失配置时优雅降级**，返回 `*_NOT_CONFIGURED` 或演示数据，不抛 throw 阻塞启动
3. 真实调用点是 monkeypatch 友好的接缝，便于测试
4. 在 README「可配置的环境变量」表格补充新变量
5. 在 `.env.example` 加示例条目

---

## 安全红线

- **绝不**提交真实的 API key、个人画像、内部业务数据到 Git
- `workspace/users/u_local/twin/profile.md` 已在 `.gitignore`，请勿 `git add -f`
- `tasks/` 是运行时任务数据，已在 `.gitignore`
- 任何写操作（DDL/DML/跨空间读取）必须经过 HITL 审批，不接受「为了演示方便」绕过护栏的 PR

---

## 仓库结构速查

```
server/
  config.js              # 集中配置
  index.js               # 启动入口
  http/                  # 路由 / 静态前端 / SSE 运行时
  engine/orchestrator.js # Twin ⇄ Data ⇄ Style 编排引擎
  integrations/          # llm（LLM 网关） / data-query（数据查询适配器）
  domain/                # roster 花名册 / agents 详情 / store 任务存储
  prompts/               # 三个 Agent 的 system prompt 加载器
web/                     # 原生 HTML/CSS/JS 前端，零构建
workspace/
  agents/data-analysis/  # 数据分析 Agent 人设与知识
  users/u_local/twin/    # Twin 操作手册（agent.md）+ 用户画像（profile.md，gitignore）
docs/                    # 设计理念与构想
```

---

## 反馈渠道

- Bug / 建议：[GitHub Issues](../../issues)
- 设计讨论：先开 Issue 标 `discussion`，达成共识后再开 PR
- 紧急安全问题：见 README 中的「安全说明」，请勿在公开 Issue 暴露敏感信息

再次感谢你的贡献！
