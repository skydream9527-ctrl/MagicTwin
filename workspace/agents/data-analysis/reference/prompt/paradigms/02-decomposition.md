# 范式 2 · 指标拆解归因（Decomposition & Attribution）

## 何时

用户问 "Y 是怎么算出来的？哪部分占大头？跌的来源是什么？"

## 核心问题

「Y 怎么分解成 ΣXi（加法）或 ΠXi（乘法）？谁的贡献最大？Σ 贡献必须等于 ΔY（闭环）。」

## 两种拆解模式

| 模式 | 公式 | 例 |
|---|---|---|
| **加法** | `Y = X1 + X2 + ... + Xn` | DAU = 新用户 + 老用户回访 + 召回；UV = Σ frequency_bucket |
| **乘法** | `Y = X1 × X2 × ... × Xn` | 消费UV = DAU × 渗透率 × 人均消费次数 |

加法 / 乘法**不能混用**。乘法拆解的 ΔY 用对数法或链式法分解贡献度。

## Phase 5 报告必填 sections

| Section | 必填字段 |
|---|---|
| ① 拆解公式 | 明示 `Y = X1 + X2` 或 `Y = X1 × X2` |
| ② 各项贡献表 | `分项 \| 当期 \| 对标 \| Δ绝对量 \| 对 ΔY 的贡献 bp` |
| ③ **闭环校验** | **Σ 贡献 ≈ ΔY**（差额 < 1% 才放行；若不闭环要排查口径）|
| ④ Top 1 贡献项再拆一层 | 最多 1 层，避免无限套娃 |
| ⑤ 结构性 / 周期性 标注 | 每个主因打 `[结构]` / `[周期]` / `[一次性]` 标签 |

## 必嵌可视化

- **瀑布图**（Mermaid 不直接支持，可用 ascii art 或 Python matplotlib 出 PNG）

```
ΔY = -4.8%
├── 视频体裁:      -3.5pp [结构]
├── 图文体裁:      -0.8pp [周期]
├── 小视频体裁:    -0.5pp [结构]
└── 残差:           +0.0pp
```

## SQL 模板（加法拆解）

```sql
WITH cur AS (
  SELECT segment, SUM(value) AS v_cur
  FROM core_metrics
  WHERE date BETWEEN '<cur_start>' AND '<cur_end>'
  GROUP BY segment
),
ref AS (
  SELECT segment, SUM(value) AS v_ref
  FROM core_metrics
  WHERE date BETWEEN '<ref_start>' AND '<ref_end>'
  GROUP BY segment
),
delta AS (
  SELECT
    COALESCE(c.segment, r.segment) AS segment,
    COALESCE(c.v_cur, 0) AS v_cur,
    COALESCE(r.v_ref, 0) AS v_ref,
    COALESCE(c.v_cur, 0) - COALESCE(r.v_ref, 0) AS d_abs
  FROM cur c FULL OUTER JOIN ref r ON c.segment = r.segment
),
total AS (
  SELECT SUM(d_abs) AS total_delta FROM delta
)
SELECT d.segment, d.v_cur, d.v_ref, d.d_abs,
       d.d_abs / NULLIF(t.total_delta, 0) AS contribution_share
FROM delta d, total t
ORDER BY ABS(d.d_abs) DESC;
```

落 CSV：`data/T{n}_decomposition.csv` schema: `segment, v_cur, v_ref, d_abs, contribution_share`

## 乘法拆解（用对数法，避免交叉项失衡）

```
ln(Y) = ln(X1) + ln(X2) + ln(X3)
ΔY/Y ≈ ΔX1/X1 + ΔX2/X2 + ΔX3/X3   （小变化时近似）
```

精确公式（链式贡献）：
```
ΔY = (X1' - X1) · X2 · X3                    [X1 贡献，X2/X3 用 ref 值]
   + X1' · (X2' - X2) · X3                   [X2 贡献，X1 用 cur 值]
   + X1' · X2' · (X3' - X3)                  [X3 贡献]
```

## 数字契约

- Σ 贡献 = ΔY（差额 < 1% 才允许进 Phase 5）
- 贡献 bp 至少 4 位有效数字
- 排序按 |贡献| 降序
- 残差行**必报**（剩下没拆出来的部分）

## 反模式

- ✗ Σ 贡献 ≠ ΔY 还出报告
- ✗ 拆超过 2 层（信息过载）
- ✗ 加法 / 乘法混用（口径不一致）
- ✗ 不报"残差"（剩余项必显）
- ✗ 只看绝对差不看占比

## STATE.md 标注

```
- [ ] T2. [拆解] 核心指标异动按维度加法拆解
```
