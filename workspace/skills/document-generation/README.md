# 文档生成 Skill

通用的文档生成与处理能力。

## 功能

- **Markdown 渲染**：Markdown → HTML / PDF
- **报告生成**：数据 + 模板 → 结构化报告
- **文档大纲**：自动提取 / 生成文档大纲
- **格式化输出**：标题层级、表格、代码块、高亮

## 使用方式

### 前置依赖

```bash
npm install marked markdown-it
```

### 示例：数据报告生成

```javascript
import { marked } from "marked";

function generateReport({ title, summary, metrics, conclusions }) {
  const md = `# ${title}

## 摘要
${summary}

## 核心指标
| 指标 | 数值 | 环比 |
|------|------|------|
${metrics.map(m => `| ${m.name} | ${m.value} | ${m.mom}% |`).join("\n")}

## 结论
${conclusions.map(c => `- ${c}`).join("\n")}
`;
  return marked.parse(md);
}
```

## 与 MagicTwin 集成

样式优化 Agent 负责最终交付物的排版与格式化，此 skill 提供底层文档生成能力。
