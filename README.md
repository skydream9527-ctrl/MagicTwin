# MagicTwin · 数字分身驱动的多 Agent 协作工作空间

> **Twin（数字分身）代替你，去驱动真实的数据分析 Agent 与样式优化 Agent 把活干完**——真连 LLM 与数据平台查真实数据、真跑分析；Twin 替你回答过程中的确认项、验收产出、必要时打回重做，最后把结论交付给你。全程可旁观、可回溯、可随时接管。
>
> *A digital-twin-driven multi-agent workspace: your Twin orchestrates a real data-analysis agent and a style-polish agent on your behalf — answering confirmation gates, reviewing deliverables, escalating only the high-risk calls back to you. Watch, replay, or jump in anytime.*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](./package.json)
[![Zero Deps](https://img.shields.io/badge/dependencies-0-blue.svg)](#)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

这是「User → Twin → Agents」主链路的一个**可运行切片**。完整设计见 [`docs/vision.md`](./docs/vision.md)，设计哲学见 [`docs/design-principles.md`](./docs/design-principles.md)。

---

## 核心看点

多方角色在**同一个对话区**里协作：

| 角色 | 定位 | 职责 | 边界 |
|---|---|---|---|
| **用户（你）** | 目标设定者 & 最终验收人 | 给目标、随时审阅、拍板被升级上来的高风险决策；可随时 @ 插话或私聊 Twin | 不盯每一步 |
| **Twin（数字分身）** | 用户的代理人 / 唯一编排者 | 理解意图、派活、**替用户回答确认项**、验收、打回、交付 | 只提议不越权；高风险回来问用户 |
| **数据分析 Agent** | 干活的专家 | 命题澄清 → NL→SQL → **真实查数** → 分析 → 归因 → 出结论 | 不替用户拍板；只读查询 |
| **样式优化 Agent** | 报告编辑 | 把数据 Agent 的结论排版成结构清晰、可直接交付的报告 | 不查数、不改数字；只交回 Twin |

关键看点：数据 / 样式 Agent 面对的「甲方」都是 Twin 而非用户本人。大部分确认门被 Twin 自动扛下，用户没被打扰，但**每个代答都留痕可查**。

---

## ⚠️ 关于外部依赖（开源用户必读）

本项目设计为零依赖、降级不阻塞。两个外部集成均可选：

| 集成 | 用途 | 默认 | 如何替换 / 跳过 |
|---|---|---|---|
| **LLM 网关** | LLM 调用（OpenAI 兼容） | 任意 OpenAI 兼容端点 | 设 `LLM_BASE_URL` 指向你的端点（OpenAI / DeepSeek / Together / 自建 vLLM 等），见下方「配置 LLM」 |
| **数据查询** | 数据平台取数 | 演示模式（返回示例数据） | 不配置即演示模式，编排始终可跑通；接入真实数据源见下方「配置数据查询」 |

`workspace/agents/data-analysis/knowledge/` 下的知识文件是**示例模板**，请替换为你自己的真实业务知识。

---

## 技术架构

```
浏览器（工作空间 UI，状态优先，原生 HTML/CSS/JS，零构建）
     │  SSE 流式：实时推送 Twin / 数据 Agent / 样式 Agent 的对话与工具调用
     │  用户可在主区 @ 插话（/inject），或在侧栏私聊 Twin 问进度（/inquiry）
     ▼
本地 Node.js 服务（server/index.js，零第三方依赖）
     ├── 编排引擎  engine/orchestrator.js：驱动 Twin ⇄ 数据 Agent ⇄ 样式 Agent 有界多轮 + 用户插话
     ├── LLM 网关  integrations/llm.js：OpenAI 兼容 LLM 调用，key 只留服务端
     ├── 数据查询  integrations/data-query.js：可配置数据查询适配器，白名单只读 SELECT
     ├── 三个人设  prompts/twin.js + prompts/data-agent.js + prompts/style-agent.js
     └── 任务存储  domain/store.js：tasks/{tid}/ 文件为唯一真相源
     ▼
LLM 网关（OpenAI 兼容）  +  数据查询适配器（默认演示模式，可接入真实数据源）
```

---

## 环境要求

- **Node.js >= 18**（用到内置 `fetch`，纯 ES modules，**无需 `npm install`**）
- **任一 OpenAI 兼容的 LLM API key**（OpenAI / DeepSeek / Together / 自建 vLLM 等）
- **数据查询后端**（可选；默认演示模式返回示例数据，编排始终可运行）

---

## 快速开始

### 1. 克隆并准备配置

```bash
git clone https://github.com/skydream9527-ctrl/MagicTwin.git
cd MagicTwin

# 复制环境变量示例，填入你的 LLM key
cp .env.example .env
# 编辑 .env，至少设置 LLM_API_KEY=sk-...

# 复制 Twin 用户画像示例（profile.md 已在 .gitignore，绝不提交）
cp workspace/users/u_local/twin/profile.example.md \
   workspace/users/u_local/twin/profile.md
# 编辑 profile.md，填入你自己的画像（Twin 据此代表你做低风险决策）
```

### 2. 启动

```bash
npm start
# 或：node server/index.js
```

> 启动后若提示 `[twin] 未找到 profile.md，已回退到 profile.example.md`，说明你还没创建自己的画像，Twin 会用示例画像代答——仍可运行，但代答质量取决于画像准确度。

访问 http://localhost:8787 ，在启动屏输入一个数据分析目标（例如「看看最近一周消费时长有没有异常，帮我定位下」），为 Twin、数据 Agent 和样式 Agent 各选一个模型，点「交给 Twin」即可旁观整个协作过程。过程中你随时可以在底部 @ 某个 Agent 插话，或点右上「💬 问 Twin」私聊分身问进度。

---

## 配置 LLM key

服务端按以下顺序查找 key（需匹配 `sk-...` 格式，见 [`server/integrations/llm.js`](./server/integrations/llm.js)）：

1. 环境变量 `LLM_API_KEY`
2. `~/.config/magictwin/credentials`（形如 `export LLM_API_KEY=sk-...`）

任一命中即可。启动后 `GET /api/health` 会返回 `hasKey` 状态。

### 接入其他 OpenAI 兼容 LLM（OpenAI / DeepSeek / 自建 vLLM 等）

通过 `LLM_BASE_URL` 环境变量切换到任意 OpenAI 兼容端点：

```bash
# .env 中设置
LLM_BASE_URL=https://api.openai.com/v1   # 或 DeepSeek / Together / 自建 vLLM 等
LLM_API_KEY=sk-...
```

model 参数格式取决于你的网关：OpenAI 原生用 `gpt-4o`，支持 `{owner}/{id}` 的网关用 `openai/gpt-4o`。详见 [`server/integrations/llm.js`](./server/integrations/llm.js)。

### 配置数据查询（可选）

默认 `sample` 演示模式返回示例数据，编排始终可运行。接入真实数据源有两种方式：

**方式一：命令行适配器**

设 `QUERY_BACKEND=command` + `QUERY_COMMAND="your-cli {sql}"`，your-cli 需输出 JSON：
```json
{"columns": [{"name": "date", "type": "int"}, ...], "rows": [[20260701, ...], ...]}
```

```bash
# .env 中设置
QUERY_BACKEND=command
QUERY_COMMAND="python3 my-query-tool.py {sql}"
```

**方式二：直接改代码**

在 [`server/integrations/data-query.js`](./server/integrations/data-query.js) 中实现你自己的 backend。

> 安全底线：查询工具做了白名单，**只允许 `SELECT` / `WITH...SELECT`**，硬拒 DDL/DML/多语句（见 `validateSelectOnly`）。

---

## 可配置的环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8787` | HTTP 服务端口 |
| `TWIN_MODEL` | `gpt-4o` | Twin 使用的模型 |
| `DATA_MODEL` | `gpt-4o` | 数据 Agent 使用的模型 |
| `STYLE_MODEL` | `gpt-4o` | 样式优化 Agent 使用的模型 |
| `MAX_TOKENS` | `4000` | 单次生成 token 上限 |
| `MAX_STEPS` | `28` | Twin+Data+Style 单个用户回合内的往返上限（每次用户插话重置） |
| `LLM_API_KEY` | — | LLM key（最高优先级） |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | OpenAI 兼容端点 |
| `LLM_TIMEOUT_MS` | `1800000` | LLM 单次调用超时（毫秒） |
| `QUERY_BACKEND` | `sample` | 数据查询后端（`sample` / `command`） |
| `QUERY_COMMAND` | — | 命令行适配器的查询命令（`QUERY_BACKEND=command` 时必填） |
| `QUERY_ROW_LIMIT` | `2000` | 单条查询返回行上限 |

模型选型实测参考见 [`server/config.js`](./server/config.js) 顶部注释。

---

## HTTP API

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/health` | 返回 `{hasKey, models, dataQuery}`（models 含 twin/data/style 默认值） |
| `GET` | `/api/models` | 返回 `{recommended, all, defaults}`，供前端为三个 Agent 选模型 |
| `GET` | `/api/tasks` | 历史任务列表（可回溯） |
| `POST` | `/api/task` | 创建任务 `{goal, twinModel?, dataModel?, styleModel?}` → `{tid}` |
| `GET` | `/api/task/:tid` | 返回 `{meta, events, decisions, thinking}`（回放/审计/思考） |
| `GET` | `/api/task/:tid/stream` | SSE：连接即启动编排，实时推事件 |
| `POST` | `/api/task/:tid/reply` | 回复 Twin 升级上来的高风险问题 `{text}`（作为一条 reply 注入 Twin） |
| `POST` | `/api/task/:tid/inject` | 用户在主对话区 @ 某方插话 `{to, text}`（`to` = `twin`/`data`/`style`） |
| `POST` | `/api/task/:tid/inquiry` | 「与 Twin 私聊」侧栏问进度 `{question}` → `{answer}`（走 side 频道，不打断主编排） |

---

## 编排状态机

见 [`server/engine/orchestrator.js`](./server/engine/orchestrator.js)。多个 Agent 交替发言，每次只输出一个 JSON 对象；`turn` 表示下一个发言者，`null` 表示空闲等待用户：

- **turn = twin**：`assign`（派活）/ `answer`（代答确认项）/ `rework`（打回）→ 交给数据 Agent；`beautify`（转排版）→ 交给样式 Agent；`deliver`（交付，转空闲）/ `escalate`（升级问用户，转空闲）→ 面向用户。
- **turn = data**：`query`（提交真实 SQL，结果回喂后继续）/ `ask`（抛确认项给 Twin）/ `report`（把结论交回 Twin 验收）。
- **turn = style**：`styled`（把排版稿交回 Twin）。
- **turn = null**：空闲；挂起等待用户 @ 插话（`/inject`）或回复升级问题（`/reply`）后恢复。

用户插话路由：用户可 @ `twin`/`data`/`style` 任一方；数据 / 样式 Agent 只能交回 Twin。侧栏 `/inquiry` 与主编排解耦，Twin 只读当前进度用自然语言口语作答。

安全阀：单个用户回合内 Agent↔Agent 往返受 `MAX_STEPS` 限制（每次用户插话重置）；LLM 输出做容错 JSON 解析 + 多次「只输出 JSON」重试（加大 token、逐步降温）。

---

## 任务空间（文件为唯一真相源）

每个任务持久化到 `tasks/{tid}/`（该目录已在 `.gitignore` 中，不纳入版本控制）：

```
tasks/{tid}/
  meta.json           # {tid, goal, status, createdAt, updatedAt, models, seq}
  conversation.jsonl  # 用户⇄Twin、Twin⇄数据/样式 Agent 全部事件（含确认项如何被代答、侧栏私聊）
  decisions.jsonl     # 「我替你做的决定」清单
  thinking.jsonl      # 每次 LLM 调用的 reasoning + 原始输出（供产物页回看）
  sql/T{n}_*.sql      # 每条真实执行过的 SQL 原文
  data/T{n}_*.json    # 数据查询返回的真实结果
  STATE.md            # 人类可读的状态快照
```

任务状态：`执行中 / 待确认 / 已交付 / 报错 / 已暂停`。

---

## 每日进化（自动经验归纳）

Agent 每天会自动归纳当天对话中的经验与易错点，写入 `memory/LEARNINGS.md`，运行时注入 system prompt，使 Agent 逐步变聪明：

```bash
# 手动触发（归纳今天）
npm run evolve

# 归纳指定日期
node server/jobs/evolve.js 2026-07-08
```

也可通过 `EVOLVE_HOUR` 环境变量配置自动触发时间（默认 23 点）。`LEARNINGS.md` 是纯 Markdown，可随时人工编辑覆盖。详见 [`server/engine/evolve.js`](./server/engine/evolve.js)。

---

## 目录结构

```
.
├── server/
│   ├── index.js                 # HTTP 服务启动入口
│   ├── config.js                # 集中配置（模型、数据查询、安全阀）
│   ├── http/                    # 路由 / 静态前端 / SSE 运行时与插话队列
│   ├── engine/orchestrator.js   # Twin ⇄ 数据 Agent ⇄ 样式 Agent 编排引擎
│   ├── integrations/            # llm（LLM 网关） · data-query（数据查询适配器）
│   ├── domain/                  # roster 花名册 · agents 详情 · store 任务空间存储
│   └── prompts/                # 三个 Agent 的 system prompt 加载器（读 workspace 下的 agent.md）
├── web/                         # 工作空间主界面（原生 HTML/CSS/JS，零构建，SSE）
├── workspace/
│   ├── agents/
│   │   ├── data-analysis/       # 数据分析 Agent（人设 + 知识 + 8 范式 + SOP）
│   │   ├── style-optimizer/     # 样式优化 Agent
│   │   ├── general/             # 通用 Agent（入口编排者）
│   │   ├── code-runner/         # 代码执行 Agent（Python 沙箱）
│   │   ├── report-writer/       # 报告撰写 Agent
│   │   └── data-monitor/        # 数据监控 Agent
│   └── users/u_local/twin/      # Twin 操作手册（agent.md）+ 用户画像（profile.md gitignore / profile.example.md）
├── docs/                        # 设计理念与构想
├── .github/                     # Issue / PR 模板、dependabot
├── .env.example                 # 环境变量示例
├── LICENSE                      # MIT
├── CONTRIBUTING.md              # 贡献指南
├── CODE_OF_CONDUCT.md           # 行为准则
└── package.json
```

---

## 路线图

**v1（已实现）**

- 真 LLM 三人设 + 真实 Twin ⇄ 数据 Agent ⇄ 样式 Agent 有界协作闭环
- 可配置数据查询（默认演示模式，可接入真实数据源）
- 确认项代答 / 打回 / 升级 / 排版 / 交付 + 「我替你做的决定」清单
- 用户随时 @ 任一 Agent 插话、侧栏私聊 Twin 问进度
- 状态优先工作空间 UI + 文件为真相源的全程可回溯（含 Agent 思考过程回看）

**二期（规划中）**

- 扩展 Agent 编排集成（通用 Agent 路由 / Python 沙箱 / 报告生成 / 指标监控）
- 数据源适配器抽象（DuckDB / SQLite / 自定义）
- 记忆晋升、多任务看板等平台级能力

欢迎在 [Issues](../../issues) 提需求或认领实现。

---

## 安全说明

- **LLM key 只在服务端解析与使用**，不下发到浏览器。
- **取数白名单只读**：从工具层杜绝写操作（`SELECT` / `WITH...SELECT` only）。
- **用户画像绝不进 Git**：`workspace/users/u_local/twin/profile.md` 已在 `.gitignore`，请勿 `git add -f`。
- `tasks/`、`node_modules/`、`.env` 等已在 `.gitignore` 中，不进版本库。

发现安全漏洞请**不要在公开 Issue 暴露**，直接联系维护者。

---

## 贡献

欢迎提 Issue、PR、写适配器、改进文档。请先阅读：

- [贡献指南](./CONTRIBUTING.md)
- [行为准则](./CODE_OF_CONDUCT.md)

---

## 许可证

[MIT License](./LICENSE) · Copyright (c) 2026 MagicTwin Contributors
