# 业务线E · 取数知识（示例模板）

> 本文件是「业务线E」的取数知识模板。请替换为你自己的真实表名、列名和口径定义。
> 运行时会被注入到数据分析 Agent 的 system prompt 中（见 `agent.md` 的 `{{KNOWLEDGE_NV}}` 占位符）。

## 主表
- 表名：`your_catalog.your_db.dwd_event_table_di`
- 粒度：事件级 / 日级（大表）
- 说明：大事件表，需控制查询窗口

## 核心指标列
| 列名 | 类型 | 说明 |
|------|------|------|
| `date` | int | 日期 |
| `package_name` | string | 应用包名 |
| `user_id` | string | 用户ID |
| `event_type` | string | 事件类型 |

## 注意事项
- 大事件表，务必单日或小窗口查询
- 去重用 `approx_distinct(user_id)`
- 按 `package_name` 过滤到目标应用
