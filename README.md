# ExamSchedule-Management (Cloudflare Workers 版)

本仓库已改造为 **全站运行在 Cloudflare Workers**：
- 动态页面/路由：Workers (`src/worker.ts`)
- 数据存储：**仅 Cloudflare KV**（不使用 D1 / R2 / 外部数据库）
- 静态资源：Workers Static Assets（`public/`）

## 功能概览

- 主页查询配置：`/` 或 `/index.php`
- 放映端：`/present/index.html?configId=...`
- API：`/api/get_config.php?id=...`
- 后台：
  - 登录：`/admin/index.php`
  - 配置管理：`/admin/manage_configs.php`、`/admin/edit_config.php`
  - 用户管理（管理员）：`/admin/manage_users.php`、`/admin/edit_user.php`

> 路由尽量兼容原 PHP URL，便于平滑迁移。

## 默认管理员账号与密码

在 `src/worker.ts` 顶部常量中固定配置（按你的要求采用固定写死方案）：

- `DEFAULT_ADMIN_USERNAME = 'admin'`
- `DEFAULT_ADMIN_PASSWORD = 'admin123456'`

首次访问时会自动初始化到 KV（若不存在）。

⚠️ **安全提示**：该默认管理员密码是按需求固定写在代码里的，仅适合内网/演示。上线前请务必修改 `src/worker.ts` 中的 `DEFAULT_ADMIN_PASSWORD`。

## 1) 创建 KV Namespace

```bash
npx wrangler kv namespace create EXAM_KV
npx wrangler kv namespace create EXAM_KV --preview
```

将返回的 `id` / `preview_id` 填入 `wrangler.toml`：

```toml
[[kv_namespaces]]
binding = "EXAM_KV"
id = "你的生产ID"
preview_id = "你的预览ID"
```

## 2) 本地开发

```bash
npx wrangler dev
```

默认会启动本地 Workers，并使用 `public/` 目录作为静态资源。

## 3) 部署

```bash
npx wrangler deploy
```

## 目录说明

```text
src/worker.ts                   # Workers 入口、路由、KV 数据访问层、页面渲染
public/assets                   # 原站静态资源（CSS 等）
public/present                  # 放映端静态页面与脚本
public/present/Styles/          # 主题 CSS 目录（同步于 present/Styles/）
wrangler.toml                   # Workers + KV + static assets 配置
```

## 主题（Themes）

放映端（`/present/index.html`）支持多套主题，可在页面右上角"设置"弹窗中切换。

主题配置文件：`public/present/Styles/profile.json`（开发时同步至 `present/Styles/profile.json`）

| 主题名称              | 目录            | 亮/暗色 CSS              | 说明                      |
|-----------------------|-----------------|--------------------------|---------------------------|
| ExamAware 旧版        | `ealg/`         | light.css / dark.css     | 早期 ExamAware 风格       |
| ExamSchedule 旧版     | `old/`          | light.css / dark.css     | 早期 ExamSchedule 风格    |
| Material Design 3     | `md3/`          | light.css / dark.css     | Google MD3 规范           |
| Material Design 2     | `md2/`          | light.css / dark.css     | Google MD2 规范（新增）   |
| Fluent Design 3       | `fluent3/`      | light.css / dark.css     | Microsoft Fluent 风格（新增）|
| Liquid Glass          | `liquidglass/`  | light.css / dark.css     | 玻璃拟态 / 液态玻璃风格（新增）|

### 新增主题使用说明

1. 打开放映端页面（`/present/index.html?configId=...`）。
2. 点击右上角 **设置** 按钮。
3. 在"主题"下拉框中选择所需主题（如 *Fluent Design 3*、*Liquid Glass* 或 *Material Design 2*）。
4. 通过"亮/暗色模式"开关切换亮色/暗色版本。
5. 点击 **确定** 保存，偏好将存入 Cookie 供下次访问时自动恢复。

### 添加自定义主题

1. 在 `public/present/Styles/` 下新建目录（目录名只允许字母、数字、`_`、`-`）。
2. 在该目录中提供 `light.css` 和 `dark.css`。
3. 在 `public/present/Styles/profile.json` 的 `theme` 数组中追加一条记录：
   ```json
   { "name": "我的主题", "path": "my-theme" }
   ```
4. 同步修改 `present/Styles/profile.json`（本地开发用）。
5. 重新部署（`npx wrangler deploy`）即可在放映端看到新主题选项。

## KV Key 设计（小数据量场景）

- 用户：
  - `users:index`（用户名数组）
  - `user:{username}`（用户详情 JSON）
- 配置：
  - `configs:index`（配置 ID 数组）
  - `config:{id}`（配置 JSON）
- 会话：
  - `session:{token}`（登录会话 JSON，TTL 7 天）

数据规模很小（<=10条）时，该结构足够简单直接。
