type Env = {
  DB: D1Database
  SIGNING_PRIVATE_B64: string
  ACCESS_PEPPER: string
  ADMIN_TOKEN: string
}

type KeyRow = {
  key_id: string
  key_hash: string
  key_masked: string
  status: string
  plan: string
  created_at: string
  activated_at: string | null
  expires_at: string | null
  duration_days: number
  device_limit: number
  device_id: string | null
  last_checked_at: string | null
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors }
  })
}

function addDays(iso: string, days: number): string {
  const date = new Date(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function importPrivateKey(b64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(b64), (char) => char.charCodeAt(0))
  return crypto.subtle.importKey('pkcs8', raw, { name: 'Ed25519' }, false, ['sign'])
}

async function signPayload(env: Env, payload: unknown): Promise<{ payload: string; signature: string }> {
  const text = JSON.stringify(payload)
  const key = await importPrivateKey(env.SIGNING_PRIVATE_B64)
  const signature = await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(text))
  const bytes = new Uint8Array(signature)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return { payload: text, signature: btoa(binary) }
}

async function hashKey(env: Env, key: string): Promise<string> {
  return sha256Hex(`${env.ACCESS_PEPPER}:${key}`)
}

function claims(row: KeyRow, deviceId: string) {
  return {
    v: 1 as const,
    keyId: row.key_id,
    plan: 'beta' as const,
    status: row.status,
    expiresAt: row.expires_at,
    activatedAt: row.activated_at,
    deviceId,
    issuedAt: new Date().toISOString()
  }
}

function adminOk(request: Request, env: Env): boolean {
  const header = request.headers.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  return Boolean(env.ADMIN_TOKEN) && token === env.ADMIN_TOKEN
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors })
    const url = new URL(request.url)

    if (request.method === 'GET' && url.pathname === '/admin') {
      return new Response(adminHtml(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }

    try {
      if (request.method === 'POST' && url.pathname === '/v1/activate') {
        return await activate(request, env)
      }
      if (request.method === 'POST' && url.pathname === '/v1/check') {
        return await check(request, env)
      }
      if (request.method === 'POST' && url.pathname === '/admin/api/issue') {
        if (!adminOk(request, env)) return json({ ok: false, code: 'blocked' }, 401)
        return await issueIfEmpty(env)
      }
      if (request.method === 'GET' && url.pathname === '/admin/api/keys') {
        if (!adminOk(request, env)) return json({ ok: false, code: 'blocked' }, 401)
        const rows = await env.DB.prepare('SELECT * FROM access_keys ORDER BY created_at').all<KeyRow>()
        return json({ ok: true, keys: rows.results ?? [] })
      }
      if (request.method === 'POST' && url.pathname.startsWith('/admin/api/keys/')) {
        if (!adminOk(request, env)) return json({ ok: false, code: 'blocked' }, 401)
        return await adminAction(url.pathname, request, env)
      }
      if (request.method === 'GET' && url.pathname === '/health') {
        return json({ ok: true })
      }
      return json({ ok: false, code: 'not_found' }, 404)
    } catch (error) {
      console.error(error)
      return json({ ok: false, code: 'network' }, 500)
    }
  }
}

async function findByHash(env: Env, hash: string): Promise<KeyRow | null> {
  return env.DB.prepare('SELECT * FROM access_keys WHERE key_hash = ?').bind(hash).first<KeyRow>()
}

async function findById(env: Env, id: string): Promise<KeyRow | null> {
  return env.DB.prepare('SELECT * FROM access_keys WHERE key_id = ?').bind(id).first<KeyRow>()
}

async function activate(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { key?: string; deviceId?: string }
  const key = String(body.key ?? '').toUpperCase().replace(/\s+/g, '')
  const deviceId = String(body.deviceId ?? '')
  if (!key || !deviceId) return json({ ok: false, code: 'not_found' }, 400)
  const row = await findByHash(env, await hashKey(env, key))
  if (!row) return json({ ok: false, code: 'not_found' }, 404)
  if (row.status === 'blocked') return json({ ok: false, code: 'blocked' }, 403)
  const now = new Date().toISOString()
  if (!row.activated_at) {
    const expires = addDays(now, row.duration_days)
    await env.DB.prepare(
      `UPDATE access_keys SET status = ?, activated_at = ?, expires_at = ?, device_id = ?, last_checked_at = ? WHERE key_id = ?`
    )
      .bind('active', now, expires, deviceId, now, row.key_id)
      .run()
    const updated = await findById(env, row.key_id)
    if (!updated) return json({ ok: false, code: 'network' }, 500)
    return json({ ok: true, token: await signPayload(env, claims(updated, deviceId)) })
  }
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
    return json({ ok: false, code: 'expired' }, 403)
  }
  if (row.device_id && row.device_id !== deviceId) {
    return json({ ok: false, code: 'other_device' }, 403)
  }
  if (!row.device_id) {
    await env.DB.prepare('UPDATE access_keys SET device_id = ?, last_checked_at = ? WHERE key_id = ?')
      .bind(deviceId, now, row.key_id)
      .run()
  } else {
    await env.DB.prepare('UPDATE access_keys SET last_checked_at = ? WHERE key_id = ?').bind(now, row.key_id).run()
  }
  const updated = await findById(env, row.key_id)
  if (!updated) return json({ ok: false, code: 'network' }, 500)
  return json({ ok: true, token: await signPayload(env, claims(updated, deviceId)) })
}

async function check(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { keyId?: string; deviceId?: string }
  const row = await findById(env, String(body.keyId ?? ''))
  const deviceId = String(body.deviceId ?? '')
  if (!row) return json({ ok: false, code: 'not_found' }, 404)
  if (row.status === 'blocked') return json({ ok: false, code: 'blocked' }, 403)
  if (row.device_id && deviceId && row.device_id !== deviceId) {
    return json({ ok: false, code: 'other_device' }, 403)
  }
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
    await env.DB.prepare('UPDATE access_keys SET status = ?, last_checked_at = ? WHERE key_id = ?')
      .bind('expired', new Date().toISOString(), row.key_id)
      .run()
    return json({ ok: false, code: 'expired' }, 403)
  }
  await env.DB.prepare('UPDATE access_keys SET last_checked_at = ? WHERE key_id = ?')
    .bind(new Date().toISOString(), row.key_id)
    .run()
  const updated = await findById(env, row.key_id)
  if (!updated) return json({ ok: false, code: 'network' }, 500)
  return json({ ok: true, token: await signPayload(env, claims(updated, deviceId)) })
}

async function issueIfEmpty(env: Env): Promise<Response> {
  const count = await env.DB.prepare('SELECT COUNT(*) as n FROM access_keys').first<{ n: number }>()
  return json({ ok: true, existing: count?.n ?? 0 })
}

async function adminAction(pathname: string, request: Request, env: Env): Promise<Response> {
  const parts = pathname.split('/')
  const id = parts[4]
  const action = parts[5]
  const row = await findById(env, id)
  if (!row) return json({ ok: false, code: 'not_found' }, 404)
  if (action === 'block') {
    await env.DB.prepare('UPDATE access_keys SET status = ? WHERE key_id = ?').bind('blocked', id).run()
  } else if (action === 'unblock') {
    await env.DB.prepare('UPDATE access_keys SET status = ? WHERE key_id = ?')
      .bind(row.activated_at ? 'active' : 'not_activated', id)
      .run()
  } else if (action === 'unbind') {
    await env.DB.prepare('UPDATE access_keys SET device_id = NULL WHERE key_id = ?').bind(id).run()
  } else if (action === 'extend') {
    const body = (await request.json().catch(() => ({}))) as { days?: number }
    const days = Number(body.days) || 30
    const base = row.expires_at && Date.parse(row.expires_at) > Date.now() ? row.expires_at : new Date().toISOString()
    await env.DB.prepare('UPDATE access_keys SET expires_at = ?, status = ? WHERE key_id = ?')
      .bind(addDays(base, days), 'active', id)
      .run()
  } else {
    return json({ ok: false, code: 'not_found' }, 404)
  }
  return json({ ok: true, key: await findById(env, id) })
}

function adminHtml(): string {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>TAIMIO ключи</title>
<style>
body{font-family:Manrope,Segoe UI,sans-serif;background:#070b18;color:#f4f7ff;margin:24px}
input,button{padding:8px 10px;border-radius:10px;border:1px solid #334;background:#11182c;color:#fff}
table{width:100%;border-collapse:collapse;margin-top:16px;font-size:14px}
td,th{border-bottom:1px solid #223;padding:8px;text-align:left}
button{cursor:pointer}
</style></head><body>
<h1>Ключи доступа TAIMIO Beta</h1>
<p><input id="token" type="password" placeholder="Пароль админки" style="width:320px">
<button onclick="loadKeys()">Открыть</button></p>
<div id="out"></div>
<script>
async function api(path, method='GET', body){
  const token = document.getElementById('token').value
  const res = await fetch(path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})
  return res.json()
}
async function act(id, action){
  await api('/admin/api/keys/'+id+'/'+action,'POST', action==='extend'?{days:30}:undefined)
  loadKeys()
}
async function loadKeys(){
  const data = await api('/admin/api/keys')
  if(!data.ok){document.getElementById('out').textContent='Нет доступа';return}
  document.getElementById('out').innerHTML = '<table><tr><th>Маска</th><th>Статус</th><th>Активирован</th><th>До</th><th>Устройство</th><th></th></tr>'+(data.keys||[]).map(k=>
    '<tr><td>'+k.key_masked+'</td><td>'+k.status+'</td><td>'+(k.activated_at||'—')+'</td><td>'+(k.expires_at||'—')+'</td><td>'+(k.device_id?'да':'нет')+'</td><td>'+
    '<button onclick="act(\\''+k.key_id+'\\',\\'block\\')">Блок</button> '+
    '<button onclick="act(\\''+k.key_id+'\\',\\'unblock\\')">Снять блок</button> '+
    '<button onclick="act(\\''+k.key_id+'\\',\\'extend\\')">+30 дней</button> '+
    '<button onclick="act(\\''+k.key_id+'\\',\\'unbind\\')">Снять ПК</button></td></tr>'
  ).join('')+'</table>'
}
</script></body></html>`
}
