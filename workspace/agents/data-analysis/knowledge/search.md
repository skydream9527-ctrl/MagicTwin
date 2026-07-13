# 业务线D · 取数知识（示例模板）

> 本文件是「业务线D」的取数知识模板。请替换为你自己的真实表名、列名和口径定义。
> 运行时会被注入到数据分析 Agent 的 system prompt 中（见 `agent.md` 的 `{{KNOWLEDGE_D}}` 占位符）。

## 主表
- 表名：`your_catalog.your_db.dm_table_d_di`
- 粒度：预聚合 / 日级
- 说明：预聚合小表，可直接 SUM

## 核心指标列
| 列名 | 类型 | 说明 |
|------|------|------|
| `date` | int | 日期 |
| `search_engine` | string | 搜索引擎来源（'ALL' 汇总） |
| `pv` | bigint | 搜索页浏览量 |
| `uv` | bigint | 搜索页独立访客 |

## 注意事项
- 预聚合表，无需去重，直接 SUM 即可
- 过滤 `search_engine='ALL'` 获取汇总数据
