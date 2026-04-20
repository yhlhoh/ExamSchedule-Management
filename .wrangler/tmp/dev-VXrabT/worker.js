var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/worker.ts
var KEY_USERS_INDEX = "users:index";
var KEY_CONFIGS_INDEX = "configs:index";
var DEFAULT_ADMIN_USERNAME = "admin";
var DEFAULT_ADMIN_PASSWORD = "admin123456";
var SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
var worker_default = {
  async fetch(request, env) {
    await ensureDefaultAdmin(env);
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/" || path === "/index.php") {
      const session = await getSessionFromRequest(request, env);
      return pageRoot(session);
    }
    if (path === "/api/get_config.php") {
      return handleGetConfigApi(request, env);
    }
    if (path === "/admin/index.php") {
      const session = await getSessionFromRequest(request, env);
      if (session) return redirect("/admin/dashboard.php");
      return pageLogin();
    }
    if (path === "/admin/login.php" && request.method === "POST") {
      return handleLogin(request, env);
    }
    if (path === "/admin/login.php") {
      return redirect("/admin/index.php");
    }
    if (path === "/admin/logout.php") {
      return handleLogout(request, env);
    }
    if (path === "/admin/dashboard.php") {
      const session = await requireSession(request, env);
      if (session instanceof Response) return session;
      return pageDashboard(session);
    }
    if (path === "/admin/manage_configs.php") {
      const session = await requireSession(request, env);
      if (session instanceof Response) return session;
      const configs = await listConfigs(env);
      return pageManageConfigs(session, configs);
    }
    if (path === "/admin/edit_config.php") {
      const session = await requireSession(request, env);
      if (session instanceof Response) return session;
      if (request.method === "POST") {
        return handleSaveConfig(request, env);
      }
      return handleEditConfigPage(request, env);
    }
    if (path === "/admin/delete_config.php") {
      const session = await requireSession(request, env);
      if (session instanceof Response) return session;
      const id = url.searchParams.get("id")?.trim() || "";
      if (id) await deleteConfig(env, id);
      return redirect("/admin/manage_configs.php");
    }
    if (path === "/admin/manage_users.php") {
      const session = await requireAdminSession(request, env);
      if (session instanceof Response) return session;
      const users = await listUsers(env);
      return pageManageUsers(users);
    }
    if (path === "/admin/edit_user.php") {
      const session = await requireAdminSession(request, env);
      if (session instanceof Response) return session;
      if (request.method === "POST") {
        return handleSaveUser(request, env);
      }
      return handleEditUserPage(request, env);
    }
    if (path === "/admin/delete_user.php") {
      const session = await requireAdminSession(request, env);
      if (session instanceof Response) return session;
      const id = Number(url.searchParams.get("id"));
      if (Number.isFinite(id)) await deleteUserById(env, id);
      return redirect("/admin/manage_users.php");
    }
    if (path === "/present" || path === "/present/") {
      return redirect("/present/index.html");
    }
    return env.ASSETS.fetch(request);
  }
};
async function handleGetConfigApi(request, env) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return json({ error: "\u53C2\u6570\u9519\u8BEF" }, 400);
  }
  const config = await getConfig(env, id);
  if (!config) {
    return json({ error: "\u672A\u627E\u5230\u8BE5\u914D\u7F6E" }, 404);
  }
  return json(config.content, 200);
}
__name(handleGetConfigApi, "handleGetConfigApi");
async function handleLogin(request, env) {
  const form = await request.formData();
  const username = String(form.get("username") || "").trim();
  const password = String(form.get("password") || "");
  const user = await getUser(env, username);
  if (!user || !await verifyPassword(password, user.passwordHash)) {
    return pageLogin("\u7528\u6237\u540D\u6216\u5BC6\u7801\u9519\u8BEF");
  }
  const sessionToken = await createSession(env, { username: user.username, role: user.role, createdAt: nowIso() });
  return redirect("/admin/dashboard.php", {
    "Set-Cookie": cookieSession(sessionToken)
  });
}
__name(handleLogin, "handleLogin");
async function handleLogout(request, env) {
  const token = getCookie(request, "session_token");
  if (token) {
    await env.EXAM_KV.delete(`session:${token}`);
  }
  return redirect("/index.php", {
    "Set-Cookie": "session_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
  });
}
__name(handleLogout, "handleLogout");
async function handleEditConfigPage(request, env) {
  const id = new URL(request.url).searchParams.get("id")?.trim() || "";
  const record = id ? await getConfig(env, id) : null;
  const current = record?.content || {
    examName: "",
    message: "",
    room: "",
    examInfos: [{ name: "", start: "", end: "" }]
  };
  return pageEditConfig({
    id,
    isEdit: Boolean(record),
    examName: current.examName,
    message: current.message,
    room: current.room,
    examInfos: current.examInfos
  });
}
__name(handleEditConfigPage, "handleEditConfigPage");
async function handleSaveConfig(request, env) {
  const form = await request.formData();
  const id = String(form.get("id") || "").trim();
  const examName = String(form.get("examName") || "").trim();
  const message = String(form.get("message") || "").trim();
  const room = String(form.get("room") || "").trim();
  const names = form.getAll("subject_name[]").map((v) => String(v || "").trim());
  const starts = form.getAll("subject_start[]").map((v) => String(v || "").trim());
  const ends = form.getAll("subject_end[]").map((v) => String(v || "").trim());
  const examInfos = [];
  for (let i = 0; i < names.length; i++) {
    if (!names[i] || !starts[i] || !ends[i]) continue;
    const startDate = normalizeDateTimeLocal(starts[i]);
    const endDate = normalizeDateTimeLocal(ends[i]);
    if (!startDate || !endDate) continue;
    examInfos.push({ name: names[i], start: startDate, end: endDate });
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return pageEditConfig({ id, isEdit: false, examName, message, room, examInfos: examInfos.length ? examInfos : [{ name: "", start: "", end: "" }] }, "ID\u683C\u5F0F\u9519\u8BEF");
  }
  if (!examName || examInfos.length === 0) {
    return pageEditConfig({ id, isEdit: false, examName, message, room, examInfos: examInfos.length ? examInfos : [{ name: "", start: "", end: "" }] }, "\u8003\u8BD5\u540D\u79F0\u548C\u79D1\u76EE\u4E0D\u80FD\u4E3A\u7A7A");
  }
  await saveConfig(env, {
    id,
    content: { examName, message, room, examInfos }
  });
  return redirect("/admin/manage_configs.php");
}
__name(handleSaveConfig, "handleSaveConfig");
async function handleEditUserPage(request, env) {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isFinite(id)) {
    return pageEditUser({ isEdit: false, username: "", role: "user", id: 0 });
  }
  const users = await listUsers(env);
  const target = users.find((u) => u.id === id);
  if (!target) return redirect("/admin/manage_users.php");
  return pageEditUser({
    isEdit: true,
    id: target.id,
    username: target.username,
    role: target.role
  });
}
__name(handleEditUserPage, "handleEditUserPage");
async function handleSaveUser(request, env) {
  const form = await request.formData();
  const id = Number(String(form.get("id") || "0"));
  const username = String(form.get("username") || "").trim();
  const role = String(form.get("role") || "user") === "admin" ? "admin" : "user";
  const password = String(form.get("password") || "");
  const isEdit = Number.isFinite(id) && id > 0;
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return pageEditUser({ isEdit, id, username, role }, "\u7528\u6237\u540D\u683C\u5F0F\u9519\u8BEF");
  }
  if (!isEdit && !password) {
    return pageEditUser({ isEdit, id, username, role }, "\u65B0\u5EFA\u7528\u6237\u5FC5\u987B\u8BBE\u7F6E\u5BC6\u7801");
  }
  const users = await listUsers(env);
  if (!isEdit && users.some((u) => u.username === username)) {
    return pageEditUser({ isEdit, id, username, role }, "\u7528\u6237\u540D\u5DF2\u5B58\u5728");
  }
  if (isEdit) {
    const existing = users.find((u) => u.id === id);
    if (!existing) return redirect("/admin/manage_users.php");
    const updated = {
      ...existing,
      role,
      passwordHash: password ? await hashPassword(password) : existing.passwordHash
    };
    await setUser(env, updated);
  } else {
    const newUser = {
      id: await nextUserId(env),
      username,
      role,
      passwordHash: await hashPassword(password),
      createdAt: nowIso()
    };
    await setUser(env, newUser);
    await addToIndex(env, KEY_USERS_INDEX, username);
  }
  return redirect("/admin/manage_users.php");
}
__name(handleSaveUser, "handleSaveUser");
async function requireSession(request, env) {
  const session = await getSessionFromRequest(request, env);
  if (!session) return redirect("/admin/index.php");
  return session;
}
__name(requireSession, "requireSession");
async function requireAdminSession(request, env) {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;
  if (session.role !== "admin") return redirect("/admin/dashboard.php");
  return session;
}
__name(requireAdminSession, "requireAdminSession");
async function getSessionFromRequest(request, env) {
  const token = getCookie(request, "session_token");
  if (!token) return null;
  return await getJson(env, `session:${token}`);
}
__name(getSessionFromRequest, "getSessionFromRequest");
async function createSession(env, session) {
  const token = crypto.randomUUID().replace(/-/g, "");
  await env.EXAM_KV.put(`session:${token}`, JSON.stringify(session), { expirationTtl: SESSION_TTL_SECONDS });
  return token;
}
__name(createSession, "createSession");
function cookieSession(token) {
  return `session_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}
__name(cookieSession, "cookieSession");
async function ensureDefaultAdmin(env) {
  const admin = await getUser(env, DEFAULT_ADMIN_USERNAME);
  if (admin) return;
  const newAdmin = {
    id: await nextUserId(env),
    username: DEFAULT_ADMIN_USERNAME,
    role: "admin",
    passwordHash: await hashPassword(DEFAULT_ADMIN_PASSWORD),
    createdAt: nowIso()
  };
  await setUser(env, newAdmin);
  await addToIndex(env, KEY_USERS_INDEX, DEFAULT_ADMIN_USERNAME);
}
__name(ensureDefaultAdmin, "ensureDefaultAdmin");
async function listUsers(env) {
  const names = await getJson(env, KEY_USERS_INDEX, []);
  const users = [];
  for (const name of names) {
    const user = await getUser(env, name);
    if (user) users.push(user);
  }
  users.sort((a, b) => a.id - b.id);
  return users;
}
__name(listUsers, "listUsers");
async function getUser(env, username) {
  return getJson(env, `user:${username}`);
}
__name(getUser, "getUser");
async function setUser(env, user) {
  await env.EXAM_KV.put(`user:${user.username}`, JSON.stringify(user));
}
__name(setUser, "setUser");
async function deleteUserById(env, id) {
  const users = await listUsers(env);
  const user = users.find((u) => u.id === id);
  if (!user || user.username === DEFAULT_ADMIN_USERNAME) return;
  await env.EXAM_KV.delete(`user:${user.username}`);
  await removeFromIndex(env, KEY_USERS_INDEX, user.username);
}
__name(deleteUserById, "deleteUserById");
async function nextUserId(env) {
  const users = await listUsers(env);
  return users.length ? Math.max(...users.map((u) => u.id)) + 1 : 1;
}
__name(nextUserId, "nextUserId");
async function listConfigs(env) {
  const ids = await getJson(env, KEY_CONFIGS_INDEX, []);
  const configs = [];
  for (const id of ids) {
    const cfg = await getConfig(env, id);
    if (cfg) configs.push(cfg);
  }
  configs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return configs;
}
__name(listConfigs, "listConfigs");
async function getConfig(env, id) {
  return getJson(env, `config:${id}`);
}
__name(getConfig, "getConfig");
async function saveConfig(env, input) {
  const existing = await getConfig(env, input.id);
  const record = {
    id: input.id,
    content: input.content,
    createdAt: existing?.createdAt ?? nowIso()
  };
  await env.EXAM_KV.put(`config:${input.id}`, JSON.stringify(record));
  await addToIndex(env, KEY_CONFIGS_INDEX, input.id);
}
__name(saveConfig, "saveConfig");
async function deleteConfig(env, id) {
  await env.EXAM_KV.delete(`config:${id}`);
  await removeFromIndex(env, KEY_CONFIGS_INDEX, id);
}
__name(deleteConfig, "deleteConfig");
async function addToIndex(env, key, value) {
  const values = await getJson(env, key, []);
  if (!values.includes(value)) {
    values.push(value);
    await env.EXAM_KV.put(key, JSON.stringify(values));
  }
}
__name(addToIndex, "addToIndex");
async function removeFromIndex(env, key, value) {
  const values = await getJson(env, key, []);
  const next = values.filter((v) => v !== value);
  await env.EXAM_KV.put(key, JSON.stringify(next));
}
__name(removeFromIndex, "removeFromIndex");
async function getJson(env, key, fallback = null) {
  const raw = await env.EXAM_KV.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
__name(getJson, "getJson");
async function hashPassword(password) {
  const salt = crypto.randomUUID().replace(/-/g, "");
  const hash = await sha256Hex(`${salt}:${password}`);
  return `${salt}:${hash}`;
}
__name(hashPassword, "hashPassword");
async function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const compare = await sha256Hex(`${salt}:${password}`);
  return compare === hash;
}
__name(verifyPassword, "verifyPassword");
async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex, "sha256Hex");
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
__name(nowIso, "nowIso");
function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const pairs = cookie.split(";").map((v) => v.trim()).filter(Boolean);
  for (const pair of pairs) {
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    const key = pair.slice(0, index);
    if (key !== name) continue;
    return decodeURIComponent(pair.slice(index + 1));
  }
  return null;
}
__name(getCookie, "getCookie");
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}
__name(json, "json");
function redirect(location, headers = {}) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      ...headers
    }
  });
}
__name(redirect, "redirect");
function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8"
    }
  });
}
__name(html, "html");
function layout(title, content) {
  return html(`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/assets/md2-blue.css" />
<link href="https://fonts.googleapis.cn/icon?family=Material+Icons" rel="stylesheet">
<style>
body{font-family:Roboto,Arial,sans-serif;background:#f5f7fa;margin:0}
.navbar{background:#1976d2;color:#fff;padding:16px 24px;display:flex;align-items:center;gap:8px}
.container{max-width:980px;margin:40px auto;background:#fff;border-radius:8px;box-shadow:0 2px 8px #0001;padding:24px}
.md-btn{background:#1976d2;color:#fff;border:none;border-radius:4px;padding:10px 18px;font-size:14px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
.md-btn:hover{background:#1565c0}.danger{background:#e53935}.danger:hover{background:#b71c1c}
input,select{width:100%;padding:10px;border:1px solid #b3c6e0;border-radius:4px;font-size:14px;box-sizing:border-box}
label{display:block;margin:12px 0 8px;color:#1976d2}.msg{color:#d32f2f;margin-bottom:12px}
.card{border:1px solid #e3eaf2;border-radius:8px;padding:16px;margin-bottom:12px}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.table{width:100%;border-collapse:collapse}.table th,.table td{border:1px solid #e3eaf2;padding:8px}
.table th{background:#e3f0fc;text-align:left}
</style>
</head>
<body>${content}</body></html>`);
}
__name(layout, "layout");
function pageRoot(session) {
  const userArea = session ? `<span style="margin-left:auto;margin-right:12px;">\u{1F464} ${escapeHtml(session.username)}</span><a class="md-btn" href="/admin/dashboard.php">\u8FDB\u5165\u540E\u53F0</a>` : `<span style="margin-left:auto"></span><a class="md-btn" style="background:#fff;color:#1976d2;border:1px solid #1976d2" href="/admin/index.php">\u767B\u5F55</a>`;
  return layout("\u8003\u8BD5\u770B\u677F\u914D\u7F6E\u67E5\u8BE2", `
<div class="navbar"><span class="material-icons">dashboard</span>\u8003\u8BD5\u770B\u677F\u914D\u7F6E\u67E5\u8BE2${userArea}</div>
<div class="container" style="max-width:460px">
<form id="query-form">
<label for="configId">\u914D\u7F6EID</label>
<input id="configId" required />
<div id="jsonWrap" style="display:none;margin-top:16px">
<pre style="background:#f6f8fa;padding:12px;border-radius:6px;overflow:auto"><code id="jsonCode"></code></pre>
<button class="md-btn" type="button" id="presentBtn">\u653E\u6620</button>
</div>
<div class="actions"><button class="md-btn" type="submit"><span class="material-icons">search</span>\u67E5\u8BE2\u8003\u8BD5\u5B89\u6392</button></div>
</form>
</div>
<script>
document.getElementById('query-form').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const id = document.getElementById('configId').value.trim();
  if(!id) return;
  const res = await fetch('/api/get_config.php?id='+encodeURIComponent(id));
  const data = await res.json();
  if(!res.ok){ alert('\u83B7\u53D6\u914D\u7F6E\u5931\u8D25: '+(data.error||'\u672A\u77E5\u9519\u8BEF')); return; }
  document.getElementById('jsonCode').textContent = JSON.stringify(data, null, 2);
  document.getElementById('jsonWrap').style.display = 'block';
  document.getElementById('presentBtn').onclick=()=>location.href='/present/index.html?configId='+encodeURIComponent(id);
});
<\/script>`);
}
__name(pageRoot, "pageRoot");
function pageLogin(message = "") {
  return layout("\u7BA1\u7406\u5458\u767B\u5F55", `
<div class="navbar"><span class="material-icons">admin_panel_settings</span>\u7BA1\u7406\u5458\u540E\u53F0<a href="/index.php" class="md-btn" style="margin-left:auto;background:#fff;color:#1976d2;border:1px solid #1976d2">\u4E3B\u9875</a></div>
<div class="container" style="max-width:420px">
${message ? `<div class="msg">${escapeHtml(message)}</div>` : ""}
<form method="post" action="/admin/login.php">
<label>\u7528\u6237\u540D</label><input name="username" required />
<label>\u5BC6\u7801</label><input name="password" type="password" required />
<div class="actions"><button class="md-btn" type="submit">\u767B\u5F55</button></div>
</form>
</div>`);
}
__name(pageLogin, "pageLogin");
function pageDashboard(session) {
  const userAdmin = session.role === "admin";
  return layout("\u540E\u53F0\u7BA1\u7406", `
<div class="navbar"><span class="material-icons">admin_panel_settings</span>\u540E\u53F0\u7BA1\u7406<a href="/index.php" class="md-btn" style="margin-left:12px;background:#fff;color:#1976d2;border:1px solid #1976d2">\u4E3B\u9875</a><span style="margin-left:auto">\u5F53\u524D\u7528\u6237\uFF1A${escapeHtml(session.username)} (${session.role === "admin" ? "\u7BA1\u7406\u5458" : "\u666E\u901A\u7528\u6237"})</span><a href="/admin/logout.php" class="md-btn" style="margin-left:12px">\u9000\u51FA</a></div>
<div class="container">
<div class="actions">
<a class="md-btn" href="/admin/manage_configs.php">\u914D\u7F6E\u7BA1\u7406</a>
${userAdmin ? '<a class="md-btn" href="/admin/manage_users.php">\u7528\u6237\u7BA1\u7406</a>' : ""}
</div>
</div>`);
}
__name(pageDashboard, "pageDashboard");
function pageManageConfigs(session, configs) {
  return layout("\u914D\u7F6E\u7BA1\u7406", `
<div class="navbar"><span class="material-icons">dashboard_customize</span>\u914D\u7F6E\u7BA1\u7406<a href="/index.php" class="md-btn" style="margin-left:12px;background:#fff;color:#1976d2;border:1px solid #1976d2">\u4E3B\u9875</a></div>
<div class="container">
<div class="actions">
<a class="md-btn" href="/admin/dashboard.php">\u8FD4\u56DE</a>
<a class="md-btn" href="/admin/edit_config.php">\u65B0\u5EFA\u914D\u7F6E</a>
</div>
${configs.length === 0 ? "<p>\u6682\u65E0\u914D\u7F6E</p>" : configs.map((cfg) => `
<div class="card">
<div><strong>${escapeHtml(cfg.content.examName || "(\u672A\u547D\u540D)")}</strong></div>
<div>ID: ${escapeHtml(cfg.id)}</div>
<div>\u8003\u573A\u53F7: ${escapeHtml(cfg.content.room || "")}</div>
<div>${escapeHtml(cfg.content.message || "")}</div>
<div class="actions">
<a class="md-btn" href="/admin/edit_config.php?id=${encodeURIComponent(cfg.id)}">\u7F16\u8F91</a>
<a class="md-btn danger" href="/admin/delete_config.php?id=${encodeURIComponent(cfg.id)}" onclick="return confirm('\u786E\u5B9A\u5220\u9664\u8BE5\u914D\u7F6E\uFF1F')">\u5220\u9664</a>
</div>
</div>`).join("")}
</div>`);
}
__name(pageManageConfigs, "pageManageConfigs");
function pageEditConfig(input, msg = "") {
  const infos = input.examInfos.length ? input.examInfos : [{ name: "", start: "", end: "" }];
  return layout(`${input.isEdit ? "\u7F16\u8F91" : "\u65B0\u5EFA"}\u8003\u8BD5\u914D\u7F6E`, `
<div class="navbar"><span class="material-icons">edit</span>${input.isEdit ? "\u7F16\u8F91" : "\u65B0\u5EFA"}\u8003\u8BD5\u914D\u7F6E<a href="/index.php" class="md-btn" style="margin-left:12px;background:#fff;color:#1976d2;border:1px solid #1976d2">\u4E3B\u9875</a></div>
<div class="container">
${msg ? `<div class="msg">${escapeHtml(msg)}</div>` : ""}
<form method="post" id="configForm">
<label>\u914D\u7F6EID</label><input name="id" value="${escapeHtml(input.id)}" ${input.isEdit ? "readonly" : "required"} />
<label>\u8003\u8BD5\u540D\u79F0</label><input name="examName" value="${escapeHtml(input.examName)}" required />
<label>\u63D0\u793A\u8BED</label><input name="message" value="${escapeHtml(input.message)}" />
<label>\u8003\u573A\u53F7</label><input name="room" value="${escapeHtml(input.room)}" />
<label>\u8003\u8BD5\u79D1\u76EE\u5B89\u6392</label>
<table class="table"><thead><tr><th>\u79D1\u76EE\u540D\u79F0</th><th>\u5F00\u59CB\u65F6\u95F4</th><th>\u7ED3\u675F\u65F6\u95F4</th><th>\u64CD\u4F5C</th></tr></thead><tbody id="subjects"></tbody></table>
<div class="actions"><button class="md-btn" type="button" id="addRow">\u6DFB\u52A0\u79D1\u76EE</button></div>
<div class="actions"><button class="md-btn" type="submit">\u4FDD\u5B58</button><a class="md-btn" style="background:#888" href="/admin/manage_configs.php">\u8FD4\u56DE</a></div>
</form>
</div>
<script>
const initialRows = ${JSON.stringify(infos)};
const body = document.getElementById('subjects');
function dt(v){ return (v||'').slice(0,19); }
function addRow(row={name:'',start:'',end:''}){
  const tr=document.createElement('tr');
  tr.innerHTML='<td><input name="subject_name[]" required></td><td><input type="datetime-local" name="subject_start[]" required></td><td><input type="datetime-local" name="subject_end[]" required></td><td><button class="md-btn danger" type="button">\u5220\u9664</button></td>';
  tr.querySelector('input[name="subject_name[]"]').value=row.name||'';
  tr.querySelector('input[name="subject_start[]"]').value=dt(row.start);
  tr.querySelector('input[name="subject_end[]"]').value=dt(row.end);
  tr.querySelector('button').onclick=()=>{ tr.remove(); if(!body.querySelector('tr')) addRow(); };
  body.appendChild(tr);
}
(initialRows.length?initialRows:[{name:'',start:'',end:''}]).forEach(addRow);
document.getElementById('addRow').onclick=()=>addRow();
<\/script>`);
}
__name(pageEditConfig, "pageEditConfig");
function pageManageUsers(users) {
  return layout("\u7528\u6237\u7BA1\u7406", `
<div class="navbar"><span class="material-icons">group</span>\u7528\u6237\u7BA1\u7406<a href="/index.php" class="md-btn" style="margin-left:12px;background:#fff;color:#1976d2;border:1px solid #1976d2">\u4E3B\u9875</a></div>
<div class="container">
<div class="actions"><a class="md-btn" href="/admin/dashboard.php">\u8FD4\u56DE</a><a class="md-btn" href="/admin/edit_user.php">\u65B0\u5EFA\u7528\u6237</a></div>
<table class="table"><thead><tr><th>\u7528\u6237\u540D</th><th>\u89D2\u8272</th><th>\u64CD\u4F5C</th></tr></thead><tbody>
${users.map((u) => `<tr><td>${escapeHtml(u.username)}</td><td>${u.role === "admin" ? "\u7BA1\u7406\u5458" : "\u666E\u901A\u7528\u6237"}</td><td><div class="actions"><a class="md-btn" href="/admin/edit_user.php?id=${u.id}">\u7F16\u8F91</a>${u.username !== DEFAULT_ADMIN_USERNAME ? `<a class="md-btn danger" href="/admin/delete_user.php?id=${u.id}" onclick="return confirm('\u786E\u5B9A\u5220\u9664\u8BE5\u7528\u6237\uFF1F')">\u5220\u9664</a>` : ""}</div></td></tr>`).join("")}
</tbody></table></div>`);
}
__name(pageManageUsers, "pageManageUsers");
function pageEditUser(input, msg = "") {
  return layout(`${input.isEdit ? "\u7F16\u8F91" : "\u65B0\u5EFA"}\u7528\u6237`, `
<div class="navbar"><span class="material-icons">person</span>${input.isEdit ? "\u7F16\u8F91" : "\u65B0\u5EFA"}\u7528\u6237<a href="/index.php" class="md-btn" style="margin-left:12px;background:#fff;color:#1976d2;border:1px solid #1976d2">\u4E3B\u9875</a></div>
<div class="container" style="max-width:460px">
${msg ? `<div class="msg">${escapeHtml(msg)}</div>` : ""}
<form method="post">
<input type="hidden" name="id" value="${input.isEdit ? input.id : ""}">
<label>\u7528\u6237\u540D</label><input name="username" value="${escapeHtml(input.username)}" ${input.isEdit ? "readonly" : "required"}>
<label>${input.isEdit ? "\u65B0\u5BC6\u7801\uFF08\u7559\u7A7A\u4E0D\u4FEE\u6539\uFF09" : "\u5BC6\u7801"}</label><input type="password" name="password" ${input.isEdit ? "" : "required"}>
<label>\u89D2\u8272</label><select name="role"><option value="user" ${input.role === "user" ? "selected" : ""}>\u666E\u901A\u7528\u6237</option><option value="admin" ${input.role === "admin" ? "selected" : ""}>\u7BA1\u7406\u5458</option></select>
<div class="actions"><button class="md-btn" type="submit">\u4FDD\u5B58</button><a class="md-btn" style="background:#888" href="/admin/manage_users.php">\u8FD4\u56DE</a></div>
</form>
</div>`);
}
__name(pageEditUser, "pageEditUser");
function normalizeDateTimeLocal(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}
__name(normalizeDateTimeLocal, "normalizeDateTimeLocal");
function escapeHtml(text) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
__name(escapeHtml, "escapeHtml");

// ../../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-3jdWF3/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-3jdWF3/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
