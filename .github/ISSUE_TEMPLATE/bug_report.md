---
name: Bug 报告
about: 报告 MagicTwin 的缺陷或异常行为
title: "[bug] "
labels: bug
assignees: ''
---

## 描述

简要清晰地描述这个 bug 是什么。

## 复现步骤

1. 启动 `npm start`，配置 `LLM_API_KEY=...`
2. 访问 http://localhost:8787，输入目标：「...」
3. ...
4. 看到错误：...

## 期望行为

描述你本应该看到的行为。

## 实际行为

描述你实际看到的行为，包含完整的错误信息、日志片段或截图。

## 环境

- OS：[如 macOS 14.5]
- Node 版本：[运行 `node -v`]
- MagicTwin 版本 / commit：[运行 `git rev-parse --short HEAD`]
- 是否配置了 LLM key：[是 / 否]
- 是否配置了真实数据源：[是 / 否（演示模式）]
- 三个角色用的模型：Twin=``, Data=``, Style=``

## 任务空间产物（可选但强烈建议）

如果可复现，请附上 `tasks/{tid}/` 下的 `conversation.jsonl` 或 `STATE.md` 片段，以及报错那一轮的 `thinking.jsonl`（**注意脱敏，删除任何真实数据 / 内部表名**）。

## 附加信息

其他有助于诊断的上下文。
