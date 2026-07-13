---
name: data_analysis
description: 数据查询、分析与可视化能力
triggers:
  - "数据"
  - "DAU"
  - "指标"
  - "查询"
  - "SQL"
  - "趋势"
  - "环比"
  - "同比"
  - "留存"
  - "转化率"
  - "下降"
  - "上涨"
  - "波动"
allowed_tools:
  - query_data
  - generate_chart
  - anomaly_detect
  - trend_forecast
  - period_compare
constraints:
  - 数据结论必须基于查询结果
  - 展示 SQL 前需确认查询意图
  - 图表类型根据数据特征自动选择
priority: 10
---

数据分析能力：查询业务数据、生成可视化、执行深度分析。

支持的分析类型：
- 指标查询与趋势展示
- 环比/同比对比
- 异常检测与归因
- 趋势预测
- 维度下钻

输出标准：
- 数据表格 + 图表 + 文字结论
- 异常情况高亮说明
- 建议下一步行动
