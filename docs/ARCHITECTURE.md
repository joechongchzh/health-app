# 架构

应用采用 React + TypeScript + Vite。核心分层：

- `src/domain`：健康数据类型、营养算法和输入/URL 校验，无 UI 依赖。
- `src/data`：Dexie/IndexedDB、条目级仓储、导入导出和旧版适配器。
- `src/services`：Supabase Auth、Edge Function 和同步协议。
- `src/App.tsx`：认证、onboarding、五栏 UI 与生命周期同步触发。
- `supabase`：数据库迁移、RLS 测试和服务端函数。

写入先进入 IndexedDB，并同时更新 outbox。同步时逐条比较版本：云端版本不旧于本地待传版本时采用云端记录并提示冲突，否则上传本地版本；拉取阶段只覆盖版本更高的本地记录。

应用启动、回到前台、恢复联网和手动点击同步时执行同步。此设计不依赖 iOS 后台任务。
