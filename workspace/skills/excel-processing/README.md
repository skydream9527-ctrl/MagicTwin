# Excel 处理 Skill

通用的 Excel / CSV 文件处理能力。

## 功能

- **读取解析**：解析 `.xlsx` / `.xls` / `.csv` 文件，提取表头与数据行
- **数据清洗**：去重、空值处理、类型转换、格式标准化
- **聚合统计**：分组求和 / 均值 / 计数 / 透视表
- **格式转换**：Excel ↔ CSV ↔ JSON 互转
- **报表生成**：按模板填充数据生成格式化 Excel 报表

## 使用方式

### 前置依赖

```bash
npm install xlsx
```

### 示例

```javascript
import * as XLSX from "xlsx";

// 读取 Excel
const wb = XLSX.readFile("input.xlsx");
const sheet = wb.Sheets[wb.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(sheet);

// 写入 Excel
const ws = XLSX.utils.json_to_sheet(data);
const newWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(newWb, ws, "Sheet1");
XLSX.writeFile(newWb, "output.xlsx");
```

## 与 MagicTwin 集成

将 Excel 文件放入任务空间 `workspace/tasks/{tid}/uploads/`，数据分析 Agent 可读取并做分析。
