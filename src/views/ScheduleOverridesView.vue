<script setup>
import { ref, onMounted } from 'vue'
import { api } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useCatalogStore } from '@/stores/catalog'

const auth = useAuthStore()
const catalog = useCatalogStore()
const items = ref([])
const trips = ref([])
const loading = ref(true)
const error = ref(null)
const msg = ref(null)
const form = ref({ trip_id: '', new_departure: '', reason: '' })

async function load() {
  try {
    const [o, t] = await Promise.all([
      catalog.fetch('scheduleOverrides'),
      catalog.fetch('trips'),
    ])
    items.value = o || []
    trips.value = t || []
  } catch (err) {
    error.value = 'Failed to load schedule overrides'
    console.error(err)
  } finally {
    loading.value = false
  }
}

async function submit() {
  msg.value = null
  error.value = null
  try {
    await api.post('/api/schedule-overrides', {
      trip_id: Number(form.value.trip_id),
      new_departure: form.value.new_departure,
      reason: form.value.reason || null,
      overridden_by: auth.user?.id ?? null,
    })
    msg.value = 'Schedule override saved. Trip departure updated and driver notified.'
    form.value = { trip_id: '', new_departure: '', reason: '' }
    catalog.invalidate('scheduleOverrides', 'trips')
    await load()
  } catch (err) {
    error.value = err?.response?.data?.error || err?.response?.data?.message || 'Failed to save override'
  }
}

onMounted(() => load())
</script>

<template>
  <div class="list-view">
    <h1>Schedule Overrides — Enforce Departure Timelines</h1>
    <div v-if="error" class="error">{{ error }}</div>
    <div v-if="msg" class="ok">{{ msg }}</div>

    <form class="card form" @submit.prevent="submit">
      <h2>Override a trip departure</h2>
      <div class="grid">
        <label>
          Trip
          <select v-model="form.trip_id" required>
            <option value="">Select trip…</option>
            <option v-for="t in trips" :key="t.id" :value="t.id">#{{ t.id }} — route {{ t.route_id }} — {{ t.scheduled_departure }} — {{ t.status }}</option>
          </select>
        </label>
        <label>
          New departure (YYYY-MM-DD HH:MM:SS)
          <input v-model="form.new_departure" type="text" placeholder="2026-11-06 15:00:00" required />
        </label>
        <label>
          Reason
          <input v-model="form.reason" type="text" placeholder="e.g. Waiting for late passengers" />
        </label>
      </div>
      <button type="submit">Save override</button>
    </form>

    <div v-if="loading" class="loading">Loading…</div>
    <table v-else>
      <thead><tr><th>ID</th><th>Trip</th><th>Old Departure</th><th>New Departure</th><th>Reason</th><th>By</th><th>Created</th></tr></thead>
      <tbody>
        <tr v-for="o in items" :key="o.id">
          <td>{{ o.id }}</td>
          <td>#{{ o.trip_id }}</td>
          <td>{{ o.old_departure }}</td>
          <td>{{ o.new_departure }}</td>
          <td>{{ o.reason || '—' }}</td>
          <td>{{ o.overridden_by ?? '—' }}</td>
          <td>{{ o.created_at }}</td>
        </tr>
      </tbody>
    </table>
    <div v-if="items.length === 0 && !loading" class="empty">No overrides yet.</div>
  </div>
</template>

<style scoped>
.list-view { max-width: 1300px; margin: 0 auto; padding: 2rem; }
h1 { color: #333; margin-bottom: 1.5rem; }
.card { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; }
.grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; margin-bottom: 1rem; }
label { font-size: 0.9rem; display: block; }
select, input { width: 100%; margin-top: 0.3rem; padding: 0.7rem; border: 1px solid #d1d5db; border-radius: 6px; }
button { background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 0.7rem 1.2rem; cursor: pointer; }
table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; }
th, td { padding: 0.8rem; text-align: left; border-bottom: 1px solid #e0e0e0; font-size: 0.9rem; }
th { background: #f5f5f5; }
.loading { text-align: center; padding: 3rem; color: #666; }
.error { background: #fee2e2; color: #991b1b; padding: 1rem; border-radius: 4px; margin-bottom: 1rem; }
.ok { background: #dcfce7; color: #166534; padding: 1rem; border-radius: 4px; margin-bottom: 1rem; }
.empty { text-align: center; padding: 2rem; color: #666; }
</style>
