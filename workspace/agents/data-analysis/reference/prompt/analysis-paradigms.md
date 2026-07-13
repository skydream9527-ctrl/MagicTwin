# 8 Analysis Paradigms（分析范式总表）

Phase 2 拆解任务时，**每个子任务必须打 1 个 paradigm tag**。Phase 4 按 tag 决定走 SQL-only 还是 SQL+Python；Phase 5 报告按 tag 决定 section 模板。

| # | Paradigm | 何时 | 用 SQL | 用 Python? | 详见 |
|---|---|---|---|---|---|
| 1 | **对比分析** Comparative | 用户给 A/B 两个对照对象 | ✅ | 可（bootstrap CI / KS test） | [01-comparative.md](paradigms/01-comparative.md) |
| 2 | **指标拆解归因** Decomposition | "Y 怎么来的 / 谁占大头" | ✅ | 可（非线性归因 / SHAP） | [02-decomposition.md](paradigms/02-decomposition.md) |
| 3 | **波动分析** Fluctuation | "波动 / 不稳定 / 单日跳变" | ✅ | **必**（STL 周期剥离） | [03-fluctuation.md](paradigms/03-fluctuation.md) |
| 4 | **漏斗分析** Funnel | "转化 / 流失 / 入口→出口" | ✅ | 可（Sankey / 存活分析） | [04-funnel.md](paradigms/04-funnel.md) |
| 5 | **分布分析** Distribution | "人均 / 长尾 / 头部 / 集中度" | ✅ | **必**（双峰检测 / gini / curve fit） | [05-distribution.md](paradigms/05-distribution.md) |
| 6 | **趋势分析** Trend | "长期看 / 拐点 / 走势" | ✅ | **必**（变点检测 / STL） | [06-trend.md](paradigms/06-trend.md) |
| 7 | **留存分析** Retention | "留存 / 回访 / Day-N / cohort" | ✅ | 可（cohort 聚类 / 曲线拟合） | [07-retention.md](paradigms/07-retention.md) |
| 8 | **预测分析** Predictive | "未来 / 预测 / 接下来 / 推全后" | 8a-c | **必** 8d/8e/8f | [08-predictive.md](paradigms/08-predictive.md) |

---

## 业务命题 → 范式组合（参考表）

| 业务命题 | 范式组合 |
|---|---|
| 指标异动归因 | T1 [波动] → T2 [拆解] → T3 [对比] → T4 [分布] |
| 新功能 launch review | T1 [对比] → T2 [漏斗] → T3 [留存] → T4 [分布] 副作用 |
| 灰度推全决策 | T1 [对比] → T2 [波动] → T3 [预测/线性外推] → T4 [预测/what-if] |
| 季度冲刺评估 | T1 [趋势] → T2 [预测/类比] → T3 [预测/what-if] |
| 节假日影响预估 | T1 [预测/类比] + T2 [波动] |
| 新功能渗透率到平衡 | T1 [趋势] → T2 [预测/线性外推] |
| 周报 / 例行复盘 | T1 [对比] → T2 [波动] → T3 [趋势] → T4 [分布] → T5 [预测/线性外推] 可选 |
| 频道 / 体裁结构变化 | T1 [分布] → T2 [对比] → T3 [拆解] |
| LT-DAU 评估 | T1 [留存] → T2 [预测/留存曲线外推] |

---

## 通用 Format 约束（所有范式共享）

### 数字格式（强制）

| 类型 | 格式 | 示例 |
|---|---|---|
| 百分比 | 保留 1 位小数 + 带符号 | `+5.3%` / `-12.0%` |
| 绝对量 | K/M/B 自动单位，2 位有效数字 | `1.2M`、`348K` |
| 同 / 环比 | 必带方向符号 | `▲ +3.2%` / `▼ -8.1%` |
| 置信区间 | `[a, b]` | `[+2.1%, +5.4%]` |
| 占比 | Σ 必校验 100% | 不允许 ✗ "其它 / 略" 当兜底 |

### 表格列序（强制 schema）

- 时间序列表：`维度 | 当期 | 对标 | Δ | Δ%`
- 对照表：`维度 | 对照组 | 实验组 | Δ | p-value*`
- 排名表：`# | 维度值 | 指标值 | 占比 | Δ`
- 结构表：`segment | 值 | 占比% | 同比 | 环比`

### Callout 句式（强制 4-元组）

```
{方向} + {幅度} + {对标窗} + {主因}
例: ▼ -4.8% (近14天环比) · 主因 v7.2 视频体裁掉 -8.2bp
```

不允许 callout 超过一句。

### 图表模板（强制 PNG）

所有图表用 execute_python（matplotlib / seaborn）出 PNG 落 `charts/T{n}_*.png`，再嵌入报告。**禁止在 markdown 里写 ```mermaid``` 块。**

- 趋势图：必有 title / x-axis label / y-axis label / 单位 / 图例（双线时）
- 因果链 / 流程图：必有 start node + 终点 node 标记，可用 networkx + matplotlib 或 graphviz
- 饼图：仅用于 ≤ 6 segment 的结构；> 6 切 stacked bar

### 禁用语言清单

- ✗ 略有 / 大概 / 可能 / 似乎 → 改为定量或明确标 `[假设]`
- ✗ 略有上升 → 给数字
- ✗ 建议关注 → 改为具体动作 + 触发条件
- ✗ 总体表现良好 → 给 KPI 表
- ✗ 数据显示 / 从图中可见 → 直接给数

---

## STATE.md 里的 paradigm 标注

```markdown
## 任务拆解
- [x] T1. [波动] 主指标异动确认 — 核心指标近 14d ±2σ 检测
- [ ] T2. [拆解] 频道贡献度分解 — UV = Σ(channel_uv)
- [ ] T3. [预测/线性外推] T+30 投影
```

每个 T 必带方括号范式 tag；多 tag 用 `[A] [B]` 表示组合。
