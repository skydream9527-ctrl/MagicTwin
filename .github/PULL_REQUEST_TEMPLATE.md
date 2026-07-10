<!-- 感谢你的 PR！请先在 Issue 里讨论设计，达成共识后再开工。 -->

## 改了什么

简要描述本 PR 的内容。

## 为什么改

关联 Issue：#NNN
动机、要解决的问题、为什么现有方案不够。

## 如何自测

- [ ] `npm start` 后跑通一个完整的 Twin ⇄ Data ⇄ Style 协作到交付
- [ ] 未配置数据源时验证演示模式返回示例数据且不崩
- [ ] 未配置 LLM key 时验证降级行为符合预期

测试场景与命令：
```bash
# 你跑过的自测命令 / 场景
```

## 设计要点（若涉及编排 / 安全 / 适配器）

- 编排状态机：是否新增 turn / action？是否有界？
- 安全边界：是否引入新的写操作 / 跨空间读取？如何走 HITL？
- 外部依赖：缺失时如何降级？

## 兼容性

- [ ] 向后兼容（已有任务空间可继续加载）
- [ ] 不兼容，已在 CHANGELOG 或 README 标注迁移指南

## 检查清单

- [ ] 已读 [CONTRIBUTING.md](../CONTRIBUTING.md) 与 [Code of Conduct](../CODE_OF_CONDUCT.md)
- [ ] 提交信息遵循 Conventional Commits
- [ ] **未提交真实 API key / 个人画像 / 内部业务数据**
- [ ] 新增的环境变量已同步到 `.env.example` 与 README
- [ ] 文档已更新（README / 注释 / 架构图）

## 截图 / 日志（可选）

附上前后对比截图或关键日志。
