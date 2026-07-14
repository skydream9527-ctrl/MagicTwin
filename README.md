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

## 为什么需要 Twin：多 Agent 同台的秩序与信任中枢

### 为什么需要「多个」Agent：能力的必要

一个「什么都会」的全能 Agent 在真实业务里撑不住：

- **上下文会爆**：把所有表 / 口径 / SOP 塞进一个 prompt，既超长又互相干扰。
- **人设会打架**：「严谨的 SQL 分析师」和「会排版的报告编辑」是两种表达风格，混在一个 Agent 里两头不讨好。
- **难维护、难进化**：全能 Agent 改一处牵一发；拆成专精 Agent 后，每个只装自己域的 `agent.md` + `knowledge/`，可**独立调优、独立进化、独立替换**。

本项目走**专业化分工**：花名册 `roster.js` 登记了 7 个 Agent（3 核心 + 4 扩展），各有专长。**新增一个只需两步**：放一份 `agent.md` + 在花名册登记一条元信息。

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

Twin 能指挥这些「来源各异」的 Agent，靠的是运行时统一注入的**协作协议**：

- 把每个工具 Agent 对外行为**收敛到统一动作集** `ask / query / report`（`query` 仅对有取数能力的 Agent 开放）；
- 明确声明「**只对 Twin 汇报**」，且 `agent.md` 里那些本空间没有的工具**一律不可调用**，需要它们才能完成的步骤作为建议写进 `report` 交 Twin 定夺；
- 于是即便一个 Agent 的手册写着一堆本地没有的工具，也能被「收敛」到本 Demo 真实可执行的动作上，在同一个对话区里正确协作。

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

## 四层空间（隔离与复用的刻意张力）

工作空间 `workspace/` 是四层空间，每层有明确归属、生命周期与隔离边界：

```
workspace/
├── users/{uid}/       用户空间：Twin 画像 + 长期记忆（私有，默认仅本人及本人 Twin 可读）
├── agents/{key}/      Agent 空间：手册 / 技能团队共享，情景记忆按用户分区
├── teams/{tid}/…      团队/项目空间：共享文件 / 知识 / 产物（按 Team 或 Project 隔离）[规划中]
└── tasks/{tid}/       任务空间：对话 / 文件 / 过程记忆（仅参与者可读，不跨任务）
```

**设计原则**：用空间把隔离做成结构性的默认，把复用做成显式的、可审计的动作。隔离与复用的张力是刻意设计的——既不串味，又能跨任务 / 跨用户复用经验。

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

- **扩展 Agent 能力深化**：通用 Agent 智能路由上线 / `report-writer` 周报模板 / `data-monitor` 异常告警接入通知系统
- **从「星型汇报」到「多 Agent 对话」**：在 Twin 主持下开放受控的「有界群聊」——允许两个 Agent 就某个子问题直接对话几轮，Twin 旁听、随时叫停、最终裁决
- **工作空间概念深化**：支持多个工作空间（个人 / 团队 / 项目），每个有自己的 Agent 花名册、知识库、任务看板，可切换、可共享、可归档
- **记忆晋升闭环**：过程记忆自动落任务层；值得长期保留的走「候选 → 审批 → 晋升」跨层（用户 / Agent-by-user / Agent-team / 项目 / 团队），从结构上杜绝一次对话污染所有人未来
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
