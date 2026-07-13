# 范式 7 · 留存分析（Retention / Cohort）

## 何时

用户问 "留存 / 回访 / Day-N / cohort / LT"

## 核心问题

「用户进来后多久还回来？哪批 cohort 留得最好？什么时候达稳态？」

## Phase 5 报告必填 sections

| Section | 必填字段 |
|---|---|
| ① Cohort 定义 | 按什么分 cohort（注册日 / 装版本 / 渠道）+ **每个 cohort size**（缺 size 不通过）|
| ② Day-N 矩阵 | `cohort × {Day1, Day3, Day7, Day14, Day30}` 留存 % |
| ③ 关键点对比 | Day1 / Day7 / Day30 三点跨 cohort 对比表 |
| ④ 曲线形态 | 陡降 / 缓降 / 反弹 / 抖动（一句话定性 + 数据支撑）|
| ⑤ 关联事件 | cohort 与推全 / 活动 / 改版的对应关系 |

## 必嵌可视化

- cohort 留存矩阵热力图（PNG，来自 Python seaborn）
- Day-N 折线对比（多 cohort 一图）

## SQL 模板（cohort × day_n 留存矩阵）

```sql
-- cohort = 注册日；day_n 留存 = 注册后第 N 天是否回访
WITH cohort_users AS (
  SELECT user_id, register_date AS cohort_day
  FROM users
  WHERE register_date BETWEEN '<cohort_start>' AND '<cohort_end>'
),
visits AS (
  SELECT user_id, visit_date,
         DATEDIFF(visit_date, c.cohort_day) AS day_n
  FROM events e
  INNER JOIN cohort_users c ON e.user_id = c.user_id
  WHERE e.visit_date >= c.cohort_day
    AND e.visit_date < DATE_ADD(c.cohort_day, INTERVAL 31 DAY)
),
cohort_size AS (
  SELECT cohort_day, COUNT(DISTINCT user_id) AS size
  FROM cohort_users GROUP BY cohort_day
),
retention AS (
  SELECT c.cohort_day, v.day_n, COUNT(DISTINCT v.user_id) AS active
  FROM cohort_users c LEFT JOIN visits v ON c.user_id = v.user_id
  WHERE v.day_n IN (1, 3, 7, 14, 30)
  GROUP BY c.cohort_day, v.day_n
)
SELECT r.cohort_day AS cohort, r.day_n,
       r.active * 1.0 / cs.size AS retention,
       cs.size AS cohort_size
FROM retention r
INNER JOIN cohort_size cs ON r.cohort_day = cs.cohort_day
ORDER BY cohort, day_n;
```

落 CSV：`data/T{n}_cohort_retention.csv` schema: `cohort, day_n, retention, cohort_size`

## Python 增强（推荐）

热力图 + cohort 聚类 → Python：
→ [skills/nl-python/reference/retention.md](../../../../skills/nl-python/reference/retention.md)

如果还要从 D7 / D14 外推到 D30 / D60 / D90 (LT-DAU)：
→ [skills/nl-python/reference/cohort-curve.md](../../../../skills/nl-python/reference/cohort-curve.md)

输出：
- `data/T{n}_cohort_clusters.csv`（cohort 聚类标签）
- `data/T{n}_retention_keypoints.csv`（D1/D7/D30 横向对比）
- `charts/T{n}_retention_heatmap.png`、`charts/T{n}_cluster_curves.png`

## 数字契约

- **cohort_size 必报**（< 1000 的 cohort 留存波动太大，不能直接对比）
- 至少给 D1 / D7 / D30 三个点
- LT 外推 R² < 0.8 → 标"低置信"，不外推到 D60+
- 留存 % 保留 1 位小数（如 32.5%）

## 反模式

- ✗ 单一 cohort 不做对比
- ✗ Day-1 数据没隔离同日多次回流（用注册当日 = Day 0 还是 Day 1 要明示）
- ✗ 不给 cohort size（小 cohort 噪声大）
- ✗ heatmap 没 annot（看不到具体值）
- ✗ 不区分新老用户的 cohort（关键拆分维度）

## STATE.md 标注

```
- [ ] T2. [留存] v7.2 推全后 cohort × Day-N 留存矩阵
```
