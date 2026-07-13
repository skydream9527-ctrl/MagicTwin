---
name: knowledge_qa
description: 知识库搜索与问答
triggers:
  - "知识库"
  - "搜索文档"
  - "查资料"
  - "文档"
  - "wiki"
  - "找一下"
allowed_tools:
  - search_knowledge
  - read_document
constraints:
  - 回答需标注信息来源
  - 检索无结果时明确告知
  - 不编造知识库中不存在的内容
priority: 7
---
