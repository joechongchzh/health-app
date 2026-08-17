# 安全政策

## 支持版本

当前只为最新 `v3.x` 版本提供安全更新。

## 报告漏洞

请不要公开创建包含利用细节、真实健康数据或凭据的 Issue。优先使用 GitHub 仓库的 Private vulnerability reporting；如果该入口尚未启用，请联系仓库维护者并仅提供最小复现信息。

维护者会尽快确认影响范围。数据越权、凭据泄露、账号删除失败和登录绕过按最高优先级处理。

## 凭据纪律

- Supabase Service Role Key 只能存在于 Edge Function 环境。
- 用户 AI Key 只能存在于本机 IndexedDB。
- 任何曾写入 Git 历史或旧同步 JSON 的 Token/Key 都必须立即撤销并轮换。
