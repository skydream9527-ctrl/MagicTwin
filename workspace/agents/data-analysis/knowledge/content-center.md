# 业务线A · 取数知识（示例模板）

> 本文件是「业务线A」的取数知识模板。请替换为你自己的真实表名、列名和口径定义。
> 运行时会被注入到数据分析 Agent 的 system prompt 中（见 `agent.md` 的 `{{KNOWLEDGE_CC}}` 占位符）。

## 主表
- 表名：`your_catalog.your_db.dm_table_a_di`
- 粒度：设备级 / 日级
- 说明：核心指标多维分析表

## 核心指标列
| 列名 | 类型 | 说明 |
|------|------|------|
| `date` | int | 日期，格式 YYYYMMDD |
| `is_core_metric` | int | 核心口径过滤标志（1=有效） |
| `metric_value` | bigint | 指标值 |
| `dimension_a` | string | 维度A |

## 常用维度
- `dimension_a`：维度A（如分类、频道）
- `dimension_b`：维度B（如来源、入口）

## 性能注意事项
- 设备级大表，去重用 `approx_distinct(user_id)` 而非 `COUNT(DISTINCT ...)`
- 必带 `date` 过滤，单次查询建议 ≤ 30 天
