# 范式 8 · 预测分析（Predictive / Forecasting）

## 何时

用户说 "未来 / 接下来 / 明天 / 下周 / 月底 / 推全后 / 预计 / 如果 X 会怎样"

## 核心问题

「基于已知数据，T 时刻 Y 大概是什么水平？哪些事件会让预测失效？」

## 6 个子模式（前 3 SQL，后 3 Python）

| 子模式 | 方法 | 实现 | 何时用 |
|---|---|---|---|
| **8a 线性外推** | OLS / 多项式 | SQL `regr_*` | 短期、单调趋势、N ≥ 14 天 |
| **8b 历史类比** | 缩放映射 | SQL CTE | 节假日 / 周期事件 |
| **8c What-if 模拟** | 公式驱动 | SQL | 灰度推全 / 战略情景 |
| **8d 时序预测** | Prophet / SARIMA / STL+ARIMA | Python | 月度以上、有明显周期 |
| **8e 留存曲线外推** | 幂律 / 指数拟合 | Python | 从 D1/D7/D30 推 LT-DAU |
| **8f 变点预测** | PELT 检测 + 段外推 | Python | 拐点关联事件 |

## 能力边界声明（必前置给用户看）

> 本 agent 的预测能力限于**SQL-OLS / 历史类比 / 公式 what-if / Prophet / SARIMA / STL+ARIMA / curve fit / ruptures**。不支持深度学习时序模型 / 因果推断（DID/PSM）/ 复杂强化学习。需要这些请告知，引导用其它工具。

---

## 8a · 线性外推（SQL）

```sql
WITH series AS (
  SELECT date, metric,
         ROW_NUMBER() OVER (ORDER BY date) AS x
  FROM core_metrics WHERE date BETWEEN '<start>' AND '<end>'
),
fit AS (
  SELECT REGR_SLOPE(metric, x)     AS slope,
         REGR_INTERCEPT(metric, x) AS intercept,
         REGR_R2(metric, x)        AS r2,
         STDDEV(metric)            AS std,
         MAX(x)                    AS x_max,
         COUNT(*)                  AS n
  FROM series
)
SELECT slope * (x_max + 7) + intercept   AS pred_t7,
       slope * (x_max + 30) + intercept  AS pred_t30,
       slope * (x_max + 7) + intercept - 1.28 * std  AS p10_t7,
       slope * (x_max + 7) + intercept + 1.28 * std  AS p90_t7,
       r2, n
FROM fit;
```

| Section | 必填 |
|---|---|
| ① 历史窗 | N ≥ 14 才允许（< 14 拒绝）|
| ② 拟合 | slope / intercept / **R²**；R² < 0.5 标 `[低置信]` |
| ③ 预测点 | T+1 / T+7 / T+30 + 80% 区间 [P10, P90] |
| ④ 假设 | "假设近期斜率延续 / 无重大事件 / 周期已剥离" |
| ⑤ 失效条件 | **≥ 2 条**（推全 / 活动 / 节日 / 政策）|

## 8b · 历史类比（SQL）

```sql
-- 用上周同期作为"类比期"
WITH analog AS (
  SELECT date, metric AS analog_value
  FROM core_metrics
  WHERE date BETWEEN '<analog_start>' AND '<analog_end>'
),
current AS (
  SELECT date, metric AS current_value
  FROM core_metrics
  WHERE date BETWEEN '<current_start>' AND '<current_end>'
),
scale AS (
  SELECT AVG(c.current_value) / NULLIF(AVG(a.analog_value), 0) AS k
  FROM current c, analog a
  WHERE DATEDIFF(c.date, a.date) = 7    -- 同 day-of-week 对齐
)
SELECT a.date, a.analog_value,
       a.analog_value * s.k AS predicted_value, s.k
FROM analog a CROSS JOIN scale s;
```

| Section | 必填 |
|---|---|
| ① 类比期定义 | 上周 / 上月 / 去年同期 / 上次类似事件后 |
| ② 类比依据 | 一句理由（同活动 / 同周内位置 / 同版本节奏）|
| ③ 类比映射 | `历史值 \| 缩放系数 \| 当期预测值` |
| ④ 误差带 | min / max / 实际 σ |
| ⑤ 相似度 | 高 / 中 / 低 + 一句理由 |

## 8c · What-if 公式模拟（SQL）

```sql
-- 假设拆解公式：消费UV = DAU × 渗透率 × 人均消费次数
WITH base AS (
  SELECT 1500000 AS dau, 0.20 AS penetration, 3.5 AS uv_per_user
)
SELECT 'baseline' AS scen,
       dau * penetration * uv_per_user AS pred_uv
FROM base
UNION ALL
SELECT '保守: -5% DAU',
       dau*0.95 * penetration * uv_per_user FROM base
UNION ALL
SELECT '中性',
       dau * penetration * uv_per_user FROM base
UNION ALL
SELECT '乐观: +5% 渗透',
       dau * penetration*1.05 * uv_per_user FROM base;
```

| Section | 必填 |
|---|---|
| ① 拆解公式 | 已闭环（来自范式 2，Σ 误差 < 1%）|
| ② 当前基准 | 各分项实测值 |
| ③ **≥ 3** 情景 | 保守 / 中性 / 乐观；每情景列每分项变化 % |
| ④ 模拟结果 | 每情景的主指标预测 + Δ% |
| ⑤ 敏感度 | **弹性系数排序**（哪个分项变化对主指标影响最大）|

## 8d · 时序预测（Python · Prophet / SARIMA）

→ [skills/nl-python/reference/forecasting.md](../../../../skills/nl-python/reference/forecasting.md)

| Section | 必填 |
|---|---|
| ① 模型选择 | Prophet（多周期/节假日）/ SARIMA（强自相关）/ STL+ARIMA（先剥周期）|
| ② 训练数据 | ≥ 28 天（Prophet），≥ 90 天（SARIMA）|
| ③ 预测点 + 区间 | T+7 / T+30，yhat + 80% 区间 |
| ④ 残差检查 | holdout MAPE / RMSE（最后 7 天作 validation）|
| ⑤ 失效条件 | 检测到的 anomaly + 已知未来事件未编码 |
| ⑥ 模型 artifact | `models/T{n}_*.pkl` 留痕 |

## 8e · 留存曲线外推（Python）

→ [skills/nl-python/reference/cohort-curve.md](../../../../skills/nl-python/reference/cohort-curve.md)

| Section | 必填 |
|---|---|
| ① cohort 选择 | 用了哪一组 cohort 拟合，cohort 大小 |
| ② 拟合模型 | 幂律 / 指数 + 截距 / 双段 |
| ③ 拟合参数 | a, b + **R²**（R² < 0.8 不允许外推到 D60+）|
| ④ 外推点 | D30 / D60 / D90 / **LT-DAU 积分** |
| ⑤ 模型对比 | 至少试 2 种函数族 |

## 8f · 变点预测（Python）

→ [skills/nl-python/reference/changepoint.md](../../../../skills/nl-python/reference/changepoint.md)

变点本身是 backward-looking，但**最近一段的趋势** + 段稳定性是 forward-looking 的依据：

| Section | 必填 |
|---|---|
| ① 检测方法 | PELT / BinSeg + penalty 计算公式 |
| ② 变点表 | `日期 \| 段内均值 \| 段内 std \| 段长` |
| ③ 事件关联 | 每个变点关联 ≥0 个已知事件，无关联标 `[未知]` |
| ④ 显著性 | 段间均值差 vs 段内 std 比值（`jump_in_sigma`）|
| ⑤ 后续监控 | 当前是否还在最新段 / 是否接近下个变点 |

---

## 通用反模式（预测专属）

- ✗ 给点估计不给区间
- ✗ 不显式声明前提假设
- ✗ 不列失效条件
- ✗ 不标置信度（高/中/低）
- ✗ 用 SQL 跑不出来的方法（Prophet）却没切到 Python
- ✗ 把 yhat 描述成"会"而不是"在 X 假设下大约"
- ✗ R² < 0.5 还给 30 天预测不标低置信

## STATE.md 标注

```
- [ ] T3. [预测/线性外推] 灰度组 vs 对照组差距外推到全量推全后
- [ ] T4. [预测/8d Prophet] DAU 未来 30 天预测
- [ ] T5. [预测/8e 留存外推] LT-DAU 积分到 D90
```
