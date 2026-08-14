# 参与贡献

感谢参与健康追踪。文档与用户界面统一使用中文。

1. 先创建 Issue 说明问题或设计目标。
2. 从 `main` 创建短期分支，不提交真实账号、Token、Key 或健康数据。
3. 只做与 Issue 相关的改动，并为算法、迁移或交互补测试。
4. 本地运行 `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build`。
5. 提交 PR，填写测试证据、隐私影响和移动端验证情况。

涉及数据库时必须新增迁移，不可直接修改已经发布的迁移文件；RLS 改动必须证明用户 A 无法访问用户 B 的任何记录。
