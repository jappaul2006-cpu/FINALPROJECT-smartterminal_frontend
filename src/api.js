import axios from 'axios'

// Base URL of the backend API.
//
// Leave VITE_API_URL empty for local development: every request then uses a
// relative path ("/api/...") and the Vite dev server proxies it to the PHP
// backend on http://localhost:8000 (see vite.config.ts). The browser only
// ever talks to its own origin, so CORS can never break the app.
//
// Set VITE_API_URL to an absolute URL (e.g. http://localhost:8000) to call
// the backend directly - the backend then allows the origins listed in its
// CORS_ORIGIN environment variable.
const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')

// The local backend is always up, so the requests must not wait a long time.
const TIMEOUT_MS = 60_000

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: TIMEOUT_MS,
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
    const res = await axios.post(`${API_BASE_URL}/api/refresh`, { refresh_token: refreshToken }, { headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, timeout: TIMEOUT_MS })
    const data = res.data?.data
    if (!data?.tokens?.access_token && !data?.token) return false
    const fresh = { ...user, ...data, tokens: data.tokens || { access_token: data.token, refresh_token: data.refresh_token } }
    localStorage.setItem('st_user', JSON.stringify(fresh))
    return true
  } catch (_) {
    return false
  }
}

// Retry network-level failures (ECONNRESET, ETIMEDOUT, etc.) once — these
// happen when the PHP backend is (re)starting or was closed for a moment.
let requestRetry = new Map()
async function retryOnce(config, error) {
  const key = config.url || ''
  const count = requestRetry.get(key) || 0
  if (count >= 1) {
    requestRetry.delete(key)
    return Promise.reject(error)
  }
  requestRetry.set(key, count + 1)
  // Wait briefly for the backend to come back up before retrying.
  await new Promise((r) => setTimeout(r, 3_000))
  try {
    requestRetry.delete(key)
    return await api(config)
  } catch (err2) {
    requestRetry.delete(key)
    return Promise.reject(err2)
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status
    const original = error.config || {}
    const url = String(original.url || '')
    const isAuthEndpoint = url.includes('/api/login') || url.includes('/api/refresh') || url.includes('/api/logout')

    // Retry transient network errors (backend spinning up) once.
    if (!error.response && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND' || error.message?.includes('network'))) {
      return retryOnce(original, error)
    }

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
