# MagicTwin · 数字分身驱动的多 Agent 协作工作空间

> **Twin（数字分身）代替你，去驱动真实的数据分析 Agent 与样式优化 Agent 把活干完**——真连 LLM 与数据平台查真实数据、真跑分析；Twin 替你回答过程中的确认项、验收产出、必要时打回重做，最后把结论交付给你。全程可旁观、可回溯、可随时接管。
>
> *A digital-twin-driven multi-agent workspace: your Twin orchestrates a real data-analysis agent and a style-polish agent on your behalf — answering confirmation gates, reviewing deliverables, escalating only the high-risk calls back to you. Watch, replay, or jump in anytime.*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](./package.json)
[![Zero Deps](https://img.shields.io/badge/dependencies-0-blue.svg)](#)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

这是「User → Twin → Agents」主链路的一个**可运行切片**。完整设计见 [`docs/vision.md`](./docs/vision.md)，设计哲学见 [`docs/design-principles.md`](./docs/design-principles.md)，2.0 上下文隔离与引用的 PRD 见 [`docs/PRD-context-isolation.md`](./docs/PRD-context-isolation.md)。

---

## 核心看点

多方角色在**同一个对话区**里协作：

| 角色 | kind | 定位 | 职责 | 边界 |
|---|---|---|---|---|
| **用户（你）** | — | 目标设定者 & 最终验收人 | 给目标、随时审阅、拍板被升级上来的高风险决策；可随时 @ 插话或私聊 Twin | 不盯每一步 |
| **Twin（数字分身）** | `twin`（特权） | 用户的代理人 / 唯一编排者 | 理解意图、派活、**替用户回答确认项**、验收、打回、交付 | 只提议不越权；高风险回来问用户；不写 SQL、不查数、不排版 |
| **数据分析 Agent** | `tool` | 干活的数据专家 | 命题澄清 → NL→SQL → **真实查数** → 分析 → 归因 → 出结论 | 甲方是 Twin 而非用户本人；不替用户拍板；只读查询 |
| **样式优化 Agent** | `tool` | 报告编辑 | 把数据 Agent 的结论排版成可直接交付的报告 | 不查数、不改数字；只交回 Twin |
| **通用 Agent** | `tool` | 入口编排者 | 判断意图、路由到合适的子 Agent，简单问题自己处理 | 数据类结论必须基于子 Agent 真实结果 |
| **代码执行 Agent** | `tool` | Python 沙箱 | 跑 pandas/sklearn/prophet 做 STL、变点检测、预测、出图 | 只在沙箱执行；不替用户做决策 |
| **报告撰写 Agent** | `tool` | 报告生成 | 基于数据产出周报 / 总结 / 项目复盘 | 不查数、不改结论 |
| **数据监控 Agent** | `tool` | 指标监控 | 定时 SQL 检测异常、超阈值触发告警 | 只监控告警、不修复 |

> 花名册在 `server/domain/roster.js` 中登记，编排引擎 / prompt 加载器 / 前端 UI 全部从花名册派生——**新增 Agent 只需两步**：放一份 `agent.md` + 在花名册登记一条元信息。

关键看点：所有工具 Agent 面对的「甲方」都是 Twin 而非用户本人。大部分确认门被 Twin 自动扛下，用户没被打扰，但**每个代答都留痕可查**。

---

## 为什么需要 Twin：多 Agent 同台的秩序与信任中枢

### 为什么需要「多个」Agent：能力的必要

一个「什么都会」的全能 Agent 在真实业务里撑不住：

- **上下文会爆**：把所有表 / 口径 / SOP 塞进一个 prompt，既超长又互相干扰。
- **人设会打架**：「严谨的 SQL 分析师」和「会排版的报告编辑」是两种表达风格，混在一个 Agent 里两头不讨好。
- **难维护、难进化**：全能 Agent 改一处牵一发；拆成专精 Agent 后，每个只装自己域的 `agent.md` + `knowledge/`，可**独立调优、独立进化、独立替换**。

本项目走**专业化分工**：花名册 `roster.js` 登记了 7 个 Agent（3 核心 + 4 扩展），各有专长。**新增一个只需两步**：放一份 `agent.md` + 在花名册登记一条元信息——编排引擎、prompt 加载器、前端 UI 全部从花名册自动派生，无需改任何分支代码。

### 为什么必须在「同一个空间」：协同的必要

放进**同一个工作空间 / 同一个对话区**才成立：

- **共享上下文**：目标、已确认口径、已查数据跨 Agent 直接可见。
- **共享真相源**：`conversation.jsonl` / `decisions.jsonl` / `sql/` / `data/` 都落在同一任务空间，谁产生谁都能读、可回溯。
- **用户可旁观、可插手**：所有多方对话在一个主对话区里 SSE 流式呈现。
- **统一的记忆与进化**：各 Agent 历史镜像回各自 `memory/`，进化素材同源。

### 但「多 Agent 同台」会立刻带来新麻烦

多个 Agent 挤在一个空间里，如果没有主心骨，会退化成一团乱：

- **群龙无首**：谁跟用户对话？谁决定下一步？
- **确认项风暴**：每个 Agent 都会抛确认项，若全弹给用户，用户瞬间被淹没。
- **自由对话失控**：若放任 Agent 之间自由聊，容易跑题、成环、烧 token。
- **异构人设各说各话**：每个 Agent 的 `agent.md` 原本面向不同运行时，提到的工具可能在本空间根本不存在。

### Twin 的核心价值：让「多 Agent 同台」从混乱变有序

上面四个麻烦，恰好对应 Twin 的四项特权——**Twin 就是多 Agent 空间里的秩序与信任中枢**：

1. **唯一编排者（定序、防跑飞）**：星型拓扑，Twin 是唯一 leader，工具 Agent 只对 Twin 汇报、彼此不直接对话。配合 `maxSteps` 有界多轮，防环、防跑飞、有人负责。
2. **代答缓冲层（挡住确认项风暴）**：所有 Agent 的确认门先汇到 Twin，低风险由 Twin 代答扛下，只有真正高风险才升级给用户。**这是多 Agent 场景下用户不被淹没的唯一办法**。
3. **质量守门人（验收把关）**：工具 Agent 产出先过 Twin 挑剔验收——有硬伤就打回重做，通过才转下一环或交付。
4. **信任中枢（可追溯）**：Twin 把跨多个 Agent 做过的判断，汇成一份「我替你做的决定」清单交付给用户，每条带理由。

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
     │  SSE 流式：实时推送 Twin / 各工具 Agent 的对话与工具调用
     │  用户可在主区 @ 插话（/inject），或在侧栏私聊 Twin 问进度（/inquiry）
     ▼
本地 Node.js 服务（server/index.js，零第三方依赖）
     ├── 编排引擎  engine/orchestrator.js：驱动 Twin ⇄ 工具 Agent 有界多轮 + 用户插话（花名册驱动，支持任意数量 Agent）
     ├── LLM 网关  integrations/llm.js：OpenAI 兼容 LLM 调用，key 只留服务端
     ├── 数据查询  integrations/data-query.js：可配置数据查询适配器，白名单只读 SELECT
     ├── 代码沙箱  integrations/sandbox.js：Python 子进程沙箱（默认禁用，SANDBOX_ENABLED=1 开启）
     ├── Prompt 层  prompts/twin.js（Twin 专用）+ prompts/generic.js（通用工具 Agent，从花名册自动派生）+ prompts/protocol.js（统一协作协议）
     └── 任务存储  domain/store.js：tasks/{tid}/ 文件为唯一真相源
     ▼
LLM 网关（OpenAI 兼容）  +  数据查询适配器（默认演示模式，可接入真实数据源）  +  Python 沙箱（可选）
```

---

## 核心机制（本项目的灵魂）

### Twin 唯一编排 + 有界多轮

不是「用户问、Agent 答」，而是 **Twin 站在用户立场**驱动工具 Agent、逐步验收。三个要点：

- **星型拓扑，Twin 是唯一 leader**：工具 Agent **只对 Twin 汇报**，Agent 之间不直接对话。工具 Agent 的产出（`ask`/`report`/`styled`）一律把 `turn` 交回 `twin`。
- **有界**：单个用户回合内 Agent↔Agent 往返受 `maxSteps`（默认 28）限制，防跑飞 / 防环；每次用户插话**重置** `steps`。
- **一次一个 JSON 动作**：每个 Agent 每回合只输出一个 JSON 对象，`type` 决定分支、`target` 决定下一个发言者。

### 确认项：SOP 确认门 → Twin 代答（本项目的灵魂）

工具 Agent 的 SOP 本就要求「阶段之间用户确认」——命题澄清、口径校对、是否下钻……这些**确认门天然就是「确认项」**。它以 `ask` 动作抛给 Twin，Twin 再决定代答还是升级：

- **低风险**（用哪个口径、下钻哪个维度、SELECT 校对）→ Twin 基于用户画像 + 口径缺省**直接代答**（`answer`），任务不被打断，并写入「我替你做的决定」清单。
- **高风险 / 拿不准**（超出用户目标范围、可能很贵的全量扫描、涉及写 / 外发）→ Twin **升级回来问用户**（`escalate`），置「待确认」并转空闲，等 `/reply`。

### Twin 的人格：四份文件拼出来

最核心的设计取舍：**不把分身的人格焊死在代码里，而是全部外化成用户空间里可读、可 diff、可人工审阅的文件**。Twin 每次开口前，`prompts/twin.js` 把四样东西现场拼成 system prompt：

```
workspace/users/u_local/twin/
├── agent.md            操作手册 + JSON 输出协议（含运行时占位符）
│   ├── {{PROFILE}}   ← 注入 profile.md（我代表谁）
│   ├── {{KNOWLEDGE}} ← 注入 knowledge/ 的 required 文件（我凭什么替他拍板）
│   └── {{AGENTS}}    ← 注入当前可调度团队清单（我能指挥谁）
├── profile.md          用户画像（从 .gitignore，绝不提交）
├── knowledge/          结构化知识库（业务常识 / 口径缺省 / 代答手册 / 风险矩阵 / 验收清单）
└── memory/LEARNINGS.md 每日进化沉淀（有则追加注入）
```

**这么设计的好处**：分身「是谁、怎么想、替谁做主、能指挥谁」全部是**数据不是代码**——可读、可 diff、可人工审阅、可随源文档更新覆盖，还能被每日进化增量演进。换一个用户，只要换 `profile.md` + 调 `knowledge/`，同一套代码就能长出另一个分身。

### 真实取数：NL→SQL→数据查询适配器→真实数据

工具 Agent 的 `query` 是**真工具**：编排引擎收到 `query` 后调 `integrations/data-query.js`，执行真实 SELECT，把结果**回喂**给 Agent 继续下一轮。SQL 由各业务线取数知识（表 / 列 / 口径）生成，且经 `validateSelectOnly` 只读校验。

### 任务交付 + 「我替你做的决定」清单

完成后 Twin `deliver`：结论摘要（人话）+ 关键数字 + **「我替你做的决定」清单**（把代答过的确认项和理由逐条列出）+ 下一步建议。那份决定清单是建立信任的关键——让用户一眼看到「分身替我扛了哪些判断、为什么」。

### 统一协作协议：让异构 Agent 同台的粘合层

Twin 能指挥这些「来源各异」的 Agent，靠的是运行时统一注入的**协作协议**（`prompts/protocol.js`，由 `prompts/generic.js` 自动追加到每个工具 Agent 的 system prompt）：

- 把每个工具 Agent 对外行为**收敛到统一动作集** `ask / query / execute / report`（`query` 仅对声明了 `query` capability 的 Agent 开放，`execute` 仅对声明了 `execute` capability 的 Agent 开放）；
- 明确声明「**只对 Twin 汇报**」，且 `agent.md` 里那些本空间没有的工具**一律不可调用**，需要它们才能完成的步骤作为建议写进 `report` 交 Twin 定夺；
- 于是即便一个 Agent 的手册写着一堆本地没有的工具，也能被「收敛」到本 Demo 真实可执行的动作上，在同一个对话区里正确协作。

**花名册驱动**：`prompts/generic.js` 的 `buildToolSystem(key)` 是所有工具 Agent 的通用加载器——读 `agent.md` → 替换 `{{KNOWLEDGE_*}}` 占位符 → 追加统一协作协议（按 capability 动态追加 query/execute 段）→ 追加每日进化经验。新增任何 Agent 无需写专用加载器。

### 用户随时接管：@ 插话 + 回复升级 + 侧栏私聊

三条通道让用户「布置完就走开」的同时又能随时回来接管：

- **@ 插话（`/inject`）**：用户在主对话区 @ `twin` 或任一工具 Agent 补充要求 / 纠偏。入队并唤醒挂起的编排，每回合开头取出路由到目标，**重置步数预算**。
- **回复升级（`/reply`）**：Twin `escalate` 后，用户回复作为一条 reply 注入 Twin，唤醒挂起的编排恢复运行。
- **侧栏私聊（`/inquiry`）**：与主编排**解耦**的 side 频道，Twin 只读当前进度、用自然语言口语作答（不走 JSON 协议、不打断主流程）。

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
| `GET` | `/api/health` | 返回 `{hasKey, models, dataQuery, sandbox}`（models 为花名册中所有 Agent 的默认模型） |
| `GET` | `/api/models` | 返回 `{recommended, all, defaults}`，供前端为所有 Agent 选模型 |
| `GET` | `/api/agents` | 返回 Agent 花名册概览列表 |
| `GET` | `/api/agent/:key` | 返回单个 Agent 详情 + 关联文件（agent.md / knowledge / memory） |
| `GET` | `/api/agent-config` | 读当前模型配置（跨任务记忆） |
| `POST` | `/api/agent-config` | 保存模型配置（任意花名册中登记的 Agent 均可） |
| `GET` | `/api/tasks` | 历史任务列表（可回溯） |
| `POST` | `/api/task` | 创建任务 `{goal, models?: {...}, twinModel?, dataModel?, styleModel?}` → `{tid}`（推荐传 `models` 对象支持任意 Agent；旧字段向后兼容） |
| `GET` | `/api/task/:tid` | 返回 `{meta, events, decisions, thinking}`（回放/审计/思考） |
| `GET` | `/api/task/:tid/stream` | SSE：连接即启动编排，实时推事件 |
| `POST` | `/api/task/:tid/reply` | 回复 Twin 升级上来的高风险问题 `{text}`（作为一条 reply 注入 Twin） |
| `POST` | `/api/task/:tid/inject` | 用户在主对话区 @ 某方插话 `{to, text}`（`to` 为任意花名册登记的 Agent key） |
| `POST` | `/api/task/:tid/inquiry` | 「与 Twin 私聊」侧栏问进度 `{question}` → `{answer}`（走 side 频道，不打断主编排） |

---

## 编排状态机

见 [`server/engine/orchestrator.js`](./server/engine/orchestrator.js)。多个 Agent 交替发言，每次只输出一个 JSON 对象；`turn` 表示下一个发言者，`null` 表示空闲等待用户：

- **turn = twin**：`assign`（派活给任一工具 Agent）/ `answer`（代答确认项）/ `rework`（打回重做）/ `beautify`（转排版）/ `deliver`（交付，转空闲）/ `escalate`（升级问用户，转空闲）/ `delegate`（指派通用 Agent 进一步分解路由）/ `request-execute`（请求代码沙箱执行）→ 交给对应工具 Agent。
- **turn = <tool>（任一工具 Agent）**：
  - 有 `query` capability：`query`（提交真实 SQL，结果回喂后继续）/ `ask`（抛确认项给 Twin）/ `report`（把结论交回 Twin 验收）
  - 有 `execute` capability：`execute`（提交代码到沙箱，结果回喂后继续）/ `ask` / `report`
  - 其它 Agent：`ask`（提确认项）/ `report`（阶段性/最终结论）；样式 Agent 专属 `styled`（排版稿交回 Twin）
- **turn = null**：空闲；挂起等待用户 @ 插话（`/inject`）或回复升级问题（`/reply`）后恢复。

用户插话路由：用户可 @ 任意花名册登记的 Agent（twin 或任一 tool）；所有工具 Agent 只能交回 Twin（星型拓扑）。侧栏 `/inquiry` 与主编排解耦，Twin 只读当前进度用自然语言口语作答。

安全阀：单个用户回合内 Agent↔Agent 往返受 `MAX_STEPS` 限制（每次用户插话重置）；LLM 输出做容错 JSON 解析 + 多次「只输出 JSON」重试（加大 token、逐步降温）；调用异常做退避重试，彻底失败时优雅挂起而非整体崩溃。

---

## 四层空间（隔离与复用的刻意张力）

工作空间 `workspace/` 是四层空间，每层有明确归属、生命周期与隔离边界：

```
workspace/
├── users/{uid}/       用户空间：Twin 画像 + 长期记忆（私有，默认仅本人及本人 Twin 可读）
├── agents/{key}/      Agent 空间：手册 / 技能团队共享，情景记忆按用户分区
├── teams/{tid}/…      团队/项目空间：共享文件 / 知识 / 产物（按 Team 或 Project 隔离）[2.0 · 见下方路线图]
└── tasks/{tid}/       任务空间：对话 / 文件 / 过程记忆（仅参与者可读，不跨任务）
```

**设计原则**：用空间把隔离做成结构性的默认，把复用做成显式的、可审计的动作。隔离与复用的张力是刻意设计的——既不串味，又能跨任务 / 跨用户复用经验。

> v1 已落地前两层 + 任务空间；2.0 要把"默认隔离、显式复用"做成真隔离，并新增团队空间。详见下方 [2.0 路线图 · 上下文隔离与引用](#20-路线图--上下文隔离与引用)。

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

几个关键设计：

- **事件溯源、append-only**：`appendEvent` 给每条事件回填自增 `seq` + `ts`，只追加不修改。整个任务的状态可以由 `conversation.jsonl` **重放**出来——这也是断点续跑能成立的前提。
- **思考过程也存档**：不止存 Agent「说了什么」，还存它「怎么想的」。`thinking.jsonl` 里 `reasoning` 是推理模型吐出的思维链、`raw` 是未解析的原始输出、`attempts` 是 JSON 解析重试次数、`usage` 是 token 消耗。前端「过程产物页」可逐条回看，把黑盒变白盒。
- **跨任务镜像到 Agent 记忆**：`store.mirrorToAgent` 会把每个 Agent 自己产生的对话与思考，同步镜像一份到它所属空间的 `memory/dialogue.jsonl` 与 `memory/thinking.jsonl`（并带上来源 `tid`）。于是每个 Agent 都有一份**跨任务的历史**——既供人回看，也是**每日进化的原料**。
- **文件为唯一真相源**：所有日志都是纯文本 / JSONL，可 `diff`、可 `grep`、可备份、可版本控制，退回文件永远有确定性底线。

## 每日进化（自动经验归纳）

Agent 每天会自动归纳当天对话中的经验与易错点，写入 `memory/LEARNINGS.md`，运行时注入 system prompt，使 Agent 逐步变聪明：

```bash
# 手动触发（归纳今天）
npm run evolve

# 归纳指定日期
node server/jobs/evolve.js 2026-07-08
```

也可通过 `EVOLVE_HOUR` 环境变量配置自动触发时间（默认 23 点）。`LEARNINGS.md` 是纯 Markdown，可随时人工编辑覆盖。详见 [`server/engine/evolve.js`](./server/engine/evolve.js)。

设计取舍（对齐「记忆晋升需审阅、不盲写核心手册」）：只自动更新独立的 `LEARNINGS.md`（附加手册），核心 `agent.md` 保持稳定；把某条经验晋升进 `agent.md` 属于人工审阅动作。

---

## 容错与断点续跑（不崩、可续）

真实链路里 LLM 会抖动、会超时、会吐出不合法 JSON，数据查询会失败。工作机制的底线是**不让这些把整个任务打断**：

- **`callAgent` 从不向上抛异常**：彻底失败也只返回 `{json:null, error}`，让编排**优雅挂起**而非崩溃断线。
- **容错 JSON 解析**：`parseAgentJson` 容忍 ```` ```json ```` 包裹、尾逗号、前后夹带文字（截取首尾花括号）。
- **多次重试**：解析失败时追加「只输出 JSON」提示重试，逐步加大 token（+1500）、降温（0.3→0.1→0）。
- **调用异常退避**：超时最多重试 1 次；网络 / 5xx / 429 线性退避；客户端错误（鉴权 / 模型不存在）不重试。
- **断点续跑**：服务重启后重连，从 `conversation.jsonl` **重建**各 Agent 上下文与「下一个发言者」，从当前进度继续（仅对「执行中 / 已暂停」的任务），终态只回放。

---

## 端到端演示脚本

1. **用户 → Twin**：「看看最近一周核心指标有没有异常，帮我定位下，下班前给结论。」然后**走开**。
2. **Twin** 复述并锁定命题（对齐 SOP Phase 1），`assign` 派给数据 Agent。
3. **数据 Agent（`ask` 确认门）**：确认时间口径 / 主表 / 指标口径。
4. **Twin（`answer`）代答**（不打扰用户）：「对；按自然日、该口径；日期分区用 `date` 整型过滤。」并写入决定清单。
5. **数据 Agent（`query`）→ 真实查询**（SELECT，真数据返回），给出趋势 + 环比。
6. **数据 Agent（`ask` 确认门）**：环比 -9% 触发阈值，「需要按维度下钻归因吗？」
7. **Twin**：「要，按 `dimension_x` 下钻 Top 变化。」→ 数据 Agent 再查一条真实 SQL。
8. **数据 Agent（`report`）→ Twin 验收**：数据自洽、口径一致，通过 → `beautify` 转样式 Agent。
9. **样式 Agent（`styled`）→ Twin**：标题 + TL;DR + 分节 + 高亮。
10. **Twin（`deliver`）→ 用户**：结论 + 「我替你做的决定」清单 + 下一步建议。
11. **用户**回来看交付；点开产物页能回看全部对话、真实 SQL 与真实结果、Agent 思考过程。

> 高光：3–8 步真实查了两次数据、Twin 代答了 3 个确认门，**全程没打扰用户**，但一切可回溯。

---

## 目录结构

```
.
├── server/
│   ├── index.js                 # HTTP 服务启动入口
│   ├── config.js                # 集中配置（模型、数据查询、安全阀）
│   ├── http/                    # 路由 / 静态前端 / SSE 运行时与插话队列
│   ├── engine/orchestrator.js   # Twin ⇄ 各工具 Agent 编排引擎（花名册驱动，支持任意数量 Agent）
│   ├── integrations/            # llm（LLM 网关） · data-query（数据查询适配器） · sandbox（Python 沙箱，可选）
│   ├── domain/                  # roster 花名册 · agents 详情 · store 任务空间存储
│   └── prompts/                # twin（Twin 专用加载器）+ generic（通用工具 Agent 加载器，花名册驱动）+ protocol（统一协作协议）
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

## 2.0 路线图 · 上下文隔离与引用

> 完整设计见 [`docs/PRD-context-isolation.md`](./docs/PRD-context-isolation.md)。

v1 已跑通「单用户 + 单任务」的协作闭环。2.0 要把"**默认隔离、显式复用**"做成真隔离，并解决"**跨任务、跨用户、跨团队**"的上下文沉淀与复用——也就是把"**上下文隔离**"和"**上下文引用**"两条竖起来。核心是五件事：隔离矩阵、记忆按用户分区、候选→审批→晋升闭环、按需引用（经验包）、口径失效。

### 设计原则（对齐 design-principles.md）

| # | 原则 | 落地 |
|---|---|---|
| 1 | 默认隔离、显式复用 | 所有上下文默认锁在自己空间；跨空间引用必须走可审计的显式动作 |
| 2 | 文件为真相源 | 经验包 / 记忆 / 候选全部落文件（`.md` / `.yaml` / `.jsonl`），索引可重建 |
| 3 | 检索先过滤后排序 | 检索候选集先按访问边界 + 失效状态过滤，再按相关性排序（防越权注入） |
| 4 | 晋升有闸门 | 跨层记忆一律走「候选 → 审批 → 原子晋升」，绝不直接跨层写 |
| 5 | 保守灰度、关时零行为变化 | 每个 2.0 能力用 `IDW_*_ENABLED` 开关，默认关，关时 v1 行为逐字不变 |

### 空间模型（引入 uid / 团队维度）

在 v1 目录基础上补齐分区与团队层：

```
workspace/
├── users/{uid}/
│   ├── twin/                          用户空间：Twin 画像 + 长期记忆（私有）
│   └── experience/                    ← 2.0 新增：该用户私有的经验包库
├── agents/{aid}/
│   ├── agent.md  knowledge/  reference/   团队共享（不变）
│   └── memory/
│       ├── by-user/{uid}/             ← 2.0 改造：情景记忆按用户分区
│       └── by-team/{tid}/             ← 2.0 新增：显式"贡献给团队"才落这里
├── teams/{tid}/                       ← 2.0 新增：团队/项目空间
│   ├── knowledge/  experience/  memory/
│   └── members.yaml                   归属与成员（最小化，不做完整 RBAC）
├── skills/                           共享技能包（不变）
└── tasks/{tid}/
    ├── meta.json  conversation.jsonl  decisions.jsonl  thinking.jsonl  sql/  data/  STATE.md
    ├── memory/candidates.jsonl        ← 2.0 新增：记忆 / 经验包晋升候选
    ├── refs.jsonl                     ← 2.0 新增：本任务引用过哪些经验包 / 知识
    └── experience/{pid}/              ← 2.0 新增：引用副本（按指针展开）
```

**平滑演进**：v1 单用户 `u_local` 作为默认 `uid`；`IDW_MULTIUSER_ENABLED` 关闭时 `{uid}=u_local`、`by-user/u_local/` 等价于今天的 `memory/`，行为逐字不变。

### 隔离矩阵（谁能读 / 写哪层）

R=读，W=写，—=禁止，`审`=需审批晋升。

| 主体 \ 空间 | 任务空间 | Agent `by-user/{uid}` | Agent `by-team/{tid}` | 用户空间 | 团队空间 |
|---|---|---|---|---|---|
| **用户本人** | R/W（参与的） | R（自己相关的） | R | R/W（自己的） | R（所属团队） |
| **用户的 Twin** | R/W（参与的） | R | R | R/W（自己的） | R + 审（写需晋升） |
| **工具 Agent** | R/W（本任务内） | R/W（当前 uid 分区） | R + 审（贡献需晋升） | — | R（本任务关联的团队知识） |
| **管理员 admin** | 审计可见 | 审计可见 | 审计可见 + 审批晋升 | 审计可见 | R/W（含经验包 verified 审阅） |

**三条铁律**：

1. 任何主体不能直接写更高层空间——跨层长期记忆一律走候选→审批→晋升。
2. 检索先按边界过滤、再排序——从源头杜绝越权注入。
3. 内容隔离、审计可见——admin 因运维可见元数据 / 审计，但不读用户/任务私有内容；经验包晋升 / 复核是 admin 的显式职责。

### 记忆晋升闭环（候选 → 审批 → 晋升）

```
运行中  propose_memory(content, scope)      # scope: user_preference | agent_user | agent_team | project | team
   └─ 追加 tasks/{tid}/memory/candidates.jsonl（status=pending）
审批（按 scope 分派审批人）
   ├─ 通过：在一个"文件事务"里原子完成 { 写目标空间的 *.memory.md + 更新索引 + 候选标 approved }
   └─ 拒绝：候选标 rejected（留痕可复盘）
```

| scope | 落点 | 审批人 |
|---|---|---|
| `user_preference` | 用户长期偏好 `users/{uid}/` | 用户本人 |
| `agent_user` | Agent 的 `by-user/{uid}` 分区 | 自动（本任务内低风险）/ 用户本人 |
| `agent_team` / `team` / `project` | 团队 / 项目共享空间 | **管理员 admin** |
| 经验包 `draft → verified` | `experience/` | **管理员 admin** |

**与 `evolve.js` 的关系**：每日进化仍只自动写独立的 `LEARNINGS.md`（附加手册，限定在 `by-user/{uid}` 分区），核心 `agent.md` 稳定；跨用户 / 跨团队 / 经验包晋升必须走本闭环。

### 经验包（Experience Package）：上下文引用的核心载体

经验包 = 一次历史任务提炼出的、自包含的可复用知识单元。它回答的是"**上次遇到类似的活，是怎么干的、结论是什么、踩过什么坑**"——比 Skill 更细粒度，与 Skill 解耦。

```
{space}/experience/{pid}/
├── package.md          正文：需求背景 / 用到的数据源 / 分析过程 / 结论 / 教训（人可读、可 diff）
└── meta.yaml           结构化元信息（供关键词 + 标签检索）
```

`meta.yaml` 关键字段（草案）：

```yaml
pid: EXP-20260714-cc-consume-anomaly
title: 内容中心消费时长环比异动定位
scope: user                       # user | team | project（决定归属与可见边界）
owner_uid: u_local
source_tid: 20260708-153012-a1b2  # 蒸馏自哪个任务（可回溯）
business_lines: [CC]
task_type: 异动定位
metrics: [消费时长, 环比, 人均时长]
tags: [自然日, 体裁下钻, DID]
caliber:                          # 关键口径决定（可被 Twin 直接复用为代答依据）
  - 时间口径: 自然日
  - 消费时长: SUM(consum_duration_s)/60
sql_refs: [sql/T1_trend.sql, sql/T2_drilldown.sql]
conclusion: 近 7 天人均消费时长环比 -9%，主要拖累视频体裁（-14%）
lessons: [环比超阈值必须下钻到因, Push/有干扰实验必须用 DID]
# —— 口径失效相关 ——
caliber_sources: [twin/knowledge/playbook/caliber_defaults.yaml, agents/data-analysis/knowledge/business-lines/content-center.md]
caliber_hash: 9f2a1c…              # 蒸馏时口径来源文件的内容哈希（用于失效检测）
status: verified                   # draft | verified | stale | deprecated
```

**经验包 vs Skill**：

| 维度 | Skill（工具能力） | 经验包（案例知识） |
|---|---|---|
| 回答的问题 | "怎么做"（如何调 kyuubi / NL→SQL 映射） | "上次遇到类似的怎么做的" |
| 粒度 | 一类能力 | 一次任务 |
| 稳定性 | 稳定、少变 | 随任务持续增长 |
| 注入方式 | 相对固定（挂在具备该能力的 Agent 上） | **按需检索命中才注入** |
| 归属 | 团队 / 平台共享 | 用户私有为主，显式晋升到团队 |

**蒸馏时机**：任务 `deliver` 后自动生成 `status: draft` 候选（走候选闸门）；新增 `server/engine/distill.js`——读 `source_tid` 的 `decisions/sql/data/STATE`，用一次 LLM 调用生成 `package.md` + `meta.yaml`（LLM 失败退回确定性模板兜底），同时计算 `caliber_sources` / `caliber_hash`。

### 按需引用：Twin 主动 RAG + 指针引用

**关键设计**：经验包注入复用 v1 `compact.js` 已经验证的"**预览 + 指针**"范式——注入内容 = 结论 + 关键口径 + 教训（预览）+ 指针 `experience/{pid}`，而不是把整个 `package.md` 塞进 prompt。

```
buildContext({ agentKey, uid, tid, team, goal }) →
  1. 基础手册    : agent.md（本 Agent 空间）
  2. required 知识: knowledge/index.yaml 里 load_strategy=required 的文件（精简、稳定）
  3. 分区记忆    : memory/by-user/{uid}/LEARNINGS.md（当前用户分区）
  4. 按需引用    : 检索经验包 / on_demand 知识 ——★ 先按隔离矩阵过滤候选，再排序取 Top-K
  5. 组装        : 每一项都包成 { source:{space,path/pid,tid?}, title, body|pointer } 带来源标注
```

新增 `server/domain/context_assembler.js`，成为所有 system prompt 组装的统一入口（`prompts/*.js` 收敛到它）。

**关键顺序**：第 4 步**先过滤后排序**——只有当前 `uid` / `tid` 有权访问、且未失效（非 `stale`/`deprecated`）的经验包 / 记忆才进入候选集，再按相关性排序。即使检索命中了别人的私有经验包，也在过滤阶段被挡掉。

**新增 `cite` 动作**（附加到 `prompts/protocol.js` 的统一协作协议）：

```json
{ "thought":"1句", "type":"cite", "pid":"EXP-20260714-cc-consume-anomaly", "why":"本次也是CC消费时长异动，复用上次口径与下钻打法" }
```

编排引擎收到 `cite`：校验边界 + 校验未失效 → 命中则把该包"预览 + 指针"追加进目标 Agent 的 `agentMsgs`，并 `emit` 一条 `system/notice`（落 `conversation.jsonl` + SSE 推前端，前端渲染成"引用了经验包 X"的卡片）。

### 引用留痕（refs.jsonl）

任务空间新增 `tasks/{tid}/refs.jsonl`，每次引用记一条：

```json
{"ts":"...","by":"twin","type":"cite","pid":"EXP-...","source_tid":"2026...","why":"...","score":0.82,"stale":false}
```

前端"过程产物页"新增"**本任务引用了哪些经验包 / 知识**"区块，点开可跳到经验包与其源任务。这既是审计凭证，也是评估"哪些经验包最常被复用、值得晋升团队"的数据来源。

### 口径失效机制（不误用过期经验）

经验包 `status` 状态机：`draft → verified → stale → (verified | deprecated)`

**两道防线 + 一个状态机**：

1. **主动校准**（新增 `server/engine/calibrate.js`）：口径来源文件（`caliber_sources`）变更或每日定时 → 重算哈希与 `caliber_hash` 比对 → 不一致置 `stale` 并通知管理员复核。
2. **引用时惰性校验**：`cite` / 检索时发现命中包为 `stale`：默认不注入；若模型坚持引用则附带"⚠️ 该经验包口径可能已过期"警示，`refs.jsonl` 标 `stale:true`。
3. **管理员复核**：复核后仍有效 → 重新计算 `caliber_hash`、置回 `verified`；口径确已失效 → 触发重新蒸馏或标 `deprecated`（永久失效，仅审计保留）。

检索侧规则：`searchExperience` 候选过滤默认排除 `stale` / `deprecated`——把过期经验挡在注入之前。

### 里程碑（分阶段，保守灰度）

| 阶段 | 范围 | 关键交付 | 开关 |
|---|---|---|---|
| **M1 隔离地基** | uid 维度 + 记忆按用户分区 + 隔离矩阵 | `store.js` 分区改造、`meta.uid`、`context_assembler` 雏形 | `IDW_MULTIUSER_ENABLED` |
| **M2 引用通道** | `on_demand` 检索注入 + 来源标注 + `cite` 动作 | `experience.js`（关键词 + 标签检索）、`context_assembler` 第 4 步、`refs.jsonl` | `IDW_REF_ENABLED` |
| **M3 经验包闭环** | 蒸馏 + 管理员审阅 + 口径失效 | `distill.js`、`calibrate.js`、`candidates.jsonl`、审批入口、前端引用 / 失效区块 | `IDW_EXP_PKG_ENABLED` |
| **M4 团队空间** | `teams/{tid}` + 显式贡献晋升 | 团队经验库、`by-team` 记忆、跨层晋升事务 | `IDW_TEAM_ENABLED` |
| **M5 打磨演示** | 演示脚本 + 可迁移逻辑梳理 | "可演示的 PRD 概念" | — |

**2.0 首个可演示版建议至少交付 M1 + M2 + M3**：单用户下即可演示"从历史任务蒸馏经验包 → 管理员审阅 → 新任务按需引用 → 口径变更自动失效 → 全程可回溯"。

### 平台迁移（对齐会议共识②）

会议共识是"先内部验证，再迁 Mika / Chatflow"。本设计刻意让可复用逻辑与本地实现解耦：

- **经验包规格（`meta.yaml` + `package.md`）** 是纯数据契约，与存储实现无关——迁到平台时可映射到平台知识库 / RAG。
- **隔离矩阵 + 记忆晋升闭环 + 口径失效状态机** 是产品规则，与平台无关。
- **检索接口 `searchExperience()`** 是可注入接缝：本地用关键词 + 标签，迁移期可换平台 RAG / 向量，调用方不变。

---

## 路线图

**v1（已实现）**

- 真 LLM 三人设 + 真实 Twin ⇄ 数据 Agent ⇄ 样式 Agent 有界协作闭环
- **花名册驱动的多 Agent 编排**：新增 Agent 只需在 `roster.js` 登记一条 + 放一份 `agent.md`，编排引擎、前端 UI、模型配置自动可用（不再需要改 orchestrator/router/app.js 任何分支）
- **统一协作协议**：星型拓扑 + 收敛动作集 + 基于能力的访问控制（query / execute 权限按 Agent 声明放量）
- **代码执行沙箱**：`code-runner` Agent 的 `execute` 能力真实落地——`server/integrations/sandbox.js` 通过子进程跑 Python，带超时 / 输出截断 / 资源隔离建议；默认禁用，开发环境用 `SANDBOX_ENABLED=1 + SANDBOX_PYTHON=python3`，生产环境用 `SANDBOX_COMMAND` 接 Docker（`--network=none --memory=512m --cpus=1`）
- 可配置数据查询（默认演示模式，可接入真实数据源）
- 确认项代答 / 打回 / 升级 / 排版 / 交付 + 「我替你做的决定」清单
- 用户随时 @ 任一 Agent 插话、侧栏私聊 Twin 问进度
- 状态优先工作空间 UI + 文件为真相源的全程可回溯（含 Agent 思考过程回看）
- 每日进化（自动经验归纳）
- 容错与断点续跑

**二期（规划中）**

> 上下文隔离、经验包、记忆晋升、团队空间等核心 2.0 能力见上方 [2.0 路线图](#20-路线图--上下文隔离与引用)。以下为其他规划项：

- **扩展 Agent 能力深化**：通用 Agent 智能路由上线 / `report-writer` 周报模板 / `data-monitor` 异常告警接入通知系统
- **从「星型汇报」到「多 Agent 对话」**：在 Twin 主持下开放受控的「有界群聊」——允许两个 Agent 就某个子问题直接对话几轮，Twin 旁听、随时叫停、最终裁决
- **数据源适配器抽象**：DuckDB / SQLite / 自定义
- **Mac 端本机分身**：从网页 Demo 进化为本机常驻的数字分身

欢迎在 [Issues](../../issues) 提需求或认领实现。

---

## 安全说明

- **LLM key 只在服务端解析与使用**，不下发到浏览器。
- **取数白名单只读**：从工具层杜绝写操作（`SELECT` / `WITH...SELECT` only）。
- **代码沙箱默认禁用**：`SANDBOX_ENABLED` 未显式设为 `1` 时，`code-runner` 的 `execute` 调用返回 `SANDBOX_DISABLED`，编排自动改用 `query` 路径；启用后建议用 Docker 隔离（`--network=none` 禁网 + `--memory/--cpus` 限额），代码通过 stdin 传入避免命令注入，强制超时 30s。
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

---

## Why We Need Twin Agent

In a world where "use more agents" is becoming the default answer to every complex task, the Twin Agent is not just another worker — it is the **order and trust layer** that makes multi-agent collaboration actually usable for humans.

### The "Too Many Cooks" Problem

Without a central orchestrator, throwing multiple specialized agents at a task quickly devolves into chaos:

- **Confirmation fatigue**: Every agent bombards the user directly with "which metric?" "which time window?" "should I drill down?" at every turn. Ten minutes in, the user is doing more work answering confirmation prompts than they would have done the task themselves.
- **Divergent workstreams**: Without unified intent, agents pull in different directions. The data analyst focuses on statistical significance; the report writer jumps to conclusions before all data is in; the code runner fires off visualizations no one asked for.
- **No quality gates**: Output goes straight from worker to user. Who checks whether the numbers are right? Who catches contradictions between analyses? Who decides whether a report is actually deliverable?
- **Runaway execution**: Agents can keep talking to each other forever — or in circles — burning tokens without making progress. There's no one with the authority to say "stop, this is good enough" or "go back, you missed the point."
- **No audit trail**: When an agent makes a decision on the user's behalf, who recorded *why*? There's no way to trust the system if you can't trace how conclusions were reached.

The Twin solves all of these problems by acting as a **single point of accountability** between the user and an expanding roster of specialized tool agents.

### Four Core Privileges That Make Twin Indispensable

Twin is not a super-agent that does everything itself. It is a **coordinator with exactly four privileges** that no other agent has:

#### 1. Single Orchestrator — Enforcing the Star Topology

All tool agents report **exclusively to Twin**, never to each other and never directly to the user (unless the user explicitly @-mentions them). This creates a clean star topology:

```
            ┌────── User ──────┐
            │                  │
            ▼                  │
          Twin ◄────── @inject / reply / inquiry
            │
   ┌────────┼────────┬─────────┬──────────┐
   ▼        ▼        ▼         ▼          ▼
 Data    Style    General   CodeRunner  ReportWriter  ...
```

- Twin alone decides **which agent to call**, **when**, and **what task to assign**.
- Unregulated agent-to-agent communication is forbidden; agents cannot delegate to each other.
- Bounded iteration is enforced by `maxSteps` — Twin cannot let the conversation loop forever; after a configured number of exchanges, it must either deliver to the user or escalate.
- This is not a design choice for aesthetics; it is the mechanism that prevents agent mesh chaos.

#### 2. Decision Buffer Layer — Absorbing Confirmation Fatigue

Twin answers confirmation questions on the user's behalf **whenever it safely can**:

- **Low-risk decisions** (which SQL caliber to use, whether a drill-down is justified, how to format a chart axis) are handled using:
  - Structured decision frameworks from its `knowledge/` repository (e.g., `risk_matrix.yaml`, `answer_playbook.yaml`);
  - User preferences inferred from `profile.md`;
  - Context from previous decisions in the same task.
- **Medium-risk decisions** are answered by Twin with the rationale recorded in the decisions log.
- **Truly high-risk decisions** (those that change business conclusions, that the user explicitly reserved, or where Twin lacks sufficient context) are escalated back to the user via `escalate`, and Twin waits for a `reply` before proceeding.

The result: the user is not bothered for every minor choice, but retains final say on everything that matters.

#### 3. Quality Gatekeeper — Validating Before Delivery

Twin does not just pass agent outputs through. It **reviews deliverables from the user's perspective**:

- Checks numerical claims against the actual query results;
- Verifies alignment with the original goal (did we answer what was asked?);
- Enforces acceptance criteria (e.g., reports must have a conclusion first, no hand-wavy statements without data);
- Catches contradictions between different agents' outputs;
- Returns substandard work to the agent with **specific revision guidance** (`rework` action), not just "try again."

Work only reaches the user after Twin signs off on it.

#### 4. Trust Repository — The Decisions Log

Every decision Twin makes on the user's behalf is recorded in `decisions.jsonl` (append-only):

- What decision was made;
- Why it was made (which framework, which user preference, which precedent);
- What source knowledge was consulted;
- Risk assessment at the time.

At delivery, Twin produces a **"Decisions Made on Your Behalf"** section that transparently lists every choice Twin absorbed. This turns "black box automation" into "auditable delegation" — the user can see exactly where Twin exercised judgment, and can correct Twin's framework for next time if they disagree with a call.

### Personality Externalization — Twin Becomes Data, Not Code

Crucially, Twin's behavior is not hardcoded. It is derived entirely from **four editable files** in its workspace:

```
workspace/users/u_local/twin/
├── agent.md              # Operational manual + JSON output protocol (the "how Twin works" spec)
├── profile.md            # User persona, preferences, risk tolerance (gitignored — private to the user)
├── knowledge/            # Structured decision frameworks (risk matrix, answer playbooks, domain rules)
└── memory/
    ├── LEARNINGS.md      # Daily-evolved lessons from past tasks (auto-generated by evolve.js, human-reviewable)
    ├── dialogue.jsonl    # Cross-task conversation history (mirrored from tasks)
    └── thinking.jsonl    # Cross-task reasoning logs (for auditing and evolution)
```

This file-based architecture means:

- **Twin can evolve without code changes** — edit `knowledge/` rules, update `profile.md` preferences, or let `evolve.js` synthesize new learnings daily from task outcomes;
- **Twin is auditable** — every behavior driver is a plain file you can read, diff, and review in git;
- **Twin is portable** — to switch users, swap `profile.md` and adjust `knowledge/`; the same orchestration engine grows a different digital twin.

### The User Experience Contract

What this all adds up to is a specific promise to the user:

> **Set the goal, walk away, come back to a vetted result. Everything that was decided on your behalf is listed. If you disagree with any of it, Twin will learn. If you want to jump in at any point, @ any agent or ask Twin for a private status update — you are never locked out.**

That is the difference between "an AI assistant that runs agents for you" and "a digital twin that represents you in a multi-agent workspace."

---

### For Platform Builders: Twin as an Abstraction Layer

For teams building on top of MagicTwin, the Twin pattern provides three additional architectural benefits:

1. **Agent roster is infinitely extensible** — add a new tool agent by writing its `agent.md` and registering it in `roster.js`. The orchestrator, prompt loader, and UI all derive their behavior from the roster; no branching code required.
2. **Capability-based security** — agents only get the tools they are explicitly granted (`query` for SQL, `execute` for sandbox code, nothing by default), enforced at the protocol layer.
3. **Event-sourced by default** — every turn, tool call, decision, and piece of reasoning is appended to an immutable log, making replay, debugging, and compliance trivial.

The Twin Agent is not a feature. It is the architectural prerequisite that turns multi-agent systems from impressive demos into reliable tools you would actually trust to get work done.
