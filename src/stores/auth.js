import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/api'

const STORAGE_KEY = 'st_user'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) user.value = JSON.parse(raw)
  } catch (_) {}

  const isLoggedIn = computed(() => !!user.value)
  const role = computed(() => user.value?.role || '')
  const isAdmin = computed(() => role.value === 'admin')
  const isDispatcher = computed(() => role.value === 'admin' || role.value === 'dispatcher')
  const isDriver = computed(() => role.value === 'driver')

  async function login(username, password) {
    const res = await api.post('/api/login', { username, password })
    const data = res.data?.data || res.data
    user.value = data
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch (_) {}
    return data
  }

  async function logout() {
    const refreshToken = user.value?.tokens?.refresh_token || user.value?.refresh_token
    try {
      if (refreshToken) await api.post('/api/logout', { refresh_token: refreshToken })
    } catch (_) {
      // Best effort server-side revoke; always clear local session.
    } finally {
      user.value = null
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch (_) {}
    }
  }

  function canAccess(matchedRoles) {
    if (!matchedRoles || matchedRoles.length === 0) return true
    return matchedRoles.includes('any') || matchedRoles.includes(role.value)
  }

  return { user, isLoggedIn, role, isAdmin, isDispatcher, isDriver, login, logout, canAccess }
})
