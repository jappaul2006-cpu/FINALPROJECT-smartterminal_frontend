<script setup>
import { ref, onMounted } from 'vue'
import { api } from '@/api'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const items = ref([])
const loading = ref(true)
const error = ref(null)
const msg = ref(null)

// FCM stub: register device token for this user
const token = ref('')
const tokenMsg = ref(null)

async function fetchNotifications() {
  try {
    const params = auth.user?.id ? { params: { user_id: auth.user.id } } : {}
    const r = await api.get('/api/notifications', params)
    items.value = r.data.data || []
    error.value = null
  } catch (err) {
    error.value = 'Failed to load notifications'
    console.error(err)
  } finally {
    loading.value = false
  }
}

async function markRead(id) {
  try {
    await api.post(`/api/notifications/${id}/read`)
    await fetchNotifications()
  } catch (_) {}
}

async function registerToken() {
  tokenMsg.value = null
  try {
    if (!token.value.trim()) { tokenMsg.value = 'Paste a device token first.'; return }
    await api.post('/api/device-tokens', {
      user_id: auth.user.id,
      token: token.value.trim(),
      platform: 'web',
    })
    tokenMsg.value = 'Device token registered. Firebase Cloud Messaging can now target this user (needs Firebase project keys in production).'
    token.value = ''
  } catch (_) {
    tokenMsg.value = 'Failed to register token.'
  }
}

onMounted(fetchNotifications)
</script>

<template>
  <div class="list-view">
    <h1>Notifications &amp; Push (FCM)</h1>
    <div v-if="error" class="error">{{ error }}</div>
    <div v-if="msg" class="ok">{{ msg }}</div>

    <section class="card">
      <h2>Register device token</h2>
      <div class="row">
        <input v-model="token" type="text" placeholder="Paste FCM device token…" />
        <button type="button" @click="registerToken">Register</button>
      </div>
      <p v-if="tokenMsg" class="hint">{{ tokenMsg }}</p>
      <p class="hint">Integration 1/5: Push Notification (FCM). Backend stores tokens in <code>device_tokens</code> and notification rows in <code>notifications</code>; actual FCM send needs Firebase project credentials.</p>
    </section>

    <div v-if="loading" class="loading">Loading…</div>
    <table v-else>
      <thead>
        <tr><th>ID</th><th>User</th><th>Trip</th><th>Type</th><th>Title</th><th>Message</th><th>Read</th><th>Created</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="n in items" :key="n.id">
          <td>{{ n.id }}</td>
          <td>{{ n.user_id ?? '—' }}</td>
          <td>{{ n.trip_id ?? '—' }}</td>
          <td>{{ n.type }}</td>
          <td>{{ n.title }}</td>
          <td>{{ n.message }}</td>
          <td>{{ n.is_read ? 'Yes' : 'No' }}</td>
          <td>{{ n.created_at }}</td>
          <td><button v-if="!n.is_read" type="button" @click="markRead(n.id)">Mark read</button></td>
        </tr>
      </tbody>
    </table>
    <div v-if="items.length === 0 && !loading" class="empty">No notifications.</div>
  </div>
</template>

<style scoped>
.list-view { max-width: 1300px; margin: 0 auto; padding: 2rem; }
h1 { color: #333; margin-bottom: 1.5rem; }
.card { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; }
.row { display: flex; gap: 0.5rem; }
.row input { flex: 1; padding: 0.7rem; border: 1px solid #d1d5db; border-radius: 6px; }
.row button, td button {
  background: #2563eb; color: #fff; border: none; border-radius: 6px;
  padding: 0.6rem 1rem; cursor: pointer;
}
table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; }
th, td { padding: 0.8rem; text-align: left; border-bottom: 1px solid #e0e0e0; font-size: 0.9rem; }
th { background: #f5f5f5; }
.loading { text-align: center; padding: 3rem; color: #666; }
.error { background: #fee2e2; color: #991b1b; padding: 1rem; border-radius: 4px; margin-bottom: 1rem; }
.ok { background: #dcfce7; color: #166534; padding: 1rem; border-radius: 4px; margin-bottom: 1rem; }
.empty { text-align: center; padding: 2rem; color: #666; }
.hint { margin-top: 0.7rem; color: #555; font-size: 0.85rem; }
</style>
