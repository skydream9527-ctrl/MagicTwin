# PRD · 工作空间上下文隔离与引用机制

| 字段 | 值 |
|---|---|
| 文档版本 | v1.0 (Draft) |
| 创建日期 | 2026-07-14 |
| 作者 | MagicTwin Project |
| 关联会议 | 2026-07-14 ICE-DATA-WORK 2.0 视频会议 |
| 关联代码 | `server/domain/roster.js` / `server/engine/orchestrator.js` / `workspace/` |
| 状态 | 待评审 |

---

## 1. 背景

### 1.1 会议核心诉求

2026-07-14 会议讨论了 ICE-DATA-WORK 2.0 方向，对 MagicTwin 提出四项关键诉求：

1. **Twin 应基于个人工作空间蒸馏**——Twin 的人格不应是手写的 `agent.md`，而应从用户真实工作内容（需求/SQL/分析/决策/报告）中定期蒸馏生成，让 Twin 越用越懂用户。
2. **个人工作空间需标准化沉淀**——用户工作成果应在统一位置沉淀（会议中类比 GitLab），避免多平台并存导致信息孤岛。这是 Twin 蒸馏与经验包构建的前提。
3. **经验包（Experience Package）作为可复用知识单元**——比 Agent 自带 `knowledge/` 更细粒度，基于历史任务提炼，可被 Twin 或用户按需搜索并注入到新任务空间，与固定 Skill 解耦。
4. **任务空间内的过程追溯**——所有协作过程、决策、产物须留痕可回溯。（MagicTwin P0 已实现）

### 1.2 MagicTwin 现状（P0 完成后）

| 能力 | 状态 |
|---|---|
| 花名册驱动的多 Agent 编排 | ✅ 已实现 |
| 统一协作协议（星型拓扑 + 能力声明） | ✅ 已实现 |
| 任务空间（对话/决策/SQL/数据/思考日志） | ✅ 已实现 |
| Agent 空间（手册 + 静态知识） | ✅ 已实现 |
| 用户空间（Twin 人设 + 长期记忆） | ✅ 部分实现（缺蒸馏机制） |
| 代码执行沙箱 | ✅ 已实现 |
| 每日进化（经验归纳到 LEARNINGS.md） | ✅ 已实现 |

### 1.3 差距

P0 已把「单用户 + 单任务」的协作闭环跑通。但会议提出的「跨任务、跨用户、跨团队」的上下文沉淀与复用机制完全缺失：

- ❌ **个人工作空间**：用户无法把外部工作内容（GitLab 上的 PRD/SQL/报告）作为 Twin 蒸馏源接入
- ❌ **经验包机制**：任务结束后产物就锁死在 `tasks/{tid}/`，无法被后续任务检索复用
- ❌ **团队/项目空间**：无跨用户共享知识层
- ❌ **记忆晋升闭环**：每日进化只写 Agent 自己的 `LEARNINGS.md`，无跨层（用户/团队）晋升路径
- ❌ **Twin 蒸馏链路**：Twin 人设是静态手写的，不会随用户工作内容演化

---

## 2. 目标与非目标

### 2.1 目标

1. **设计四层空间架构**：明确用户/Agent/团队·项目/任务四层空间的边界、隔离规则、引用规则
2. **个人工作空间外接机制**：支持用户把外部 GitLab 仓库作为 Twin 蒸馏源接入，约定仓库结构
3. **经验包机制**：定义经验包的文件格式、生命周期、检索方式、注入流程
4. **Twin 主动 RAG 检索**：Twin 收到任务后，主动检索相关经验包并注入到子 Agent 上下文
5. **记忆晋升闭环**：过程记忆 → 候选 → 审批 → 晋升到五个 scope 落点，从结构上杜绝跨层污染

### 2.2 非目标

- ❌ 不做多用户认证/权限系统（仍单用户本地运行，团队空间是文件层约定）
- ❌ 不做向量检索/pgvector（v1 走纯文件 + grep/标签过滤，v2 可叠加）
- ❌ 不做多 Twin（会议共识：Twin 作为通用角色，不按职能细分多个分身）
- ❌ 不做平台迁移（会议明确先内部验证，迁移到 Mika/Chatflow 是后续评估项）
- ❌ 不做多 Agent 自由对话（仍保持星型拓扑，Twin 是唯一 leader）

---

## 3. 核心设计原则

| # | 原则 | 落地 |
|---|---|---|
| 1 | **默认隔离、显式引用** | 所有上下文默认锁在自己空间；跨空间引用必须走可审计的显式动作 |
| 2 | **文件为真相源** | 所有内容落文件（.md / .jsonl），索引可重建，绝不手改派生物 |
| 3 | **检索可降级** | 缺向量索引时 grep 兜底；缺外部仓库时本地缓存兜底 |
| 4 | **晋升有闸门** | 跨层记忆必须走「候选 → 审批 → 晋升」原子事务，绝不直接跨层写 |
| 5 | **借鉴而非搬运** | 设计理念参考 ICE-DATA-WORK design-principles.md，但用 MagicTwin 自有代码与目录约定重写 |

---

## 4. 四层空间架构（上下文隔离）

### 4.1 空间层级与边界

```
workspace/
├── users/{uid}/                    # 用户空间（私有）
│   ├── twin/                       #   Twin 人设（蒸馏产物 + 长期记忆）
│   │   ├── agent.md                #     当前生效的人设（蒸馏生成，不手改）
│   │   ├── profile.md              #     用户画像（蒸馏生成）
│   │   └── memory/                 #     长期记忆（晋升落点之一）
│   ├── personal/                   #   个人工作空间索引（外接 GitLab 的本地镜像）
│   │   ├── INDEX.md                #     仓库结构映射 + 最近同步时间
│   │   └── cache/                  #     拉取的内容快照（可重建）
│   └── memory-candidates.jsonl     #   待审批的记忆候选（追加型）
│
├── agents/{key}/                   # Agent 空间（团队共享 + 按用户分区）
│   ├── agent.md                    #   手册（团队共享，所有人可读）
│   ├── knowledge/                  #   静态知识（团队共享）
│   ├── by-user/{uid}/              #   情景记忆（按用户隔离）
│   │   └── memory/LEARNINGS.md     #     该用户对该 Agent 的专属经验
│   └── by-team/                    #   团队共享经验（晋升落点之一）
│       └── memory/LEARNINGS.md
│
├── teams/{tid}/                    # 团队/项目空间（共享）
│   ├── knowledge/                  #   团队知识库
│   ├── experiences/                #   团队级经验包（晋升落点之一）
│   └── templates/                  #   团队模板（PRD/周报/SQL 范式）
│
├── tasks/{tid}/                    # 任务空间（参与者可读，不跨任务）
│   ├── meta.json                   #   任务元数据
│   ├── conversation.jsonl          #   对话日志
│   ├── decisions.jsonl             #   决策日志（含 Twin 代答）
│   ├── thinking.jsonl              #   Agent 思考日志
│   ├── sql/                        #   执行过的 SQL
│   ├── data/                       #   查询结果数据
│   ├── artifacts/                  #   交付产物
│   ├── experiences/                #   本次任务引用的经验包副本（只读）
│   │   └── {exp-id}.md             #     引用时复制副本，避免外部变更影响
│   └── memory-candidates.jsonl     #   本任务产出的记忆候选
│
└── experiences/                    # 经验包全局仓库（用户级）
    ├── {exp-id}.md                 #   每个经验包一个文件
    └── INDEX.md                    #   自动维护的索引（可重建）
```

### 4.2 隔离矩阵

横轴：空间类型；纵轴：访问主体。`R`=可读，`W`=可写，`-`=禁止。

| 访问主体 ↓ \ 空间类型 → | 用户空间 | Agent 共享 | Agent by-user | 团队空间 | 任务空间 |
|---|---|---|---|---|---|
| **用户本人** | R/W | R | R/W | R | R |
| **用户的 Twin** | R/W | R | R/W | R | R |
| **工具 Agent（任务中）** | - | R | R（仅自己分区） | R | R |
| **工具 Agent（任务外）** | - | R | R（仅自己分区） | R | - |
| **其他用户** | - | R | - | R | - |
| **其他用户的 Twin** | - | R | - | R | - |

**关键约束**：
- 工具 Agent 在任务中**只能读**任务空间外的内容，**不能写**——任何跨任务记忆必须走记忆候选 → 审批 → 晋升
- Agent by-user 分区是该 Agent 对该用户的专属经验，其他用户**不可读**
- 用户空间是最高隐私层，仅本人 + 本人的 Twin 可访问

### 4.3 与 P0 现状的兼容

P0 的 `workspace/users/u_local/twin/`、`workspace/agents/{key}/`、`workspace/tasks/{tid}/` 结构保留不变。新增：
- `workspace/users/{uid}/personal/`（个人工作空间索引）
- `workspace/agents/{key}/by-user/` 和 `by-team/`（情景记忆分区）
- `workspace/teams/{tid}/`（团队空间）
- `workspace/experiences/`（经验包全局仓库）

---

## 5. 个人工作空间外接（上下文源）

### 5.1 设计选型

会议提到「工作成果应在统一位置（如 GitLab）沉淀」。采用**外接 GitLab/Git** 方案：用户在已有 Git 仓库里维护工作内容，MagicTwin 通过配置指针拉取并索引。

**优点**：复用现有沉淀习惯；不强迫用户把工作内容复制到 MagicTwin 内；GitLab 自带版本控制与协作能力。

**缺点**：需约定仓库结构；需做同步机制。

### 5.2 仓库结构约定

用户的外部仓库建议按以下结构组织（不强制，MagicTwin 通过 frontmatter 识别）：

```
my-workspace/                       # 用户在 GitLab 的个人工作仓库
├── README.md                       # 仓库说明
├── needs/                          # 需求文档
│   └── 2026-07-xxx-prd.md
├── sql/                            # SQL 脚本
│   └── 2026-07-xxx-da-query.sql
├── reports/                        # 分析报告
│   └── 2026-07-xxx-weekly.md
├── decisions/                      # 决策记录
│   └── 2026-07-xxx-口径对齐.md
└── notes/                          # 学习笔记/复盘
    └── 2026-07-xxx-stl复盘.md
```

每个文件建议带 frontmatter（MagicTwin 检索时识别）：

```markdown
---
title: 内容中心消费时长异常定位
date: 2026-07-10
type: report              # needs | sql | report | decision | note
tags: [内容中心, 消费时长, 异常归因]
business_line: content-center
related_tasks: [t_20260710_abc123]   # 关联的 MagicTwin 任务 ID（可选）
---
```

### 5.3 接入配置

在 `.env` 或 `workspace/users/{uid}/config.json` 中配置：

```json
{
  "personalWorkspace": {
    "type": "git",
    "url": "git@gitlab.example.com:zhangsan/my-workspace.git",
    "branch": "main",
    "localPath": "workspace/users/u_local/personal/cache",
    "syncIntervalHours": 6,
    "ignorePatterns": ["*.tmp", "drafts/"]
  }
}
```

### 5.4 同步机制

- **首次接入**：`git clone` 到 `localPath`
- **定时同步**：每 `syncIntervalHours` 小时执行 `git pull`，更新 `INDEX.md`
- **手动触发**：API `POST /api/workspace/sync` 立即拉取
- **降级**：仓库不可达时用 `localPath` 缓存兜底，并在 `/api/health` 标记 `workspace.stale=true`

### 5.5 Twin 蒸馏链路

Twin 的人格不再静态手写，而是定期从个人工作空间蒸馏生成：

```
personal/cache/                workspace/users/{uid}/twin/
├── needs/*.md        ──┐
├── sql/*.sql           │
├── reports/*.md        ├──→ 蒸馏任务（调 LLM）──→  agent.md      （角色定位 + 工作方式）
├── decisions/*.md      │                          profile.md    （用户画像：代表谁/决策依据/指挥权限）
└── notes/*.md         ──┘                          memory/       （长期偏好与决策模式）
```

**蒸馏触发**：
- 定时：每周一次（可在 `config.json` 配置）
- 手动：API `POST /api/twin/distill`
- 增量：每次同步后检测新增文件，仅蒸馏增量

**蒸馏安全**：
- 蒸馏产物（agent.md / profile.md）**不进 Git**（已在 `.gitignore`）
- 蒸馏前备份上一版到 `twin/.backup/{timestamp}/`
- 蒸馏失败时回滚

---

## 6. 经验包机制（上下文引用核心）

### 6.1 经验包定义

经验包是一个**自包含、可检索、可注入**的知识单元，来源于历史任务或用户手写。

**与 Agent `knowledge/` 的区别**：

| 维度 | Agent knowledge/ | 经验包 |
|---|---|---|
| 粒度 | 整个领域知识（如「浏览器信息流业务知识」） | 单个任务级结论（如「2026-07 内容中心消费时长异常归因」） |
| 来源 | 手写或团队维护 | 从历史任务自动提炼 + 用户审批 |
| 注入方式 | 始终注入该 Agent 的 system prompt | Twin 按需检索 top-k 注入 |
| 生命周期 | 长期稳定 | 随业务演化，可失效/归档 |
| scope | 团队共享 | user / agent-user / agent-team / project / team 五级 |

### 6.2 经验包文件格式

每个经验包一个 `.md` 文件，文件名 `{exp-id}.md`，`exp-id` 格式 `exp_{YYYYMMDD}_{short-hash}`（如 `exp_20260710_a1b2c3`）。

**frontmatter 规范**：

```markdown
---
id: exp_20260710_a1b2c3
title: 内容中心消费时长异常归因
type: analysis              # analysis | report | decision | sql-pattern | playbook
scope: user                 # user | agent-user | agent-team | project | team
scope_ref:                  # scope 对应的归属
  user: u_local             #   scope=user 时填用户 ID
  agent: data               #   scope=agent-* 时填 Agent key
  team: t_content           #   scope=team/project 时填团队 ID
source_task: t_20260710_abc123   # 来源任务 ID（如来自任务提炼）
created_at: 2026-07-10T15:30:00+08:00
created_by: u_local         # 创建者（用户或 Agent key）
approved_by: u_local        # 审批通过者（晋升时填）
status: active              # candidate | active | archived | rejected
tags: [内容中心, 消费时长, 异常归因, STL]
business_line: content-center
related_agents: [data, code-runner]   # 哪些 Agent 可能用到
token_estimate: 850         # 预估 token 数（注入时做预算控制）
expires_at:                 # 可选，过期自动归档
---

# 内容中心消费时长异常归因

## 命题
内容中心 2026-07-01 至 07-07 消费时长环比下降 12%

## 关键结论
- 趋势项：-3.2%/周（连续 4 周下行）
- 周期项：7 天周期稳定，周末略高
- 残差：无超 2σ 异常点

## 使用的方法
STL 周期剥离 + 变点检测

## 复用建议
- 同类「消费时长异常」命题可复用此归因路径
- 数据 Agent 先查趋势 → code-runner 做 STL → 对比残差异常点

## 关键 SQL 模式
\`\`\`sql
SELECT dt, metric_value
FROM fact_consumption
WHERE business_line = 'content-center'
  AND dt BETWEEN {{start}} AND {{end}}
ORDER BY dt
\`\`\`
```

### 6.3 经验包生命周期

```
[任务结束]                  [Twin 提议或用户手写]
     │                              │
     ▼                              ▼
[tasks/{tid}/memory-candidates.jsonl]   [直接写 workspace/experiences/]
     │                                       │（status: candidate）
     │                                       │
     ▼                                       ▼
     └─────────────→ [用户审批] ←────────────┘
                            │
                   ┌────────┴────────┐
                   ▼                 ▼
              [通过：晋升]       [拒绝：留痕]
                   │                 │
                   ▼                 ▼
      [写入目标 scope 落点]    [status: rejected]
      [status: active]        [保留可复盘]
      [更新 INDEX.md]
                   │
                   ▼
            [被 Twin RAG 检索注入]
                   │
                   ▼
        [过期或被新经验包取代]
                   │
                   ▼
            [status: archived]
```

### 6.4 五个 scope 落点

| scope | 落点路径 | 谁可读 | 谁可写（晋升后） | 适用场景 |
|---|---|---|---|---|
| `user` | `workspace/users/{uid}/experiences/` | 仅本人 + Twin | 本人审批 | 用户个人经验（如「我喜欢周报用 TL;DR 开头」） |
| `agent-user` | `workspace/agents/{key}/by-user/{uid}/experiences/` | 本人 + 该 Agent | 本人审批 | 该 Agent 对该用户的专属经验 |
| `agent-team` | `workspace/agents/{key}/by-team/experiences/` | 全员 + 该 Agent | 团队管理员审批 | 该 Agent 的团队通用经验 |
| `project` | `workspace/teams/{tid}/experiences/` | 项目成员 | 项目管理员审批 | 项目级经验 |
| `team` | `workspace/teams/{tid}/experiences/` | 团队成员 | 团队管理员审批 | 团队级经验 |

### 6.5 检索方式

**v1（纯文件 + grep/标签过滤）**：

```bash
# Twin 收到任务后，先按关键词 + 标签检索经验包
grep -l "消费时长" workspace/experiences/*.md
grep -l "tags:.*内容中心" workspace/experiences/*.md
```

通过 `server/domain/experiences.js` 封装：

```javascript
// 按 tags + business_line + related_agents 过滤
export function searchExperiences({ tags, businessLine, agentKey, limit = 5 }) {
  const all = listAllExperiences();  // 遍历 workspace/experiences/*.md
  return all
    .filter(exp => exp.status === "active")
    .filter(exp => !tags || tags.some(t => exp.tags.includes(t)))
    .filter(exp => !businessLine || exp.business_line === businessLine)
    .filter(exp => !agentKey || exp.related_agents.includes(agentKey))
    .slice(0, limit);
}
```

**v2（可叠加，非阻塞）**：在文件基础上加 SQLite 索引（`.cache/experiences.db`，可重建）加速过滤；再后续可加 pgvector 做语义检索。

### 6.6 索引文件 INDEX.md

`workspace/experiences/INDEX.md` 自动维护（可重建）：

```markdown
# 经验包索引

> 自动生成，请勿手改。运行 `npm run reindex-experiences` 重建。

| ID | 标题 | Type | Scope | Tags | 创建时间 | 状态 |
|---|---|---|---|---|---|---|
| exp_20260710_a1b2c3 | 内容中心消费时长异常归因 | analysis | user | 内容中心,消费时长,STL | 2026-07-10 | active |
| exp_20260708_d4e5f6 | 周报 TL;DR 写作范式 | playbook | user | 周报,TL;DR | 2026-07-08 | active |
| ... | | | | | | |
```

---

## 7. 上下文注入策略（Twin 主动 RAG）

### 7.1 工作流

```
[用户下达任务]
       │
       ▼
[Twin 解析任务] ──→ 提取关键词/标签/业务线
       │
       ▼
[Twin 调 searchExperiences()] ──→ 返回 top-k 经验包
       │
       ▼
[Twin 评估相关性] ──→ LLM 判断每个经验包是否真的相关
       │
       ▼
[Twin 派活给子 Agent] ──→ 在 assign 事件中附带经验包摘要
       │
       ▼
[子 Agent 收到任务] ──→ system prompt 中包含：
                       - 自身 agent.md
                       - 自身 knowledge/
                       - Twin 注入的经验包摘要（标注来源）
                       - 统一协作协议
```

### 7.2 注入位置

经验包**不直接塞进 Agent 的 system prompt**（会污染人设），而是作为**任务上下文**注入：

```
工具 Agent 的 system prompt 结构（P0 已实现）：
┌─────────────────────────────────────┐
│ agent.md（手册）                     │
│ + knowledge/（静态知识）             │
│ + 统一协作协议                       │
│ + 能力声明                           │
│ + LEARNINGS.md（进化经验）           │
└─────────────────────────────────────┘

工具 Agent 的初始 user message（任务派发时）：
┌─────────────────────────────────────┐
│ Twin 的 assign 文本                  │
│ + 【相关经验包】（新增）             │
│   - exp_xxx: 内容中心消费时长归因     │
│     关键结论：STL 周期剥离有效        │
│     建议路径：趋势→STL→残差           │
│ + 任务目标                           │
└─────────────────────────────────────┘
```

### 7.3 Token 预算控制

- 单个任务注入的经验包总 token 不超过 `MAX_EXPERIENCE_TOKENS`（默认 2000）
- 每个经验包只注入**摘要 + 关键结论 + 复用建议**，不注入全文
- 超出预算时按相关性排序截断
- Agent 可通过 `ask` 动作向 Twin 请求某个经验包的完整内容

### 7.4 引用追溯

注入的经验包在任务中作为**只读副本**保存到 `tasks/{tid}/experiences/{exp-id}.md`：

- 任务结束后，这些副本作为任务产物的一部分归档
- 副本 frontmatter 记录 `injected_at` / `injected_by`（Twin）/ `injected_into`（哪个 Agent）
- 即使原经验包后续被修改/归档，任务空间内的副本保持不变，确保过程可回溯

---

## 8. 记忆晋升闭环

### 8.1 五个 scope 与落点

见 §6.4 表格。

### 8.2 候选生成

任务过程中，Agent 可在 `report` 动作中附带 `memory_candidates` 字段提议记忆：

```json
{
  "type": "report",
  "summary": "...",
  "memory_candidates": [
    {
      "content": "内容中心消费时长异常归因：先查趋势，再 STL 周期剥离，最后看残差异常点。这套路径对同类命题有效。",
      "proposed_scope": "agent-team",
      "proposed_scope_ref": { "agent": "data" },
      "tags": ["内容中心", "消费时长", "STL"],
      "rationale": "该归因路径可复用到所有「时长类异常」命题"
    }
  ]
}
```

Twin 收到 report 后，把候选追加到 `tasks/{tid}/memory-candidates.jsonl`：

```json
{"id":"mc_xxx","content":"...","proposed_scope":"agent-team","proposed_scope_ref":{"agent":"data"},"tags":[...],"rationale":"...","source_task":"t_xxx","created_at":"...","status":"pending"}
```

### 8.3 审批流程

**API**：
- `GET /api/memory/candidates` — 列出所有待审批候选
- `POST /api/memory/approve/{mc_id}` — 通过，晋升到目标 scope
- `POST /api/memory/reject/{mc_id}` — 拒绝，标记 `status: rejected` 并留痕

**晋升原子事务**（`server/domain/memory.js` 实现）：
1. 写入目标 scope 落点（生成 `exp-id`，写 `.md` 文件）
2. 更新 `INDEX.md`
3. 标记候选 `status: approved`
4. 任一步失败全部回滚

**审批权限**：
- `scope=user` / `scope=agent-user`：用户本人审批
- `scope=agent-team` / `scope=project` / `scope=team`：团队管理员审批（v1 单用户模式下默认用户本人审批）

### 8.4 拒绝留痕

被拒绝的候选不删除，保留 `status: rejected` + `rejected_by` + `rejected_at` + `reject_reason`，便于：
- 复盘 Agent 的提议质量
- 防止同一候选被反复提议（去重检查）

---

## 9. 数据模型与接口

### 9.1 新增配置项（`.env.example`）

```bash
# ---------- 个人工作空间（外接 Git） ----------
PERSONAL_WORKSPACE_TYPE=git           # git | none
PERSONAL_WORKSPACE_URL=               # git@gitlab.example.com:zhangsan/my-workspace.git
PERSONAL_WORKSPACE_BRANCH=main
PERSONAL_WORKSPACE_SYNC_HOURS=6       # 同步间隔（小时）

# ---------- Twin 蒸馏 ----------
TWIN_DISTILL_ENABLED=0                # 默认关，保守灰度
TWIN_DISTILL_INTERVAL_DAYS=7          # 蒸馏间隔（天）
TWIN_DISTILL_MODEL=                   # 蒸馏用模型（默认用 TWIN_MODEL）

# ---------- 经验包 ----------
EXPERIENCE_MAX_INJECT_TOKENS=2000     # 单任务注入经验包 token 上限
EXPERIENCE_SEARCH_LIMIT=5             # RAG 检索 top-k
```

### 9.2 新增 API 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/workspace/sync` | 手动触发个人工作空间同步 |
| GET | `/api/workspace/status` | 查询工作空间状态（最后同步时间/是否过期） |
| GET | `/api/experiences` | 列出所有经验包（支持 `?tag=&agent=&business_line=` 过滤） |
| GET | `/api/experiences/{id}` | 获取单个经验包详情 |
| POST | `/api/experiences` | 手动创建经验包 |
| PUT | `/api/experiences/{id}` | 更新经验包（仅 active 状态） |
| DELETE | `/api/experiences/{id}` | 归档经验包（status: archived，不删除文件） |
| POST | `/api/twin/distill` | 手动触发 Twin 蒸馏 |
| GET | `/api/memory/candidates` | 列出待审批记忆候选 |
| POST | `/api/memory/approve/{mc_id}` | 通过候选，晋升到目标 scope |
| POST | `/api/memory/reject/{mc_id}` | 拒绝候选 |

### 9.3 新增模块

```
server/
├── domain/
│   ├── experiences.js          # 经验包 CRUD + 检索
│   ├── memory.js               # 记忆候选 + 晋升事务
│   ├── workspace.js            # 个人工作空间同步
│   └── distill.js              # Twin 蒸馏
├── jobs/
│   ├── sync-workspace.js       # 定时同步个人工作空间
│   └── distill-twin.js         # 定时蒸馏 Twin
└── http/
    └── router.js               # 新增上述 API 路由
```

### 9.4 orchestrator.js 改造点

P0 的 `runOrchestration` 在 Twin 解析任务后、派活前，新增「经验包检索」步骤：

```javascript
// Twin 收到任务后，先检索相关经验包
const experiences = searchExperiences({
  tags: extractedTags,        // Twin 从任务描述提取
  businessLine: detectedBL,
  agentKey: "data",           // 即将派给的 Agent
  limit: CONFIG.experience.searchLimit,
});

// 在 assign 事件中附带经验包摘要
emit({
  actor: "twin", kind: "assign", channel: "main",
  to: targetKey, text: assignText,
  experiences: experiences.map(e => ({
    id: e.id, title: e.title, summary: e.summary,
    reuse_hint: e.reuse_hint, token_estimate: e.token_estimate,
  })),
});

// 把经验包副本写入任务空间
for (const exp of experiences) {
  writeFileSync(`workspace/tasks/${tid}/experiences/${exp.id}.md`, exp.raw);
}

// 子 Agent 的初始 user message 包含经验包摘要
const toolMessages = getToolMessages(key);
toolMessages.push({
  role: "user",
  content: buildToolAssignText(assignText, experiences),
});
```

---

## 10. 迁移路径与里程碑

### M1: 个人工作空间外接（2 周）

- [ ] 实现 `server/domain/workspace.js`（git clone/pull + INDEX.md 维护）
- [ ] 实现 `/api/workspace/sync` + `/api/workspace/status`
- [ ] 定时同步任务 `server/jobs/sync-workspace.js`
- [ ] 文档：仓库结构约定 + frontmatter 规范
- [ ] 降级测试：仓库不可达时缓存兜底

### M2: 经验包机制（3 周）

- [ ] 实现 `server/domain/experiences.js`（CRUD + grep/标签检索）
- [ ] 经验包文件格式 + frontmatter 解析
- [ ] `INDEX.md` 自动维护 + `npm run reindex-experiences` 脚本
- [ ] `/api/experiences` 系列 API
- [ ] orchestrator 改造：Twin 主动检索 + 注入 + 任务空间副本
- [ ] Token 预算控制
- [ ] 前端：任务详情页展示「本次注入的经验包」

### M3: 记忆晋升闭环（2 周）

- [ ] 实现 `server/domain/memory.js`（候选管理 + 原子晋升事务）
- [ ] Agent `report` 动作支持 `memory_candidates` 字段
- [ ] `/api/memory/candidates` + approve/reject API
- [ ] 前端：记忆候选审批页（在配置页新增 Tab）
- [ ] 拒绝留痕 + 去重检查

### M4: Twin 蒸馏（2 周）

- [ ] 实现 `server/domain/distill.js`（调 LLM 蒸馏 4 类文件）
- [ ] 定时蒸馏任务 `server/jobs/distill-twin.js`
- [ ] `/api/twin/distill` 手动触发
- [ ] 蒸馏前自动备份 + 失败回滚
- [ ] 增量蒸馏（仅蒸馏新增文件）
- [ ] 前端：Twin 蒸馏触发按钮 + 历史版本对比

---

## 11. 风险与对策

| 风险 | 等级 | 对策 |
|---|---|---|
| 个人工作空间仓库结构不标准导致蒸馏质量差 | 高 | 提供仓库模板 + frontmatter 校验 + 蒸馏前预检 |
| 经验包数量增长后 grep 检索慢 | 中 | v1 上限 1000 个文件时 grep 可接受；v2 叠加 SQLite 索引 |
| Twin RAG 检索相关性差导致注入错误经验 | 中 | Twin 检索后做二次 LLM 相关性判断；Agent 可通过 `ask` 质疑 |
| 记忆晋升跨层污染（如错误经验晋升到团队层） | 高 | 原子事务 + 审批闸门 + 拒绝留痕 + 归档不删除 |
| 蒸馏产物覆盖手写人设导致 Twin 行为退化 | 高 | 蒸馏前备份 + 失败回滚 + `TWIN_DISTILL_ENABLED` 默认关 |
| 外接仓库不可达时整个系统阻塞 | 中 | 同步失败用缓存兜底 + `/api/health` 标记 stale + 不阻塞编排 |
| token 预算超限 | 低 | `EXPERIENCE_MAX_INJECT_TOKENS` 硬上限 + 按相关性截断 |

---

## 12. 附录

### 12.1 经验包 frontmatter 完整字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | string | 是 | `exp_{YYYYMMDD}_{6位hash}` |
| title | string | 是 | 经验包标题 |
| type | enum | 是 | `analysis` / `report` / `decision` / `sql-pattern` / `playbook` |
| scope | enum | 是 | `user` / `agent-user` / `agent-team` / `project` / `team` |
| scope_ref | object | 是 | scope 对应的归属引用 |
| source_task | string | 否 | 来源任务 ID |
| created_at | ISO8601 | 是 | 创建时间 |
| created_by | string | 是 | 创建者（用户 ID 或 Agent key） |
| approved_by | string | 否 | 审批通过者 |
| status | enum | 是 | `candidate` / `active` / `archived` / `rejected` |
| tags | string[] | 是 | 标签（用于检索） |
| business_line | string | 否 | 业务线 |
| related_agents | string[] | 否 | 相关 Agent key 列表 |
| token_estimate | number | 是 | 预估 token 数 |
| expires_at | ISO8601 | 否 | 过期时间 |
| injected_at | ISO8601 | 否 | 被注入到任务时填（副本字段） |
| injected_by | string | 否 | 注入发起者（副本字段） |
| rejected_by | string | 否 | 拒绝者（rejected 状态填） |
| rejected_at | ISO8601 | 否 | 拒绝时间 |
| reject_reason | string | 否 | 拒绝原因 |

### 12.2 个人工作空间仓库模板

见 §5.2。完整模板将发布到 `docs/templates/personal-workspace-template/`。

### 12.3 与 P0 代码的兼容性

- P0 的 `workspace/users/u_local/twin/agent.md` 保留为「手写版」；蒸馏功能默认关（`TWIN_DISTILL_ENABLED=0`），开启后蒸馏产物覆盖到同路径
- P0 的 `workspace/agents/{key}/knowledge/` 保留不变；经验包是独立机制，不替代 knowledge
- P0 的 `server/prompts/generic.js` 的 `buildToolSystem` 不变；经验包通过初始 user message 注入，不污染 system prompt
- P0 的 `server/engine/orchestrator.js` 仅在 Twin assign 前新增检索步骤，不破坏现有星型拓扑

### 12.4 参考文档

- 会议纪要：`https://mi.feishu.cn/docx/WffddhJOeo6vy1xPdQocu81In9b`
- ICE-DATA-WORK 设计理念：`docs/design-principles.md`
- MagicTwin README：`README.md`
- P0 实现提交：`f625e29` / `f9dcb0f` / `ac9badc`

---

## 13. 评审检查表

- [ ] 四层空间边界是否清晰？是否有遗漏的跨层场景？
- [ ] 隔离矩阵是否覆盖所有访问主体？
- [ ] 经验包 frontmatter 字段是否够用？是否有冗余？
- [ ] Twin RAG 注入位置（初始 user message 而非 system prompt）是否合理？
- [ ] 记忆晋升五个 scope 是否覆盖所有复用场景？
- [ ] 里程碑排序是否合理？是否有并行可能？
- [ ] 降级策略是否覆盖所有外部依赖失败场景？
