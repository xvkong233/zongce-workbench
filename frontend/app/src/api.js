const TOKEN_KEY = 'zongce_token'
const USER_KEY = 'zongce_user'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY))
export const getUser = () => JSON.parse(localStorage.getItem(USER_KEY) || 'null')
export const setUser = (u) => (u ? localStorage.setItem(USER_KEY, JSON.stringify(u)) : localStorage.removeItem(USER_KEY))

async function readError(res) {
  let detail = null
  try {
    const data = await res.json()
    detail = data?.detail
  } catch { /* ignore */ }
  let msg = null
  if (detail?.message) msg = detail.message
  else if (Array.isArray(detail)) msg = '参数校验失败：' + detail.map((e) => e?.msg).join('；')
  else if (typeof detail === 'string') msg = detail
  const err = new Error(msg || `请求失败（${res.status}）`)
  err.status = res.status
  err.detail = detail
  return err
}

export async function api(path, { method = 'GET', body, form, params, raw } = {}) {
  if (params) {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') qs.append(k, v)
    }
    const s = qs.toString()
    if (s) path += `?${s}`
  }
  const headers = {}
  const t = getToken()
  if (t) headers.Authorization = `Bearer ${t}`
  const opts = { method, headers }
  if (form) opts.body = form
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  const res = await fetch(`/api${path}`, opts)
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    setToken(null); setUser(null)
    window.location.hash = ''
    window.location.href = '/login'
    throw new Error('登录状态已失效，请重新登录')
  }
  if (raw) {
    if (!res.ok) throw await readError(res)
    return res
  }
  if (!res.ok) throw await readError(res)
  const ct = res.headers.get('content-type') || ''
  return ct.includes('json') ? res.json() : res.text()
}

export async function download(res, fallbackName = 'export.xlsx') {
  const cd = res.headers.get('content-disposition') || ''
  const m = cd.match(/filename\*=UTF-8''([^;]+)/) || cd.match(/filename="?([^";]+)"?/)
  const name = m ? decodeURIComponent(m[1]) : fallbackName
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export const isAdmin = () => getUser()?.role === 'admin'
