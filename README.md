# 健康追踪 · v2.8.3

自用健康记录工具。HTML、CSS、JavaScript 全部放在 `index.html`，直接打开即可运行。`sw.js` 只提供静态页面离线缓存；没有前后端分离、React 构建或 Supabase 运行依赖。

线上地址：[健康 App](https://joechongchzh.github.io/health-app/)。

## 首次同步保留云端当天记录（v2.8.3）

打开、回到前台、恢复网络时自动同步；页面在前台且没有编辑表单时每30秒检查一次，数据未变不重复上传。两端基于上次同步副本合并不同餐次、训练和补剂打卡，同一项目同时修改按时间取新并提示冲突、保留旧日快照。体重按每条记录的更新时间合并。设置页同步状态保留详细错误，不只显示短暂提示。

新安装预填自用GitHub用户名、仓库和文件名，只需填写一次Token与模型配置。凭据保持本机保存；Safari和主屏幕Web App属于不同存储环境，新安装各配置一次，数据通过同一GitHub文件互通。

仅打开今日或浏览某个日期时生成的空白日不再视为一次编辑。原来它带有当前时间，同步按整天时间戳取新时会覆盖另一设备已录入的数据。现在只有实际修改才更新时间；主动清空餐次仍然可以同步。修复后的程序不会自动恢复此前已被覆盖的数据，旧版本副本仍保留在dayHistory。

## 配置保留（v2.8.2）

AI 三组模型的接口、密钥、模型名和 GitHub 同步配置单独保存于固定的本机存储，并保留一份本机配置备份。升级保留当前配置；健康 JSON 中配置缺失时恢复，首次迁移只从旧本机备份补回完全缺失的配置组，不覆盖新填写的模型。主动保存的修改和清空仍然生效。

后台同步只使用已保存配置，旧标签页保存健康记录不会回写过期配置。普通导出和同步继续排除密钥、令牌及聊天。此保护限于同一浏览器来源；清除网站数据、换浏览器或换设备无法依靠本机备份自动恢复。

## 品牌名称复用（v2.8.1）

AI先做语义匹配：存在同品牌、同规格条目时优先复用；否则品牌/店名仅作来源描述时复用已有通用食物。库内有“蛋挞”时，“肯德基蛋挞”可按库内“蛋挞”记录；真正缺项的新普通食物默认使用通用名。全脂/脱脂、含糖/无糖、加奶/不加奶等差异仍需区分。只修改提示词，不重命名或合并已存条目。

## 本次修复

- 保留已有食物、自定义训练方案和历史记录；移除每次启动重建食物库的旧迁移逻辑。
- 食物和套餐删除后进入回收站；修正前、同步冲突前的完整条目也保留。恢复生成新版本，旧删除标记不会反复删除恢复后的条目。
- 同名食物按版本时间合并；历史餐次及套餐保留当时的营养快照，不被食物库修改悄悄追改。
- AI 使用完整的库内份量和营养基准，按实际克重计算；新增、更新、删除均经过校验与确认。确认前数据变化会重新计算并要求核对。
- GitHub 同步和普通导出不含模型密钥、GitHub 令牌或 AI 聊天；设备上的配置仍保留。

## 数据保存

浏览器 `localStorage` 的 `ht_data_v1` 是本地数据。数据结构版本为 `ver:6`，与应用版本号不同。旧数据首次升级前，将原 JSON 原样保存在同一浏览器的 `ht_backup_before_v6`；如果保存备份失败，停止升级。请勿通过清除浏览器数据处理版本切换。

GitHub JSON 同步可选，配置数据仓库和令牌后使用。导入与同步合并数据；不从导入文件覆盖本机凭据。新设备需自行填写模型密钥和同步令牌。

删除记录和覆盖前版本可在食物选择面板的“回收站”恢复。日记录发生同步冲突时，落选日快照保存在导出数据的 `dayHistory`，不自动重放到当天。旧食物库的有时间删除标记仅用于兼容合并；不再强制补回所谓白名单食物。

此前的复杂架构 v3 停止开发。本仓库 Git 历史保留切换前的全部提交；本次发布不删除或迁移原 Supabase / IndexedDB 数据。它们与本工具的 JSON 数据属于不同存储，不能宣称自动互通。

## 验证与发布

运行界面没有第三方依赖。`tests/` 和 `.github/` 仅供开发验证：

```sh
node tests/static-check.cjs
npm install --prefix .ci-deps --no-save --package-lock=false playwright@1.62.1
node .ci-deps/node_modules/playwright/cli.js install chromium
HEALTH_TEST_NODE_MODULES="$PWD/.ci-deps/node_modules" node tests/legacy-regression.cjs
HEALTH_TEST_NODE_MODULES="$PWD/.ci-deps/node_modules" node tests/preservation.cjs
HEALTH_TEST_NODE_MODULES="$PWD/.ci-deps/node_modules" node tests/config-preservation.cjs
HEALTH_TEST_NODE_MODULES="$PWD/.ci-deps/node_modules" node tests/sync-day-preservation.cjs
HEALTH_TEST_NODE_MODULES="$PWD/.ci-deps/node_modules" node tests/two-device-sync.cjs
```

Windows 可将 `HEALTH_TEST_NODE_MODULES` 指向已有 Playwright 运行时；测试使用本机 Edge。CI 使用 Chromium。全部测试在独立浏览器上下文中执行，外部健康数据写入被阻止。

主分支保留 `quality`、`database`、`e2e`、`secret-scan`、`analyze` 五项必需检查；其中 `database` 验证本地数据升级、合并、回收站与缓存切换。通过 PR 检查后合并，主分支 CI 成功才发布。Pages 产物只包含 `index.html`、`sw.js`、`.nojekyll`，不包含测试、个人健康文档或任何备份。

版本更新需同时调整 HTML 版本标记与 service worker 缓存版本。真实模型的响应受外部服务影响；合成测试不替代手机 Safari / 主屏幕安装场景的实机验收。
