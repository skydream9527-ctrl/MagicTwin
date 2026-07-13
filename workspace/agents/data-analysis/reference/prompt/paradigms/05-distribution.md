# 范式 5 · 分布分析（Distribution）

## 何时

用户问 "人均 / 长尾 / 头部 / 集中度 / 分位 / 高低"

## 核心问题

「指标在用户/内容上是什么形状？平均、头部主导，还是双峰？分布在变吗？」

## Phase 5 报告必填 sections

| Section | 必填字段 |
|---|---|
| ① 描述性统计 | `mean / median / P10 / P50 / P90 / P99 / max` 一行 |
| ② 形态判定 | 正态 / 长尾 / 双峰 + **判据**（P90/P50 比值 / skew / kurtosis）|
| ③ 头/腰/尾占比 | Top 1% / 50-99% / 0-50% 各贡献多少 |
| ④ 集中度 | 基尼系数 或 HHI（二选一）|
| ⑤ 时间演化 | 与上周 / 上月分布对比，标"分布在变" or "稳定" |

## 必嵌可视化

- 直方图 + 累积分布（PNG，来自 Python）

## SQL（基础分位 + Top 占比）

```sql
WITH ranked AS (
  SELECT user_id, value,
         ROW_NUMBER() OVER (ORDER BY value DESC) AS rk,
         COUNT(*) OVER () AS n
  FROM core_metrics
  WHERE date BETWEEN '<start>' AND '<end>'
    AND <过滤条件>
)
SELECT
  COUNT(*)                              AS n,
  AVG(value)                            AS mean_v,
  PERCENTILE_APPROX(value, 0.10)        AS p10,
  PERCENTILE_APPROX(value, 0.50)        AS p50,
  PERCENTILE_APPROX(value, 0.90)        AS p90,
  PERCENTILE_APPROX(value, 0.99)        AS p99,
  MAX(value)                            AS max_v,
  STDDEV(value)                         AS std_v,
  SUM(CASE WHEN rk <= n*0.01 THEN value ELSE 0 END) / NULLIF(SUM(value), 0) AS top1pct_share,
  SUM(CASE WHEN rk <= n*0.10 THEN value ELSE 0 END) / NULLIF(SUM(value), 0) AS top10pct_share
FROM ranked;
```

为了 Python 的 gini / 双峰检测 / curve fit，**还需要落明细级 CSV**（不只是聚合）：

```sql
-- 明细落地（如果 N > 1M，先 sample 到 100K 即可）
SELECT user_id, value
FROM core_metrics
WHERE date BETWEEN '<start>' AND '<end>'
  AND <过滤条件>
TABLESAMPLE BERNOULLI(<采样率>);   -- 视引擎语法
```

落到 `data/T{n}_user_consumption.csv` schema: `user_id, value`

## Python 增强（必走）

形态判定 / 双峰检测 / gini / curve fit / KS test → Python：
→ [skills/nl-python/reference/distribution.md](../../../../skills/nl-python/reference/distribution.md)

输出 `data/T{n}_distribution.csv` + `charts/T{n}_distribution.png`。

## 数字契约

- mean、median 都给（长尾时 mean 不可信）
- 至少 P10 / P50 / P90 / P99 四个分位
- gini 报到 3 位小数
- 双峰判据明示（KMeans inertia 比值）

## 反模式

- ✗ 只给均值（被极值带偏）
- ✗ 不给 P99（高分位是头部洞察）
- ✗ 不区分头 / 腰 / 尾
- ✗ 形态判断只靠肉眼（必须给数值判据）
- ✗ "分布稳定" 不给上周对比数据

## STATE.md 标注

```
- [ ] T3. [分布] 核心用户人均消费分布 + gini
```
