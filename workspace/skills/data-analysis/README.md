# 数据分析 Skill

通用数据分析能力，与 MagicTwin 的数据分析 Agent 配合使用。

## 功能

- **NL → SQL**：自然语言转 SQL 查询（仅只读 SELECT，自动拦截写操作）
- **趋势分析**：计算同比 / 环比，给出趋势方向与变化率
- **异常归因**：多维度下钻，定位指标波动的根因
- **结构化输出**：指标名 / 日期 / 数值 / 环比 / 异常标签

## 使用方式

### 1. 演示模式（开箱即用）

默认 `QUERY_BACKEND=sample`，返回示例数据，无需配置真实数据源即可体验完整编排流程。

### 2. 接入真实数据源

设置环境变量：

```bash
QUERY_BACKEND=command
QUERY_COMMAND="your-cli {sql}"
```

- `{sql}` 占位符会被替换为实际 SQL
- 查询适配器会自动校验 SQL 为只读 SELECT，拦截 DDL / DML
- 结果受 `QUERY_ROW_LIMIT`（默认 2000）截断保护

### 3. 自定义适配器

在 `server/integrations/data-query.js` 中扩展新的 backend 类型：

```javascript
if (backend === "mysql") {
  // 接入 MySQL / PostgreSQL / ClickHouse 等
  // 返回 { ok, columns, rows, records, rowCount, ms }
}
```

## 安全约束

- 只允许 `SELECT` 语句，自动拦截 `INSERT / UPDATE / DELETE / DROP / ALTER / CREATE`
- SQL 通过白名单校验后才执行
- 行数受 `QUERY_ROW_LIMIT` 限制
