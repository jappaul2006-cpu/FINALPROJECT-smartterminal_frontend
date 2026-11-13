import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://smartterminal-backend.onrender.com'

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20_000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
})

// Attach the JWT access token from /api/login (LavaLust API helper, .env JWT_SECRET).
// User payload contains `tokens.access_token` (preferred) and legacy `token` fallback.
api.interceptors.request.use((config) => {
  try {
    const raw = localStorage.getItem('st_user')
    if (raw) {
      const user = JSON.parse(raw)
      const accessToken = user?.tokens?.access_token || user?.token
      if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`
    }
  } catch (_) {}
  return config
})

// If the access token expired, try to refresh once and retry the request.
// If refresh fails (or no refresh token), send the user to login.
let refreshing = null
async function tryRefresh() {
  try {
    const raw = localStorage.getItem('st_user')
    if (!raw) return false
    const user = JSON.parse(raw)
    const refreshToken = user?.tokens?.refresh_token || user?.refresh_token
    if (!refreshToken) return false
    const res = await axios.post(`${API_BASE_URL}/api/refresh`, { refresh_token: refreshToken }, { headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, timeout: 20_000 })
    const data = res.data?.data
    if (!data?.tokens?.access_token && !data?.token) return false
    const fresh = { ...user, ...data, tokens: data.tokens || { access_token: data.token, refresh_token: data.refresh_token } }
    localStorage.setItem('st_user', JSON.stringify(fresh))
    return true
  } catch (_) {
    return false
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status
    const original = error.config || {}
    const url = String(original.url || '')
    const isAuthEndpoint = url.includes('/api/login') || url.includes('/api/refresh') || url.includes('/api/logout')

    if (status === 401 && !isAuthEndpoint && !original._retried) {
      if (!refreshing) refreshing = tryRefresh().finally(() => { refreshing = null })
      const ok = await refreshing
      if (ok) {
        original._retried = true
        // re-attaches Authorization via request interceptor
        try { return await api(original) } catch (_) {}
      }
      // Refresh failed: clear session and send to login (once).
      try { localStorage.removeItem('st_user') } catch (_) {}
      const path = window.location.pathname || ''
      if (!path.includes('/login') && path !== '/') {
        window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname + window.location.search)
      }
    }

    if (error.response) {
      console.error(`API Error ${error.response.status}:`, error.response.data)
    } else if (error.request) {
      console.error('API Request failed (no response):', error.request)
    } else {
      console.error('API Error:', error.message)
    }
    return Promise.reject(error)
  }
)

export { api, API_BASE_URL }
