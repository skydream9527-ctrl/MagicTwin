# 范式 4 · 漏斗分析（Funnel）

## 何时

用户提到 "转化 / 流失 / 一步步走 / 入口→中间→出口 / 漏斗"

## 核心问题

「用户在哪一步流失最重？优化哪一步 ROI 最大？」

## Phase 5 报告必填 sections

| Section | 必填字段 |
|---|---|
| ① 漏斗定义 | 每步：事件 / 触发条件 / 归因窗口（**所有步窗口必须一致**）|
| ② 漏斗表 | `步骤 \| UV \| 步转化% \| 累计转化%` |
| ③ 流失诊断 | `步骤 \| 流失 UV \| 占总流失% \| 主要流失原因（如有埋点）`|
| ④ 漏斗形状对比 | 当前 vs 历史 / vs 大盘 / vs 实验组（至少一组）|
| ⑤ 优化优先级 | 按 `该步流失绝对量 × 该步可优化空间` 排序 |

## 必嵌可视化

- funnel chart 或阶梯柱状图（PNG）；Mermaid 不直接支持 funnel，可用阶梯 bar chart

## SQL 模板（多步漏斗）

```sql
-- 关键：所有步必须用相同的归因时间窗 + 同一批用户
WITH step1_users AS (
  SELECT DISTINCT user_id
  FROM events
  WHERE event = '<step1_event>'
    AND date BETWEEN '<start>' AND '<end>'
),
step2_users AS (
  SELECT DISTINCT e.user_id
  FROM events e
  INNER JOIN step1_users s ON e.user_id = s.user_id
  WHERE e.event = '<step2_event>'
    AND e.date BETWEEN '<start>' AND '<end>'
),
step3_users AS (
  SELECT DISTINCT e.user_id
  FROM events e
  INNER JOIN step2_users s ON e.user_id = s.user_id
  WHERE e.event = '<step3_event>'
    AND e.date BETWEEN '<start>' AND '<end>'
)
SELECT
  '1_曝光' AS step, COUNT(*) AS uv FROM step1_users
UNION ALL
SELECT '2_点击', COUNT(*) FROM step2_users
UNION ALL
SELECT '3_转化', COUNT(*) FROM step3_users
ORDER BY step;
```

落 CSV：`data/T{n}_funnel.csv` schema:
```
step,uv,step_conv_rate,cumulative_conv_rate,drop_uv,drop_share
1_曝光,1000000,1.000,1.000,0,0
2_点击,420000,0.420,0.420,580000,0.580
3_转化,89000,0.212,0.089,331000,0.331
```

> 注意 `INNER JOIN step1_users` 这个写法保证 step2 的 UV 一定是从 step1 走过来的（漏斗严格序列）。如果是"曾经做过 step1 + 曾经做过 step2"的松散漏斗，去掉 INNER JOIN 但要标注。

## Python 增强（可选）

仅当需要 **Sankey 多路径漏斗** 或 **存活分析**（用户 N 秒/N 分钟内是否完成）时调 Python。本范式 SQL 已足够大多数场景。

## 数字契约

- 所有步用同一 `[start, end]` 归因窗口
- 标注 dedup 方式（DISTINCT user_id 还是事件次数）
- 漏斗各步必报 UV、步转化、累计转化
- 流失 % 必校验 = 1 - 累计转化

## 反模式

- ✗ 只给最终转化率（缺中间步）
- ✗ 各步时间窗口不一致（step1 是 7 天，step2 是 1 天）
- ✗ 不标 dedup 方式（user_id distinct 还是 session 还是 event）
- ✗ 不做对比（vs 历史 / vs 大盘 至少一组）
- ✗ "优化第 N 步"建议没带 ROI 估算

## STATE.md 标注

```
- [ ] T2. [漏斗] 推送 4 步漏斗：曝光 → 点击 → 进入 → 转化
```
