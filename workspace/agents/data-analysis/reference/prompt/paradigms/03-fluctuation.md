# 范式 3 · 波动分析（Fluctuation / Volatility）

## 何时

用户描述指标 "波动 / 不稳定 / 单日跳变 / 是异常吗"

## 核心问题

「这是噪声还是信号？多少算异常？周期性影响剥离后还剩什么？」

## Phase 5 报告必填 sections

| Section | 必填字段 |
|---|---|
| ① 波动度量 | std + CV（变异系数）+ 极差 — **至少 std + CV 两项** |
| ② 基线 + 阈值 | 过去 N 天均值 ± 2σ；**N 必须明示** |
| ③ 异动点表 | 超出 ±2σ 的日子按时间序列出（日期 / 实际值 / 偏差 σ 数 / `[已解释]` 或 `[未解释]`）|
| ④ 周期性剥离 | 标注周末 / 月底 / 节日效应（如有），剥离后再判断 |
| ⑤ 信号 vs 噪声判定 | 一句话明确结论 + 置信依据 |

## 必嵌可视化

- 时间序列 + ±2σ 上下带 PNG（来自 Python STL 分解；matplotlib 出图）

## SQL（基础版：均值 / σ + 异动天数）

```sql
WITH base AS (
  SELECT date, value
  FROM core_metrics
  WHERE date BETWEEN '<start>' AND '<end>'
    AND <过滤条件>
),
stats AS (
  SELECT AVG(value) AS mu, STDDEV(value) AS sigma FROM base
)
SELECT b.date, b.value, s.mu, s.sigma,
       (b.value - s.mu) / NULLIF(s.sigma, 0) AS z,
       CASE WHEN ABS((b.value - s.mu) / NULLIF(s.sigma, 0)) > 2
            THEN 1 ELSE 0 END AS is_anomaly
FROM base b CROSS JOIN stats s
ORDER BY b.date;
```

落 CSV：`data/T{n}_baseline.csv`。异动点 SQL `WHERE is_anomaly=1` 二次落。

## Python 增强（必走）

**STL 周期剥离**是这个范式的核心—— SQL 算不了：
→ [skills/nl-python/reference/decomposition.md](../../../../skills/nl-python/reference/decomposition.md)

输入 `data/T{n}_baseline.csv`，输出：
- `data/T{n}_decomposition.csv` — 含 trend / seasonal / resid 三列
- `data/T{n}_anomalies.csv` — |resid| > 2σ_resid 的日子
- `charts/T{n}_stl.png` — 四宫格 observed / trend / seasonal / resid

## 数字契约

- σ_resid（剥周期后的残差标准差），不是 σ_observed
- 异动点必给 `resid_in_sigma`（标准化偏差）
- variance breakdown：trend X% / seasonal X% / resid X%

## 反模式

- ✗ 只给均值不给 σ
- ✗ 把单日跳变直接说成趋势（没剥周期 / 没看 resid）
- ✗ 异动判据用 |Δ| > 1σ（太敏感，按 2σ 起）
- ✗ 异动点不分 `[已解释]` / `[未解释]`（找到事件归因前不能下结论）

## STATE.md 标注

```
- [ ] T1. [波动] 核心指标近 28d 基线 + STL 异动检测
```
