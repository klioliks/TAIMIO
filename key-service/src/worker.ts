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

type TrialRow = {
  key_id: string
  device_id: string
  activated_at: string
  expires_at: string
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

function claims(
  row: KeyRow,
  deviceId: string,
  override?: {
    plan?: 'beta' | 'trial'
    status?: string
    expiresAt?: string | null
    activatedAt?: string | null
  }
) {
  const plan = override?.plan ?? (row.plan === 'trial' ? 'trial' : 'beta')
  return {
    v: 1 as const,
    keyId: row.key_id,
    plan,
    status: override?.status ?? row.status,
    expiresAt: override?.expiresAt !== undefined ? override.expiresAt : row.expires_at,
    activatedAt: override?.activatedAt !== undefined ? override.activatedAt : row.activated_at,
    deviceId,
    issuedAt: new Date().toISOString()
  }
}

function adminOk(request: Request, env: Env): boolean {
  const header = request.headers.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  return Boolean(env.ADMIN_TOKEN) && token === env.ADMIN_TOKEN
}

function maskDeviceId(id: string): string {
  const compact = id.replace(/-/g, '')
  if (compact.length < 8) return '••••'
  return `${compact.slice(0, 4)}••••${compact.slice(-4)}`
}

function trialStatus(row: TrialRow): 'active' | 'expired' {
  return Date.parse(row.expires_at) <= Date.now() ? 'expired' : 'active'
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
        const rows = await env.DB.prepare(
          "SELECT * FROM access_keys WHERE plan != 'trial' ORDER BY created_at"
        ).all<KeyRow>()
        return json({ ok: true, keys: rows.results ?? [] })
      }
      if (request.method === 'GET' && url.pathname === '/admin/api/trial') {
        if (!adminOk(request, env)) return json({ ok: false, code: 'blocked' }, 401)
        return await adminTrial(env)
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

async function findTrial(env: Env, keyId: string, deviceId: string): Promise<TrialRow | null> {
  return env.DB.prepare('SELECT * FROM trial_activations WHERE key_id = ? AND device_id = ?')
    .bind(keyId, deviceId)
    .first<TrialRow>()
}

async function signedTrial(env: Env, row: KeyRow, trial: TrialRow, deviceId: string): Promise<Response> {
  const status = trialStatus(trial)
  const now = new Date().toISOString()
  await env.DB.prepare(
    'UPDATE trial_activations SET last_checked_at = ? WHERE key_id = ? AND device_id = ?'
  )
    .bind(now, row.key_id, deviceId)
    .run()
  return json({
    ok: true,
    token: await signPayload(
      env,
      claims(row, deviceId, {
        plan: 'trial',
        status,
        expiresAt: trial.expires_at,
        activatedAt: trial.activated_at
      })
    )
  })
}

async function activateTrial(env: Env, row: KeyRow, deviceId: string): Promise<Response> {
  const existing = await findTrial(env, row.key_id, deviceId)
  if (existing) return signedTrial(env, row, existing, deviceId)
  if (row.status === 'blocked') return json({ ok: false, code: 'blocked' }, 403)
  const now = new Date().toISOString()
  const days = row.duration_days > 0 ? row.duration_days : 5
  const trial: TrialRow = {
    key_id: row.key_id,
    device_id: deviceId,
    activated_at: now,
    expires_at: addDays(now, days),
    last_checked_at: now
  }
  await env.DB.prepare(
    `INSERT INTO trial_activations (key_id, device_id, activated_at, expires_at, last_checked_at)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(trial.key_id, trial.device_id, trial.activated_at, trial.expires_at, trial.last_checked_at)
    .run()
  return signedTrial(env, row, trial, deviceId)
}

async function activate(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { key?: string; deviceId?: string }
  const key = String(body.key ?? '').toUpperCase().replace(/\s+/g, '')
  const deviceId = String(body.deviceId ?? '')
  if (!key || !deviceId) return json({ ok: false, code: 'not_found' }, 400)
  const row = await findByHash(env, await hashKey(env, key))
  if (!row) return json({ ok: false, code: 'not_found' }, 404)
  if (row.plan === 'trial') return activateTrial(env, row, deviceId)
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
  if (row.plan === 'trial') {
    const trial = await findTrial(env, row.key_id, deviceId)
    if (!trial) return json({ ok: false, code: 'not_found' }, 404)
    return signedTrial(env, row, trial, deviceId)
  }
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

async function adminTrial(env: Env): Promise<Response> {
  const key = await env.DB.prepare("SELECT * FROM access_keys WHERE plan = 'trial' LIMIT 1").first<KeyRow>()
  if (!key) return json({ ok: true, key: null, activations: [], total: 0, activeNow: 0 })
  const rows = await env.DB.prepare(
    'SELECT * FROM trial_activations WHERE key_id = ? ORDER BY activated_at DESC'
  )
    .bind(key.key_id)
    .all<TrialRow>()
  const activations = (rows.results ?? []).map((item) => ({
    deviceMasked: maskDeviceId(item.device_id),
    activatedAt: item.activated_at,
    expiresAt: item.expires_at,
    status: trialStatus(item)
  }))
  return json({
    ok: true,
    key: {
      keyId: key.key_id,
      keyMasked: key.key_masked,
      status: key.status,
      plan: 'trial',
      durationDays: key.duration_days
    },
    total: activations.length,
    activeNow: activations.filter((item) => item.status === 'active').length,
    activations
  })
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
    const next = row.plan === 'trial' || row.activated_at ? 'active' : 'not_activated'
    await env.DB.prepare('UPDATE access_keys SET status = ? WHERE key_id = ?').bind(next, id).run()
  } else if (action === 'unbind') {
    if (row.plan === 'trial') return json({ ok: false, code: 'not_found' }, 404)
    await env.DB.prepare('UPDATE access_keys SET device_id = NULL WHERE key_id = ?').bind(id).run()
  } else if (action === 'extend') {
    if (row.plan === 'trial') return json({ ok: false, code: 'not_found' }, 404)
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
h2{margin-top:32px}
.muted{color:#9aa8c7}
</style></head><body>
<h1>Ключи доступа TAIMIO</h1>
<p><input id="token" type="password" placeholder="Пароль админки" style="width:320px">
<button onclick="openAdmin()">Открыть</button></p>
<div id="out"></div>
<script>
function denied(data){
  return data.status === 401 || data.code === 'blocked'
}
function failDetail(data){
  return 'HTTP '+(data.status||'?')+' · code: '+(data.code||'unknown')
}
async function api(path, method='GET', body){
  const token = document.getElementById('token').value
  try {
    const res = await fetch(path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})
    let data = {}
    try { data = await res.json() } catch { data = { ok:false, code:'bad_json' } }
    return Object.assign({ ok:false }, data, { status: res.status })
  } catch (err) {
    return { ok:false, status:0, code:'network', error:String(err) }
  }
}
async function act(id, action){
  await api('/admin/api/keys/'+id+'/'+action,'POST', action==='extend'?{days:30}:undefined)
  openAdmin()
}
function fmt(value){
  if(!value) return '—'
  try { return new Date(value).toLocaleString('ru-RU') } catch { return value }
}
async function openAdmin(){
  const out = document.getElementById('out')
  const [keysData, trialData] = await Promise.all([api('/admin/api/keys'), api('/admin/api/trial')])
  if(!keysData.ok && denied(keysData) && !trialData.ok && denied(trialData)){
    out.textContent = 'Неверный пароль'
    return
  }
  const notices = []
  if(!keysData.ok){
    notices.push(denied(keysData)
      ? '<p><b>Неверный пароль</b></p><p class="muted">'+failDetail(keysData)+'</p>'
      : '<p><b>Авторизация прошла, но /admin/api/keys вернул ошибку.</b></p><p class="muted">'+failDetail(keysData)+'</p>')
  }
  if(!trialData.ok){
    notices.push(denied(trialData)
      ? '<p><b>Неверный пароль</b></p><p class="muted">'+failDetail(trialData)+'</p>'
      : '<p><b>Авторизация прошла, но /admin/api/trial вернул ошибку.</b></p><p class="muted">'+failDetail(trialData)+'</p>')
  }
  let trial = ''
  if(trialData.ok && trialData.key){
    const k = trialData.key
    const toggle = k.status === 'blocked'
      ? '<button onclick="act(\\''+k.keyId+'\\',\\'unblock\\')">Включить новые активации</button>'
      : '<button onclick="act(\\''+k.keyId+'\\',\\'block\\')">Выключить новые активации</button>'
    trial = '<h2>Пробный доступ</h2><p>Тип: trial · маска: '+k.keyMasked+' · раздача: '+(k.status==='blocked'?'выключена':'включена')+'</p><p>Активаций: '+(trialData.total||0)+' · сейчас активных: '+(trialData.activeNow||0)+'</p><p>'+toggle+'</p>'+
      '<table><tr><th>Устройство</th><th>Начало</th><th>До</th><th>Статус</th></tr>'+(trialData.activations||[]).map(a=>
        '<tr><td>'+a.deviceMasked+'</td><td>'+fmt(a.activatedAt)+'</td><td>'+fmt(a.expiresAt)+'</td><td>'+a.status+'</td></tr>'
      ).join('')+'</table>'
  } else if(trialData.ok){
    trial = '<h2>Пробный доступ</h2><p class="muted">Ключ ещё не заведён.</p>'
  }
  let beta = ''
  if(keysData.ok){
    beta = '<h2>Beta</h2><table><tr><th>Маска</th><th>Статус</th><th>Активирован</th><th>До</th><th>Устройство</th><th></th></tr>'+(keysData.keys||[]).map(k=>
      '<tr><td>'+k.key_masked+'</td><td>'+k.status+'</td><td>'+fmt(k.activated_at)+'</td><td>'+fmt(k.expires_at)+'</td><td>'+(k.device_id?'да':'нет')+'</td><td>'+
      '<button onclick="act(\\''+k.key_id+'\\',\\'block\\')">Блок</button> '+
      '<button onclick="act(\\''+k.key_id+'\\',\\'unblock\\')">Снять блок</button> '+
      '<button onclick="act(\\''+k.key_id+'\\',\\'extend\\')">+30 дней</button> '+
      '<button onclick="act(\\''+k.key_id+'\\',\\'unbind\\')">Снять ПК</button></td></tr>'
    ).join('')+'</table>'
  }
  out.innerHTML = notices.join('') + trial + beta
}
</script></body></html>`
}
