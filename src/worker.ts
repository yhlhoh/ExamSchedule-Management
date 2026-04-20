interface Env {
  EXAM_KV: KVNamespace;
  ASSETS: Fetcher;
}

type Role = 'admin' | 'user';

interface UserRecord {
  id: number;
  username: string;
  passwordHash: string;
  role: Role;
  createdAt: string;
}

interface SessionRecord {
  username: string;
  role: Role;
  createdAt: string;
}

interface ConfigRecord {
  id: string;
  content: {
    examName: string;
    message: string;
    room: string;
    examInfos: Array<{ name: string; start: string; end: string }>;
  };
  createdAt: string;
}

const KEY_USERS_INDEX = 'users:index';
const KEY_CONFIGS_INDEX = 'configs:index';
const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD = 'admin123456';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    await ensureDefaultAdmin(env);

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/' || path === '/index.php') {
      const session = await getSessionFromRequest(request, env);
      return pageRoot(session);
    }

    if (path === '/api/get_config.php') {
      return handleGetConfigApi(request, env);
    }

    if (path === '/admin/index.php') {
      const session = await getSessionFromRequest(request, env);
      if (session) return redirect('/admin/dashboard.php');
      return pageLogin();
    }

    if (path === '/admin/login.php' && request.method === 'POST') {
      return handleLogin(request, env);
    }
    if (path === '/admin/login.php') {
      return redirect('/admin/index.php');
    }

    if (path === '/admin/logout.php') {
      return handleLogout(request, env);
    }

    if (path === '/admin/dashboard.php') {
      const session = await requireSession(request, env);
      if (session instanceof Response) return session;
      return pageDashboard(session);
    }

    if (path === '/admin/manage_configs.php') {
      const session = await requireSession(request, env);
      if (session instanceof Response) return session;
      const configs = await listConfigs(env);
      return pageManageConfigs(session, configs);
    }

    if (path === '/admin/edit_config.php') {
      const session = await requireSession(request, env);
      if (session instanceof Response) return session;
      if (request.method === 'POST') {
        return handleSaveConfig(request, env);
      }
      return handleEditConfigPage(request, env);
    }

    if (path === '/admin/delete_config.php') {
      const session = await requireSession(request, env);
      if (session instanceof Response) return session;
      const id = url.searchParams.get('id')?.trim() || '';
      if (id) await deleteConfig(env, id);
      return redirect('/admin/manage_configs.php');
    }

    if (path === '/admin/manage_users.php') {
      const session = await requireAdminSession(request, env);
      if (session instanceof Response) return session;
      const users = await listUsers(env);
      return pageManageUsers(users);
    }

    if (path === '/admin/edit_user.php') {
      const session = await requireAdminSession(request, env);
      if (session instanceof Response) return session;
      if (request.method === 'POST') {
        return handleSaveUser(request, env);
      }
      return handleEditUserPage(request, env);
    }

    if (path === '/admin/delete_user.php') {
      const session = await requireAdminSession(request, env);
      if (session instanceof Response) return session;
      const id = Number(url.searchParams.get('id'));
      if (Number.isFinite(id)) await deleteUserById(env, id);
      return redirect('/admin/manage_users.php');
    }

    if (path === '/present' || path === '/present/') {
      return redirect('/present/index.html');
    }

    return env.ASSETS.fetch(request);
  }
};

async function handleGetConfigApi(request: Request, env: Env): Promise<Response> {
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return json({ error: '参数错误' }, 400);
  }

  const config = await getConfig(env, id);
  if (!config) {
    return json({ error: '未找到该配置' }, 404);
  }

  return json(config.content, 200);
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const username = String(form.get('username') || '').trim();
  const password = String(form.get('password') || '');
  const user = await getUser(env, username);

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return pageLogin('用户名或密码错误');
  }

  const sessionToken = await createSession(env, { username: user.username, role: user.role, createdAt: nowIso() });
  return redirect('/admin/dashboard.php', {
    'Set-Cookie': cookieSession(sessionToken)
  });
}

async function handleLogout(request: Request, env: Env): Promise<Response> {
  const token = getCookie(request, 'session_token');
  if (token) {
    await env.EXAM_KV.delete(`session:${token}`);
  }
  return redirect('/index.php', {
    'Set-Cookie': 'session_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
  });
}

async function handleEditConfigPage(request: Request, env: Env): Promise<Response> {
  const id = new URL(request.url).searchParams.get('id')?.trim() || '';
  const record = id ? await getConfig(env, id) : null;

  const current = record?.content || {
    examName: '',
    message: '',
    room: '',
    examInfos: [{ name: '', start: '', end: '' }]
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

async function handleSaveConfig(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const id = String(form.get('id') || '').trim();
  const examName = String(form.get('examName') || '').trim();
  const message = String(form.get('message') || '').trim();
  const room = String(form.get('room') || '').trim();

  const names = form.getAll('subject_name[]').map(v => String(v || '').trim());
  const starts = form.getAll('subject_start[]').map(v => String(v || '').trim());
  const ends = form.getAll('subject_end[]').map(v => String(v || '').trim());

  const examInfos: Array<{ name: string; start: string; end: string }> = [];
  for (let i = 0; i < names.length; i++) {
    if (!names[i] || !starts[i] || !ends[i]) continue;
    const startDate = normalizeDateTimeLocal(starts[i]);
    const endDate = normalizeDateTimeLocal(ends[i]);
    if (!startDate || !endDate) continue;
    examInfos.push({ name: names[i], start: startDate, end: endDate });
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return pageEditConfig({ id, isEdit: false, examName, message, room, examInfos: examInfos.length ? examInfos : [{ name: '', start: '', end: '' }] }, 'ID格式错误');
  }

  if (!examName || examInfos.length === 0) {
    return pageEditConfig({ id, isEdit: false, examName, message, room, examInfos: examInfos.length ? examInfos : [{ name: '', start: '', end: '' }] }, '考试名称和科目不能为空');
  }

  await saveConfig(env, {
    id,
    content: { examName, message, room, examInfos }
  });

  return redirect('/admin/manage_configs.php');
}

async function handleEditUserPage(request: Request, env: Env): Promise<Response> {
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isFinite(id)) {
    return pageEditUser({ isEdit: false, username: '', role: 'user', id: 0 });
  }

  const users = await listUsers(env);
  const target = users.find(u => u.id === id);
  if (!target) return redirect('/admin/manage_users.php');

  return pageEditUser({
    isEdit: true,
    id: target.id,
    username: target.username,
    role: target.role
  });
}

async function handleSaveUser(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const id = Number(String(form.get('id') || '0'));
  const username = String(form.get('username') || '').trim();
  const role = (String(form.get('role') || 'user') === 'admin' ? 'admin' : 'user') as Role;
  const password = String(form.get('password') || '');
  const isEdit = Number.isFinite(id) && id > 0;

  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return pageEditUser({ isEdit, id, username, role }, '用户名格式错误');
  }

  if (!isEdit && !password) {
    return pageEditUser({ isEdit, id, username, role }, '新建用户必须设置密码');
  }

  const users = await listUsers(env);
  if (!isEdit && users.some(u => u.username === username)) {
    return pageEditUser({ isEdit, id, username, role }, '用户名已存在');
  }

  if (isEdit) {
    const existing = users.find(u => u.id === id);
    if (!existing) return redirect('/admin/manage_users.php');

    const updated: UserRecord = {
      ...existing,
      role,
      passwordHash: password ? await hashPassword(password) : existing.passwordHash
    };

    await setUser(env, updated);
  } else {
    const newUser: UserRecord = {
      id: await nextUserId(env),
      username,
      role,
      passwordHash: await hashPassword(password),
      createdAt: nowIso()
    };
    await setUser(env, newUser);
    await addToIndex(env, KEY_USERS_INDEX, username);
  }

  return redirect('/admin/manage_users.php');
}

async function requireSession(request: Request, env: Env): Promise<SessionRecord | Response> {
  const session = await getSessionFromRequest(request, env);
  if (!session) return redirect('/admin/index.php');
  return session;
}

async function requireAdminSession(request: Request, env: Env): Promise<SessionRecord | Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;
  if (session.role !== 'admin') return redirect('/admin/dashboard.php');
  return session;
}

async function getSessionFromRequest(request: Request, env: Env): Promise<SessionRecord | null> {
  const token = getCookie(request, 'session_token');
  if (!token) return null;
  return await getJson<SessionRecord>(env, `session:${token}`);
}

async function createSession(env: Env, session: SessionRecord): Promise<string> {
  const token = crypto.randomUUID().replace(/-/g, '');
  await env.EXAM_KV.put(`session:${token}`, JSON.stringify(session), { expirationTtl: SESSION_TTL_SECONDS });
  return token;
}

function cookieSession(token: string): string {
  return `session_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

async function ensureDefaultAdmin(env: Env): Promise<void> {
  const admin = await getUser(env, DEFAULT_ADMIN_USERNAME);
  if (admin) return;

  const newAdmin: UserRecord = {
    id: await nextUserId(env),
    username: DEFAULT_ADMIN_USERNAME,
    role: 'admin',
    passwordHash: await hashPassword(DEFAULT_ADMIN_PASSWORD),
    createdAt: nowIso()
  };

  await setUser(env, newAdmin);
  await addToIndex(env, KEY_USERS_INDEX, DEFAULT_ADMIN_USERNAME);
}

async function listUsers(env: Env): Promise<UserRecord[]> {
  const names = await getJson<string[]>(env, KEY_USERS_INDEX, []);
  const users: UserRecord[] = [];
  for (const name of names) {
    const user = await getUser(env, name);
    if (user) users.push(user);
  }
  users.sort((a, b) => a.id - b.id);
  return users;
}

async function getUser(env: Env, username: string): Promise<UserRecord | null> {
  return getJson<UserRecord>(env, `user:${username}`);
}

async function setUser(env: Env, user: UserRecord): Promise<void> {
  await env.EXAM_KV.put(`user:${user.username}`, JSON.stringify(user));
}

async function deleteUserById(env: Env, id: number): Promise<void> {
  const users = await listUsers(env);
  const user = users.find(u => u.id === id);
  if (!user || user.username === DEFAULT_ADMIN_USERNAME) return;
  await env.EXAM_KV.delete(`user:${user.username}`);
  await removeFromIndex(env, KEY_USERS_INDEX, user.username);
}

async function nextUserId(env: Env): Promise<number> {
  const users = await listUsers(env);
  return users.length ? Math.max(...users.map(u => u.id)) + 1 : 1;
}

async function listConfigs(env: Env): Promise<ConfigRecord[]> {
  const ids = await getJson<string[]>(env, KEY_CONFIGS_INDEX, []);
  const configs: ConfigRecord[] = [];
  for (const id of ids) {
    const cfg = await getConfig(env, id);
    if (cfg) configs.push(cfg);
  }
  configs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return configs;
}

async function getConfig(env: Env, id: string): Promise<ConfigRecord | null> {
  return getJson<ConfigRecord>(env, `config:${id}`);
}

async function saveConfig(env: Env, input: { id: string; content: ConfigRecord['content'] }): Promise<void> {
  const existing = await getConfig(env, input.id);
  const record: ConfigRecord = {
    id: input.id,
    content: input.content,
    createdAt: existing?.createdAt ?? nowIso()
  };
  await env.EXAM_KV.put(`config:${input.id}`, JSON.stringify(record));
  await addToIndex(env, KEY_CONFIGS_INDEX, input.id);
}

async function deleteConfig(env: Env, id: string): Promise<void> {
  await env.EXAM_KV.delete(`config:${id}`);
  await removeFromIndex(env, KEY_CONFIGS_INDEX, id);
}

async function addToIndex(env: Env, key: string, value: string): Promise<void> {
  const values = await getJson<string[]>(env, key, []);
  if (!values.includes(value)) {
    values.push(value);
    await env.EXAM_KV.put(key, JSON.stringify(values));
  }
}

async function removeFromIndex(env: Env, key: string, value: string): Promise<void> {
  const values = await getJson<string[]>(env, key, []);
  const next = values.filter(v => v !== value);
  await env.EXAM_KV.put(key, JSON.stringify(next));
}

async function getJson<T>(env: Env, key: string, fallback: T | null = null): Promise<T | null> {
  const raw = await env.EXAM_KV.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomUUID().replace(/-/g, '');
  const hash = await sha256Hex(`${salt}:${password}`);
  return `${salt}:${hash}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const compare = await sha256Hex(`${salt}:${password}`);
  return compare === hash;
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

function nowIso(): string {
  return new Date().toISOString();
}

function getCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get('Cookie') || '';
  const pairs = cookie.split(';').map(v => v.trim()).filter(Boolean);
  for (const pair of pairs) {
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    const key = pair.slice(0, index);
    if (key !== name) continue;
    return decodeURIComponent(pair.slice(index + 1));
  }
  return null;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}

function redirect(location: string, headers: HeadersInit = {}): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      ...headers
    }
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8'
    }
  });
}

function layout(title: string, content: string): Response {
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

function pageRoot(session: SessionRecord | null): Response {
  const userArea = session
    ? `<span style="margin-left:auto;margin-right:12px;">👤 ${escapeHtml(session.username)}</span><a class="md-btn" href="/admin/dashboard.php">进入后台</a>`
    : `<span style="margin-left:auto"></span><a class="md-btn" style="background:#fff;color:#1976d2;border:1px solid #1976d2" href="/admin/index.php">登录</a>`;

  return layout('考试看板配置查询', `
<div class="navbar"><span class="material-icons">dashboard</span>考试看板配置查询${userArea}</div>
<div class="container" style="max-width:460px">
<form id="query-form">
<label for="configId">配置ID</label>
<input id="configId" required />
<div id="jsonWrap" style="display:none;margin-top:16px">
<pre style="background:#f6f8fa;padding:12px;border-radius:6px;overflow:auto"><code id="jsonCode"></code></pre>
<button class="md-btn" type="button" id="presentBtn">放映</button>
</div>
<div class="actions"><button class="md-btn" type="submit"><span class="material-icons">search</span>查询考试安排</button></div>
</form>
</div>
<script>
document.getElementById('query-form').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const id = document.getElementById('configId').value.trim();
  if(!id) return;
  const res = await fetch('/api/get_config.php?id='+encodeURIComponent(id));
  const data = await res.json();
  if(!res.ok){ alert('获取配置失败: '+(data.error||'未知错误')); return; }
  document.getElementById('jsonCode').textContent = JSON.stringify(data, null, 2);
  document.getElementById('jsonWrap').style.display = 'block';
  document.getElementById('presentBtn').onclick=()=>location.href='/present/index.html?configId='+encodeURIComponent(id);
});
</script>`);
}

function pageLogin(message = ''): Response {
  return layout('管理员登录', `
<div class="navbar"><span class="material-icons">admin_panel_settings</span>管理员后台<a href="/index.php" class="md-btn" style="margin-left:auto;background:#fff;color:#1976d2;border:1px solid #1976d2">主页</a></div>
<div class="container" style="max-width:420px">
${message ? `<div class="msg">${escapeHtml(message)}</div>` : ''}
<form method="post" action="/admin/login.php">
<label>用户名</label><input name="username" required />
<label>密码</label><input name="password" type="password" required />
<div class="actions"><button class="md-btn" type="submit">登录</button></div>
</form>
</div>`);
}

function pageDashboard(session: SessionRecord): Response {
  const userAdmin = session.role === 'admin';
  return layout('后台管理', `
<div class="navbar"><span class="material-icons">admin_panel_settings</span>后台管理<a href="/index.php" class="md-btn" style="margin-left:12px;background:#fff;color:#1976d2;border:1px solid #1976d2">主页</a><span style="margin-left:auto">当前用户：${escapeHtml(session.username)} (${session.role === 'admin' ? '管理员' : '普通用户'})</span><a href="/admin/logout.php" class="md-btn" style="margin-left:12px">退出</a></div>
<div class="container">
<div class="actions">
<a class="md-btn" href="/admin/manage_configs.php">配置管理</a>
${userAdmin ? '<a class="md-btn" href="/admin/manage_users.php">用户管理</a>' : ''}
</div>
</div>`);
}

function pageManageConfigs(session: SessionRecord, configs: ConfigRecord[]): Response {
  return layout('配置管理', `
<div class="navbar"><span class="material-icons">dashboard_customize</span>配置管理<a href="/index.php" class="md-btn" style="margin-left:12px;background:#fff;color:#1976d2;border:1px solid #1976d2">主页</a></div>
<div class="container">
<div class="actions">
<a class="md-btn" href="/admin/dashboard.php">返回</a>
<a class="md-btn" href="/admin/edit_config.php">新建配置</a>
</div>
${configs.length === 0 ? '<p>暂无配置</p>' : configs.map(cfg=>`
<div class="card">
<div><strong>${escapeHtml(cfg.content.examName || '(未命名)')}</strong></div>
<div>ID: ${escapeHtml(cfg.id)}</div>
<div>考场号: ${escapeHtml(cfg.content.room || '')}</div>
<div>${escapeHtml(cfg.content.message || '')}</div>
<div class="actions">
<a class="md-btn" href="/admin/edit_config.php?id=${encodeURIComponent(cfg.id)}">编辑</a>
<a class="md-btn danger" href="/admin/delete_config.php?id=${encodeURIComponent(cfg.id)}" onclick="return confirm('确定删除该配置？')">删除</a>
</div>
</div>`).join('')}
</div>`);
}

function pageEditConfig(input: { id: string; isEdit: boolean; examName: string; message: string; room: string; examInfos: Array<{ name: string; start: string; end: string }> }, msg = ''): Response {
  const infos = input.examInfos.length ? input.examInfos : [{ name: '', start: '', end: '' }];
  return layout(`${input.isEdit ? '编辑' : '新建'}考试配置`, `
<div class="navbar"><span class="material-icons">edit</span>${input.isEdit ? '编辑' : '新建'}考试配置<a href="/index.php" class="md-btn" style="margin-left:12px;background:#fff;color:#1976d2;border:1px solid #1976d2">主页</a></div>
<div class="container">
${msg ? `<div class="msg">${escapeHtml(msg)}</div>` : ''}
<form method="post" id="configForm">
<label>配置ID</label><input name="id" value="${escapeHtml(input.id)}" ${input.isEdit ? 'readonly' : 'required'} />
<label>考试名称</label><input name="examName" value="${escapeHtml(input.examName)}" required />
<label>提示语</label><input name="message" value="${escapeHtml(input.message)}" />
<label>考场号</label><input name="room" value="${escapeHtml(input.room)}" />
<label>考试科目安排</label>
<table class="table"><thead><tr><th>科目名称</th><th>开始时间</th><th>结束时间</th><th>操作</th></tr></thead><tbody id="subjects"></tbody></table>
<div class="actions"><button class="md-btn" type="button" id="addRow">添加科目</button></div>
<div class="actions"><button class="md-btn" type="submit">保存</button><a class="md-btn" style="background:#888" href="/admin/manage_configs.php">返回</a></div>
</form>
</div>
<script>
const initialRows = ${JSON.stringify(infos)};
const body = document.getElementById('subjects');
function dt(v){ return (v||'').slice(0,19); }
function addRow(row={name:'',start:'',end:''}){
  const tr=document.createElement('tr');
  tr.innerHTML='<td><input name="subject_name[]" required></td><td><input type="datetime-local" name="subject_start[]" required></td><td><input type="datetime-local" name="subject_end[]" required></td><td><button class="md-btn danger" type="button">删除</button></td>';
  tr.querySelector('input[name="subject_name[]"]').value=row.name||'';
  tr.querySelector('input[name="subject_start[]"]').value=dt(row.start);
  tr.querySelector('input[name="subject_end[]"]').value=dt(row.end);
  tr.querySelector('button').onclick=()=>{ tr.remove(); if(!body.querySelector('tr')) addRow(); };
  body.appendChild(tr);
}
(initialRows.length?initialRows:[{name:'',start:'',end:''}]).forEach(addRow);
document.getElementById('addRow').onclick=()=>addRow();
</script>`);
}

function pageManageUsers(users: UserRecord[]): Response {
  return layout('用户管理', `
<div class="navbar"><span class="material-icons">group</span>用户管理<a href="/index.php" class="md-btn" style="margin-left:12px;background:#fff;color:#1976d2;border:1px solid #1976d2">主页</a></div>
<div class="container">
<div class="actions"><a class="md-btn" href="/admin/dashboard.php">返回</a><a class="md-btn" href="/admin/edit_user.php">新建用户</a></div>
<table class="table"><thead><tr><th>用户名</th><th>角色</th><th>操作</th></tr></thead><tbody>
${users.map(u=>`<tr><td>${escapeHtml(u.username)}</td><td>${u.role === 'admin' ? '管理员' : '普通用户'}</td><td><div class="actions"><a class="md-btn" href="/admin/edit_user.php?id=${u.id}">编辑</a>${u.username !== DEFAULT_ADMIN_USERNAME ? `<a class="md-btn danger" href="/admin/delete_user.php?id=${u.id}" onclick="return confirm('确定删除该用户？')">删除</a>` : ''}</div></td></tr>`).join('')}
</tbody></table></div>`);
}

function pageEditUser(input: { isEdit: boolean; id: number; username: string; role: Role }, msg = ''): Response {
  return layout(`${input.isEdit ? '编辑' : '新建'}用户`, `
<div class="navbar"><span class="material-icons">person</span>${input.isEdit ? '编辑' : '新建'}用户<a href="/index.php" class="md-btn" style="margin-left:12px;background:#fff;color:#1976d2;border:1px solid #1976d2">主页</a></div>
<div class="container" style="max-width:460px">
${msg ? `<div class="msg">${escapeHtml(msg)}</div>` : ''}
<form method="post">
<input type="hidden" name="id" value="${input.isEdit ? input.id : ''}">
<label>用户名</label><input name="username" value="${escapeHtml(input.username)}" ${input.isEdit ? 'readonly' : 'required'}>
<label>${input.isEdit ? '新密码（留空不修改）' : '密码'}</label><input type="password" name="password" ${input.isEdit ? '' : 'required'}>
<label>角色</label><select name="role"><option value="user" ${input.role === 'user' ? 'selected' : ''}>普通用户</option><option value="admin" ${input.role === 'admin' ? 'selected' : ''}>管理员</option></select>
<div class="actions"><button class="md-btn" type="submit">保存</button><a class="md-btn" style="background:#888" href="/admin/manage_users.php">返回</a></div>
</form>
</div>`);
}

function normalizeDateTimeLocal(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
