# 部署与发布

## GitHub Pages

1. 在 Supabase 完成迁移和两个 Edge Function 部署。
2. 在 GitHub Variables 设置 `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`。
3. Pages Source 选择 GitHub Actions。
4. 保护 `main`：要求 PR、CI 成功、禁止强推。
5. 启用 Secret Scanning、Push Protection、Private vulnerability reporting。
6. 合并 `main` 后，`deploy-pages.yml` 只在 CI 成功时部署。

## v3.0.0 发布闸门

- 自动 CI、RLS、Chromium/WebKit 移动端、生产构建和 PWA 检查通过。
- 轮换所有曾进入旧同步数据的 GitHub Token/AI Key。
- 真实 iPhone Safari/主屏幕和 Android Chrome/安装模式完成登录、记录、离线、恢复同步和删除账号。
- 创建 `v2.7.6` 归档标签，再创建 `v3.0.0` 标签和正式 GitHub Release。

不发布公开 Beta 或 RC。高优先级 Bug 发布 `v3.0.x`；新功能进入 `v3.1.0`。
