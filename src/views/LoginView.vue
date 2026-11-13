<script setup>
import { ref } from 'vue'
import { useRouter, useRoute, RouterLink } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const username = ref('')
const password = ref('')
const error = ref(null)
const loading = ref(false)
const showPassword = ref(false)

async function onSubmit() {
  error.value = null
  loading.value = true
  try {
    const data = await auth.login(username.value, password.value)
    const role = data?.role || auth.role
    let target = route.query.redirect || ''
    if (!target) {
      if (role === 'driver') target = '/driver'
      else if (role === 'dispatcher') target = '/dispatch-queue'
      else target = '/dashboard'
    }
    await router.push(target)
  } catch (err) {
    const status = err?.response?.status
    const serverError = err?.response?.data?.error || err?.response?.data?.message
    if (serverError) {
      error.value = serverError
    } else if (status === 404) {
      error.value = 'Backend not found (404). Is the PHP server running on port 8000? Run smartterminal_backend\\start-backend.bat'
    } else if (!err?.response) {
      error.value = 'Cannot reach backend. Is the PHP server running on http://localhost:8000?'
    } else {
      error.value = 'Login failed. Check username and password.'
    }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-wrap">
      <div class="logo-box">
        <div class="bus-icon">🚌</div>
        <h1 class="app-name">SmartTerminal</h1>
        <p class="sub">Yellow Mega Van · Calapan City, Or. Mindoro</p>
      </div>
      <div class="card">
        <form @submit.prevent="onSubmit">
          <label class="field-label">Username</label>
          <input v-model="username" type="text" placeholder="e.g. admin" autocomplete="username" required />
          <label class="field-label">Password</label>
          <div class="password-field">
            <input v-model="password" :type="showPassword ? 'text' : 'password'" placeholder="••••••••" autocomplete="current-password" required />
            <button type="button" class="toggle-password" @click="showPassword = !showPassword" :aria-label="showPassword ? 'Hide password' : 'Show password'">
              {{ showPassword ? 'Hide' : 'Show' }}
            </button>
          </div>
          <div v-if="error" class="error">{{ error }}</div>
          <button type="submit" :disabled="loading" class="signin-btn">
            {{ loading ? 'Signing in…' : 'Sign in' }}
          </button>
        </form>
      </div>
      <RouterLink to="/passenger-display" class="passenger-link">
        View passenger status screen
      </RouterLink>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  width: 100%;
  background: linear-gradient(180deg, #0f172a 0%, #1e3a8a 55%, #3b82f6 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  box-sizing: border-box;
}

.login-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2rem;
  width: 100%;
  max-width: 460px;
}

.logo-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  text-align: center;
}

.bus-icon {
  font-size: 3rem;
  filter: drop-shadow(0 4px 6px rgba(0,0,0,0.3));
}

.app-name {
  color: #fff;
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: 0.5px;
  margin: 0;
}

.sub {
  color: #cbd5e1;
  font-size: 0.9rem;
  margin: 0;
}

.card {
  background: #fff;
  border-radius: 12px;
  padding: 2rem;
  width: 100%;
  box-shadow: 0 10px 25px rgba(0,0,0,0.25);
}

.field-label {
  display: block;
  margin-bottom: 0.5rem;
  font-size: 0.875rem;
  color: #334155;
  font-weight: 600;
}

input {
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.875rem 1rem;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  font-size: 1rem;
  box-sizing: border-box;
}

input:focus {
  outline: none;
  border-color: #f59e0b;
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.15);
}

.password-field {
  position: relative;
  margin-bottom: 1rem;
}

.password-field input {
  margin-bottom: 0;
  padding-right: 4.5rem;
}

.toggle-password {
  position: absolute;
  right: 0.5rem;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: none;
  color: #475569;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
}

.toggle-password:hover {
  color: #f59e0b;
}

.error {
  background: #fecaca;
  color: #991b1b;
  padding: 0.75rem;
  border-radius: 6px;
  margin-bottom: 1rem;
  font-size: 0.9rem;
  text-align: center;
}

.signin-btn {
  width: 100%;
  background: #f59e0b;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 0.875rem;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  margin-top: 0.5rem;
}

.signin-btn:hover:not(:disabled) {
  background: #d97706;
}

.signin-btn:disabled {
  opacity: 0.7;
  cursor: wait;
}

.passenger-link {
  margin-top: 1rem;
  color: #e2e8f0;
  text-decoration: none;
  font-size: 0.95rem;
  text-align: center;
  padding: 0.5rem 1rem;
  border-radius: 8px;
  transition: color 0.2s, background 0.2s;
}

.passenger-link:hover {
  color: #fbbf24;
  background: rgba(255,255,255,0.08);
  text-decoration: none;
}
</style>
