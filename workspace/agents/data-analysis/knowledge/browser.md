# 业务线B · 取数知识（示例模板）

> 本文件是「业务线B」的取数知识模板。请替换为你自己的真实表名、列名和口径定义。
> 运行时会被注入到数据分析 Agent 的 system prompt 中（见 `agent.md` 的 `{{KNOWLEDGE_BM}}` 占位符）。

## 主表
- 表名：`your_catalog.your_db.dm_table_b_di`
- 粒度：设备级 / 日级
- 说明：大盘核心指标表

## 核心指标列
| 列名 | 类型 | 说明 |
|------|------|------|
| `date` | int | 日期，格式 YYYYMMDD |
| `is_active_user` | int | 活跃用户口径（1=有效） |
| `dau` | bigint | 日活 |
| `metric_x` | double | 指标X |

## 常用维度
- `dimension_x`：维度X
- `dimension_y`：维度Y

## 性能注意事项
- 设备级大表，去重用 `approx_distinct(user_id)`
- 必带 `date` 过滤
