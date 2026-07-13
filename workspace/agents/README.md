# Agent 花名册

MagicTwin 采用**统一 Agent 抽象**：每个 Agent 以 `agent.md` 为操作手册、以文件为真相源。

## 核心 Agent（编排链路）

| Agent | 定位 | 职责 |
|-------|------|------|
| **Twin** | 用户数字分身 | 理解意图、派活、替用户回答确认项、验收、打回、交付 |
| **data-analysis** | 数据分析专家 | NL→SQL、查询数据、分析归因、8种分析范式 |
| **style-optimizer** | 报告编辑 | 把结论排版成结构清晰、可直接交付的报告 |

## 扩展 Agent

| Agent | 定位 | 职责 |
|-------|------|------|
| **general** | 入口编排者 | 判断意图、路由到最合适的子 Agent |
| **code-runner** | 代码执行 | 在沙盒中运行 Python 数据脚本（pandas/sklearn/prophet） |
| **report-writer** | 报告撰写 | 基于数据产出分析报告、周报、项目总结 |
| **data-monitor** | 数据监控 | 定时检测指标异常，触发告警推送 |

## Agent 结构

```
workspace/agents/{agent-key}/
  agent.md              # 操作手册（身份、职责、边界、SOP）
  reference/
    agent.json          # 元数据（工具、技能、特性）
    prompt/
      identity.md       # 身份定义
      sop.md            # 标准操作流程
      paradigms/        # 分析范式（仅 data-analysis）
    skills/             # 技能包（仅 general）
  knowledge/            # 领域知识（业务线、表结构、口径）
```

## 添加新 Agent

1. 在 `workspace/agents/` 下创建新目录
2. 编写 `agent.md`（操作手册）
3. 创建 `reference/agent.json`（元数据）
4. 编写 `reference/prompt/identity.md`（身份定义）
5. 如有 SOP，编写 `reference/prompt/sop.md`
6. 在 `server/domain/roster.js` 注册
