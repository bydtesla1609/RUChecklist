# Campus Board · 大学任务看板

深蓝紫色的个人任务空间，管理作业、科研、竞赛、活动与组织事务。Windows 和 iPhone 访问同一个 HTTPS 地址，任务同步到同一个数据库。

## 功能

- 侧栏决定任务板块；在“全部任务”中，添加按钮先选择板块。任务表单无需重复选择分类。
- **标题必填**，地点自由填写，待办清单选填。旧版内容完整迁移为标题。
- 待办可在**看板卡片和任务详情**中添加、编辑、删除、勾选、拖动排序；支持鼠标、触摸和手柄上下方向键。
- 卡片操作即时保存；详情内清单修改随“保存任务”提交。文字编辑用勾号或 Enter 确认，用返回按钮或 Escape 取消。
- 作业填 DDL；其他任务填起止时间。统一按北京时间输入和显示。
- 待开始、进行中、已完成三列，按截止 / 结束时间排序，提供真实任务概况。
- 登录后的页面前台每 6 秒同步；输入、拖动或保存期间暂停重绘。并发修改返回冲突并保留本地清单草稿。
- 私人看板通过访问密码保护，公开代码不包含密码、数据库、课程地址或个人任务。

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

**新数据库**依次运行以下两条；旧版数据库只运行第二条一次。执行前请先备份，迁移不会删除任务。不要对已升级的数据库重复执行 `0002`：

```sh
wrangler d1 execute campus-task-board --remote --file schema.sql
wrangler d1 execute campus-task-board --remote --file migrations/0002_task_details.sql
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

## Edge 作业导入扩展

1. Edge 打开 `edge://extensions`，启用开发人员模式，加载项目的 `extension/` 文件夹。
2. 看板 → 作业来源与同步 → 生成扩展配对码。
3. 扩展设置填写看板地址和配对码；可选填自己的课程作业页，勾选自动检查后保存并允许访问看板地址。
4. 点击“立即打开作业页”，在专用标签页确认已登录并打开作业列表。每 15 分钟刷新扩展创建的非活动标签页；正在使用的标签页不自动刷新。

配对码只允许导入作业，不能读取整个看板或编辑手动任务。不读取密码、Cookie、答案或成绩；只导入识别到的作业标题、课程、截止时间和作业编号。导入去重，保留人工标题、地点、清单和进度；删除后的导入任务不会重新出现。

### 接入限制

- **SmartEstu、课堂派：解析器已实现，尚未经真实登录账号验收。** 只读取页面已加载列表，不保证遍历全部课程或分页。
- **学习通：适配器待验证，尚未完成导入。** 当前明确报告该状态，不生成猜测任务。
- 没有识别到作业响应会显示错误，不等同于“没有作业”；登录过期需要重新登录。
- Edge 关闭或电脑休眠时暂停采集，尚未实现电脑关机后的云端抓取。

## 验证

```sh
node --test test.mjs
node smoke.mjs http://127.0.0.1:8765
```

业务检查覆盖旧数据迁移、标题校验、待办更新 / 排序 / 删除 / 持久化、两个独立会话、版本冲突、导入去重与人工编辑保留。HTTP 检查使用本机密码文件，不输出密码，并清理自己创建的临时任务。也可将目标改为自己的线上看板。

可选浏览器检查（开发依赖，运行应用不需要）：

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node ui-test.mjs
```

检查创建临时数据库和隔离浏览器，覆盖卡片 / 详情操作、鼠标 / 触摸 / 键盘排序、两个浏览器会话、冲突时保留草稿和窄屏布局；示例截图写入被忽略的 `data/screenshots/`。真实 iPhone Safari 仍需实机验收。

## 文件

- `static/`：界面与样式；`design.md`：统一设计规范。
- `worker.mjs`：认证、任务接口、同步与导入。
- `schema.sql` + `migrations/`：数据库初始化与升级。
- `local.mjs`：本地 HTTP 服务、SQLite 兼容层与迁移。
- `extension/`：可选的 Edge 作业导入器。
- `data/`、`.dev.vars`、真实 Wrangler 配置和构建产物只留在本地。
