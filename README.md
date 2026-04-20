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
src/worker.ts      # Workers 入口、路由、KV 数据访问层、页面渲染
public/assets      # 原站静态资源（CSS 等）
public/present     # 放映端静态页面与脚本
wrangler.toml      # Workers + KV + static assets 配置
```

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
