# 业务线C · 取数知识（示例模板）

> 本文件是「业务线C」的取数知识模板。请替换为你自己的真实表名、列名和口径定义。
> 运行时会被注入到数据分析 Agent 的 system prompt 中（见 `agent.md` 的 `{{KNOWLEDGE_C}}` 占位符）。

## 主表
- 表名：`your_catalog.your_db.dm_table_c_di`（与业务线B共用主表，口径不同）
- 粒度：设备级 / 日级

## 核心口径
- `is_feed_user=1`：信息流活跃用户口径

## 核心指标列
| 列名 | 类型 | 说明 |
|------|------|------|
| `date` | int | 日期 |
| `is_feed_user` | int | 信息流口径标志 |
| `feed_dau` | bigint | 信息流日活 |
| `feed_impressions` | bigint | 信息流曝光 |

## 性能注意事项
- 与业务线B共用大表，同样需 `approx_distinct` 去重
