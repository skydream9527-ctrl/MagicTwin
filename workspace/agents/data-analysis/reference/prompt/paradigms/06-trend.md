# 范式 6 · 趋势分析（Trend）

## 何时

用户问 "长期看 / 走势 / 拐点 / 增长率 / 是不是在涨/跌"

## 核心问题

「长期方向是什么？什么时候转折？是真趋势还是噪声叠加？」

## Phase 5 报告必填 sections

| Section | 必填字段 |
|---|---|
| ① 时间窗 | 明确 N 天 / N 周（**短于 14 天不允许下"趋势"结论**）|
| ② 平滑视图 | MA-7 / MA-28 / 季节分解（至少一项）|
| ③ 趋势量化 | 线性回归斜率 + **R²**；R² < 0.3 标"趋势弱" |
| ④ 变点检测 | 关键拐点日期 + 关联事件（推全/活动/异常）|
| ⑤ 短期 vs 长期一致性 | 标"一致" / "背离" |

## 必嵌可视化

- 双线趋势图（原始 + 平滑 MA）→ PNG（matplotlib，含 title / 轴标签 / 图例）
- 变点检测的 PNG（来自 Python ruptures）

## SQL（基础趋势 + MA）

```sql
WITH base AS (
  SELECT date, value
  FROM core_metrics
  WHERE date BETWEEN '<start>' AND '<end>'
    AND <过滤条件>
)
SELECT
  date, value,
  AVG(value) OVER (ORDER BY date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS ma7,
  AVG(value) OVER (ORDER BY date ROWS BETWEEN 27 PRECEDING AND CURRENT ROW) AS ma28
FROM base
ORDER BY date;
```

落 CSV：`data/T{n}_trend.csv` schema: `date, value, ma7, ma28`

### 线性斜率（SQL 版）

```sql
WITH base AS (
  SELECT date, value, ROW_NUMBER() OVER (ORDER BY date) AS x FROM <table>
  WHERE date BETWEEN '<start>' AND '<end>'
)
SELECT
  REGR_SLOPE(value, x)     AS slope,
  REGR_INTERCEPT(value, x) AS intercept,
  REGR_R2(value, x)        AS r2,
  COUNT(*)                 AS n_days
FROM base;
```

## Python 增强（必走）

**变点检测 + STL 分解** SQL 算不了：
- 变点：→ [skills/nl-python/reference/changepoint.md](../../../../skills/nl-python/reference/changepoint.md)
- 周期剥离：→ [skills/nl-python/reference/decomposition.md](../../../../skills/nl-python/reference/decomposition.md)

输出：
- `data/T{n}_breakpoints.csv`（变点表）
- `data/T{n}_segments.csv`（段间统计）
- `charts/T{n}_changepoints.png`、`charts/T{n}_stl.png`

## 数字契约

- 必给 R² 才能下"线性趋势"结论
- 至少 14 天才能下"趋势"
- 平滑用 MA-7（去日波动）+ MA-28（看长期）双线
- 变点必带 `jump_in_sigma`（标准化偏差）

## 反模式

- ✗ 不平滑就喊"波动大" → 先 MA-7
- ✗ 没 R² 就下"线性"结论
- ✗ 14 天内的数据下"长期趋势" → 拒绝
- ✗ 变点不关联事件（标 `[未知]` 优于不报）

## STATE.md 标注

```
- [ ] T1. [趋势] 大盘 DAU 近 90d 趋势 + 变点检测
```
