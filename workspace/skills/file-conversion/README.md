# 文件转换 Skill

通用文件格式转换能力。

## 支持的转换

| 源格式 | 目标格式 | 说明 |
|--------|----------|------|
| Excel (.xlsx) | CSV | 导出为 CSV |
| CSV | Excel | 导入为 Excel |
| Excel / CSV | JSON | 转为 JSON 数组 |
| JSON | Excel / CSV | 从 JSON 生成表格 |
| Markdown | HTML | 渲染为 HTML |
| HTML | Markdown | 提取正文转 Markdown |
| PPT | Markdown | 提取大纲 |
| Markdown | PPT | 大纲生成 PPT |

## 使用方式

### 前置依赖

```bash
npm install xlsx marked turndown
```

### 示例

```javascript
import * as XLSX from "xlsx";
import { marked } from "marked";
import TurndownService from "turndown";

// CSV → JSON
const data = XLSX.readFile("input.csv");
const json = XLSX.utils.sheet_to_json(data.Sheets[data.SheetNames[0]]);

// Markdown → HTML
const html = marked.parse("# Hello World");

// HTML → Markdown
const tds = new TurndownService();
const md = tds.turndown("<h1>Hello World</h1>");
```
