# Campus Board · 大学任务看板

深蓝紫色的个人任务空间，管理作业、科研、竞赛、活动与组织事务。Windows 和 iPhone 访问同一个 HTTPS 地址，任务同步到同一个数据库。

## 功能

- 侧栏决定任务板块；在“全部任务”中，添加按钮先选择板块。任务表单无需重复选择分类。
- **标题必填**，地点自由填写，待办清单选填。旧版内容完整迁移为标题。
- 待办可在**看板卡片和任务详情**中添加、编辑、删除、勾选、拖动排序；支持鼠标、触摸和手柄上下方向键。
- 卡片操作即时保存；详情内清单修改随“保存任务”提交。文字编辑用勾号或 Enter 确认，用返回按钮或 Escape 取消。
- 作业填 DDL；其他任务填起止时间。统一按北京时间输入和显示。
- 待开始、进行中按截止 / 结束时间排序；已完成按完成时间倒序，只显示最近 7 天。完成满 7 天自动进入侧栏“归档处”，支持分类、查看完整详情和删除。
- 登录后的页面前台每 6 秒同步；输入、拖动或保存期间暂停重绘。并发修改返回冲突并保留本地清单草稿。
- 手动添加附件和链接；图片、PDF 在浏览器打开，Word 等文件下载查看，卡片及详情均可访问。
- 私人看板通过访问密码保护，附件下载也需要登录。公开代码不包含密码、数据库、课程地址或个人任务。

视觉规范见 [design.md](design.md)。原生 HTML / CSS / JavaScript，Cloudflare Pages Functions + D1；本地版使用 Node.js 内置 SQLite。运行应用无需安装 npm 依赖。

## 本地运行

需要 Node.js 24 或更新版本：

```sh
node local.mjs
```

打开 <http://127.0.0.1:8765>。首次启动自动生成密码，保存在 `data/access-code.txt`；数据库保存在 `data/board.sqlite3`。启动时自动升级旧版数据库，不删除原任务。修改端口可设置 `PORT` 环境变量。

本地地址只对这台电脑开放。日常跨网络访问请部署 HTTPS 云端版本；本地数据和云端数据互相独立。停止服务后备份整个 `data/` 目录。没有实现离线新增，断网时不会伪装保存成功。

## Cloudflare Pages 部署

安装 Cloudflare 官方 Wrangler CLI。所有配置都属于你自己的 Cloudflare 账号：

```sh
wrangler login
wrangler d1 create campus-task-board
```

将 `wrangler.example.jsonc` 复制为 `wrangler.jsonc`，填写创建时返回的数据库 ID。真实部署配置已被 Git 忽略。

**新数据库**依次运行下面的初始化与迁移；旧版数据库只执行尚未应用的迁移。执行前先备份，不要重复运行同一个迁移：

```sh
wrangler d1 execute campus-task-board --remote --file schema.sql
wrangler d1 execute campus-task-board --remote --file migrations/0002_task_details.sql
wrangler d1 execute campus-task-board --remote --file migrations/0003_resources.sql
wrangler d1 execute campus-task-board --remote --file migrations/0004_completion.sql
```

先运行一次本地版以生成密码，再生成仅保存在本地的部署密钥文件：

```sh
node prepare-secrets.mjs
node build-pages.mjs
wrangler pages project create campus-task-board --production-branch main
wrangler pages secret bulk data/deployment-secrets.json --project-name campus-task-board
wrangler pages deploy dist/pages --project-name campus-task-board --branch main
```

`BOARD_PASSWORD_HASH` 是访问密码的 SHA-256。可选 `SOURCE_URLS` 是平台 ID 到课程入口的 JSON 字符串，只能覆盖对应平台的 HTTPS 地址；请通过私有配置设置，不提交个人课程信息。登录和导入接口均拒绝未授权访问。

用 Windows 浏览器和 iPhone Safari 打开发布得到的同一 HTTPS 地址，输入相同访问密码。Safari 可用“分享 → 添加到主屏幕”保存入口。云端部署后电脑关机不影响任务看板本身访问。

## 附件与链接

在任务编辑窗口选择文件，上传结束后保存任务。单个文件最多 **10 MB**，每任务最多 20 个文件，当前看板附件空间 **100 MB**。附件与链接会同步到所有已登录设备。

附件使用现有 D1 的二进制分片存储（每片 512 KiB），不要求额外开通付费存储。此设计适合个人的小文档；需要更大空间时应迁移到 R2。文件名保留中文，图片 / PDF 根据文件签名识别，其余类型强制下载，不将 HTML / SVG 当网页执行。支持 HTTP Range，跨分片下载与原文件逐字节校验。删除任务或移除附件后，文件立即不可读取；上传时清理超过 24 小时且未关联任务的文件。

链接名称选填，地址必须以 http/https 开头。不接受脚本地址或包含账号密码的 URL。自动导入保留平台网页：课堂派可跳到具体作业；SmartEstu 目前公开前端使用作业弹窗，没有可验证的单作业深链接，回到该平台作业列表。

## Edge 作业导入扩展

1. Edge 打开 `edge://extensions`，启用开发人员模式，加载项目的 `extension/` 文件夹。
2. 正式看板 → 作业来源与同步 → 连接此看板 → 立即同步；可直接切换每 15 分钟自动检查，无需复制配对码。更新扩展后需在扩展管理页重新加载，再刷新看板。手机只查看云端结果。
3. 其他部署地址也可通过“手动配对”生成配对码。点击扩展图标会打开同风格的独立设置标签页，可自由切换页面复制；未保存的输入在本机自动保留，关闭重开也能恢复。默认读取看板已配置的课程入口，自定义作业页可留空。勾选自动检查后保存并允许访问看板地址。
4. 点击“立即打开作业页”，在专用标签页确认已登录并打开作业列表。每 15 分钟刷新扩展创建的非活动标签页；正在使用的标签页不自动刷新。

配对码只允许导入作业，不能读取整个看板或编辑手动任务。不读取密码、Cookie、答案或成绩；只导入识别到的作业标题、课程、截止时间、作业编号及完成状态。按平台和稳定作业编号去重，保留人工标题、地点和清单。扩展只上传变化的记录，服务器再次比较差异；未变任务不改版本号和完成时间。删除后的导入任务不会重新出现。

### 接入限制

- **SmartEstu、课堂派：原版本已有真实接收记录；新版完成状态仍需账号验收。** SmartEstu 的 completed 对应完成、submitted 对应部分提交；课堂派 mstatus=1/2/4 对应已提交或批改，0/3 对应未提交或被打回。只读取页面已加载列表，不保证遍历全部课程或折叠目录。
- **学习通：新增作业栏目、列表和分页解析，新版仍需真实账号验收。** 保留配置中完整的课程入口和校验参数，不改写为其他中转地址。仅在扩展专用课程页自动打开作业栏目。读取列表中的作业链接、标题和明确提交状态；待批阅算已提交，待互评为进行中，未交或退回为待开始。分页最多 50 页。只显示相对剩余时间时不估算精确 DDL，也不会清空已有截止时间。
- 没有识别到作业响应会显示错误，不等同于“没有作业”；登录过期需要重新登录。
- Edge 关闭或电脑休眠时暂停采集，尚未实现电脑关机后的云端抓取。

## 完成与归档规则

进入已完成状态时，由服务器记录 `completed_at`；仍为已完成时编辑或重复同步不改变它。作业卡片显示完成时间，原 `due_at` 保留在编辑和归档中。取消完成会清除完成时间，再次完成重新计时。旧记录没有历史完成时间，迁移使用该记录原 `updated_at` 回填，不推测更早的提交时间。

平台状态单独保存为 `source_status`：只有平台状态发生变化才覆盖任务进度；用户手动调整之后，同一个平台快照不会反复把它改回。未识别的状态不传入，不能当作未完成。归档是按完成时间自动筛选，不依赖浏览器后台定时器，也不删除记录或附件。

## 验证

```sh
node --test test.mjs resources-test.mjs completion-test.mjs
node smoke.mjs http://127.0.0.1:8765
```

业务检查覆盖旧数据迁移、标题校验、待办更新 / 排序 / 删除 / 持久化、两个独立会话、版本冲突、导入去重与人工编辑保留。HTTP 检查使用本机密码文件，不输出密码，并清理自己创建的临时任务。也可将目标改为自己的线上看板。

可选浏览器检查（开发依赖，运行应用不需要）：

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node ui-test.mjs
node extension-ui-test.mjs
```

检查创建临时数据库和隔离浏览器，覆盖卡片 / 详情操作、鼠标 / 触摸 / 键盘排序、两个浏览器会话、冲突时保留草稿、附件上传与图片查看、跨会话文件读取、链接，以及 320–768px 布局和星星图标居中；示例截图写入被忽略的 `data/screenshots/`。真实 iPhone Safari 仍需实机验收。

## 文件

- `static/`：界面与样式；`design.md`：统一设计规范。
- `worker.mjs`：认证、任务接口、同步与导入。
- `schema.sql` + `migrations/`：数据库初始化与升级。
- `local.mjs`：本地 HTTP 服务、SQLite 兼容层与迁移。
- `extension/`：可选的 Edge 作业导入器。
- `data/`、`.dev.vars`、真实 Wrangler 配置和构建产物只留在本地。
