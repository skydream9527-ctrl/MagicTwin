# PPT 处理 Skill

通用的 PowerPoint 文件处理能力。

## 功能

- **读取解析**：解析 `.pptx` 文件，提取每页文本、图片、表格
- **内容提取**：按页提取标题、正文、备注
- **大纲生成**：从 PPT 内容生成 Markdown 大纲
- **PPT 生成**：根据大纲 + 模板生成演示文稿
- **格式转换**：PPT ↔ Markdown ↔ 图片

## 使用方式

### 前置依赖

```bash
npm install pptxgenjs jszip
```

### 示例：生成 PPT

```javascript
import pptxgen from "pptxgenjs";

const pptx = new pptxgen();
const slide = pptx.addSlide();
slide.addText("标题", { x: 1, y: 0.5, w: 8, h: 1, fontSize: 28, bold: true });
slide.addText("正文内容", { x: 1, y: 2, w: 8, h: 3, fontSize: 16 });
await pptx.writeFile({ fileName: "output.pptx" });
```

### 示例：提取 PPT 内容

```javascript
import JSZip from "jszip";
import { readFile } from "node:fs/promises";

const buf = await readFile("input.pptx");
const zip = await JSZip.loadAsync(buf);
// 读取 ppt/slides/slide1.xml ... 提取文本
```

## 与 MagicTwin 集成

样式优化 Agent 可基于分析结果，自动生成汇报 PPT。
