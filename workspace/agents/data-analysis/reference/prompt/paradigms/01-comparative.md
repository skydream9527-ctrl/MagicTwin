# 范式 1 · 对比分析（Comparative）

## 何时

用户给出**两个对照对象**：
- 时间窗 A vs B（如 "上线前 14 天 vs 上线后 14 天"）
- 实验组 vs 对照组（无 AB ID；有 AB ID 走 ab-experiment Agent）
- 频道 X vs Y / 版本 X vs Y / 群体 X vs Y

## 核心问题

「A 和 B 比，差异多大？显著吗？差异来自哪些 segment？」

## Phase 5 报告必填 sections

| Section | 必填字段 |
|---|---|
| ① 对照定义 | A / B 的口径、时间窗、**样本量 N**（缺 N 不通过自检）|
| ② 主指标对比 | `维度 \| A值 \| B值 \| Δ \| Δ%` 一行 + 显著性标记 |
| ③ 分维度对比 (≤3 维) | 每维同样格式，按 \|Δ\| 排序 |
| ④ 一致 vs 差异总结 | 哪些指标 A==B（可平行使用），哪些显著差 |

## 必嵌可视化

- **grouped bar 对照图**（Mermaid 不支持，用 Python matplotlib 出 PNG，或手画 ascii）

## SQL 模板（基础对照）

```sql
-- 单条 SQL 用 UNION ALL 同时跑 A 和 B
WITH a AS (
  SELECT 'A' AS group_label, COUNT(DISTINCT user_id) AS n,
         AVG(metric) AS metric_mean, STDDEV(metric) AS metric_std
  FROM core_metrics
  WHERE date BETWEEN '<A_start>' AND '<A_end>'
    AND <过滤条件>
),
b AS (
  SELECT 'B' AS group_label, COUNT(DISTINCT user_id) AS n,
         AVG(metric) AS metric_mean, STDDEV(metric) AS metric_std
  FROM core_metrics
  WHERE date BETWEEN '<B_start>' AND '<B_end>'
    AND <过滤条件>
)
SELECT * FROM a UNION ALL SELECT * FROM b;
```

落 CSV：`data/T{n}_compare_summary.csv`（如有显著性需要，再落明细 `data/T{n}_compare_raw.csv`）。

## Python 增强（可选）

仅当需要 **bootstrap 95% CI / permutation p / KS test** 时调 nl-python：
→ [skills/nl-python/reference/comparative-stats.md](../../../../skills/nl-python/reference/comparative-stats.md)

输入 `data/T{n}_compare_raw.csv`（schema: `group, value`），输出 `data/T{n}_comparison.csv` + `charts/T{n}_comparison.png`。

## 数字契约

- A / B 都必报 N（样本量）
- Δ 同时给绝对差和 Δ%
- p-value 报到 4 位小数
- 显著性结论必带依据（CI 跨 0 / p < 0.05）

## 反模式

- ✗ 不报样本量
- ✗ 不标"显著 / 不显著 / 噪声 / 无法判断"
- ✗ 把多维差异平铺不分主次
- ✗ p < 0.05 只喊"显著"不报效应量（CI 区间 + 绝对差更可信）

## STATE.md 标注

```
- [ ] T2. [对比] A 时段 vs B 时段 — 主指标 + 3 维下钻
```
