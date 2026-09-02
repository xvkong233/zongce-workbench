import axios from 'axios'

export const TOKEN_KEY = 'zongce_token'
export const USER_KEY = 'zongce_user'

const api = axios.create({ baseURL: '/api' })
export { api }

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

api.interceptors.response.use(
  (resp) => resp,
  (err) => {
    if (err.response && err.response.status === 401) {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(USER_KEY)
      if (!location.pathname.startsWith('/user/login')) window.location.href = '/user/login'
    }
    return Promise.reject(err)
  },
)

export function errMsg(e, fallback = '操作失败') {
  const d = e?.response?.data
  if (d?.detail) {
    if (Array.isArray(d.detail)) {
      const msgs = d.detail.map((x) => x?.msg).filter(Boolean).join('；')
      return msgs || fallback
    }
    if (typeof d.detail === 'string') return d.detail
  }
  return e?.message || fallback
}

export async function downloadFile(url, params, filename) {
  const resp = await api.get(url, { params, responseType: 'blob' })
  const cd = resp.headers['content-disposition'] || ''
  const m = cd.match(/filename\*=UTF-8''([^;]+)/)
  const name = m ? decodeURIComponent(m[1]) : filename
  const blobUrl = URL.createObjectURL(resp.data)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = name
  a.click()
  URL.revokeObjectURL(blobUrl)
}

export function currentUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null')
  } catch {
    return null
  }
}
