# 数据库与隔离

远端表包括 `profiles`、`days`、`meal_entries`、`workouts`、`weight_entries`、`foods`、`combos`、`supplement_definitions`、`supplement_checkins`、`training_plans`。

每条记录包含 `id`、`user_id`、`version`、`created_at`、`updated_at`、`deleted_at` 和 `payload`。数据库约束要求 payload 内的 `id/userId` 与结构列一致。

所有用户表启用 RLS：只有 `auth.uid() = user_id` 且 membership 为 active 的请求可读写。客户端 publishable key 不是访问边界，RLS 才是。`supabase/tests/rls.test.sql` 覆盖跨用户读取、插入、更新、删除和非会员访问。

邀请码用 PostgreSQL `crypt` 哈希保存，支持有效期、最大次数和禁用时间。`registration_mode` 可为 `invite` 或 `open`；默认 `invite`。
