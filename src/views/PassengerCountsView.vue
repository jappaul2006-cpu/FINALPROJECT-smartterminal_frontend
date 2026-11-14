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
const form = ref({ trip_id: '', passengers_waiting: 0, passengers_boarded: 0, seats_available: 0 })

async function load() {
  try {
    const [c, t] = await Promise.all([
      catalog.fetch('passengerCounts'),
      catalog.fetch('trips'),
    ])
    items.value = c || []
    trips.value = t || []
  } catch (err) {
    error.value = 'Failed to load passenger counts'
    console.error(err)
  } finally {
    loading.value = false
  }
}

async function record() {
  msg.value = null
  error.value = null
  try {
    await api.post('/api/passenger-counts', {
      trip_id: Number(form.value.trip_id),
      passengers_waiting: Number(form.value.passengers_waiting),
      passengers_boarded: Number(form.value.passengers_boarded),
      seats_available: Number(form.value.seats_available),
      recorded_by: auth.user?.id ?? null,
    })
    msg.value = 'Passenger count recorded. Passenger Display will show latest counts.'
    form.value = { trip_id: '', passengers_waiting: 0, passengers_boarded: 0, seats_available: 0 }
    catalog.invalidate('passengerCounts')
    await load()
  } catch (err) {
    error.value = err?.response?.data?.error || 'Failed to record count'
  }
}

onMounted(() => load())
</script>

<template>
  <div class="list-view">
    <h1>Passenger Counts — Monitor Terminal Status</h1>

    <div v-if="error" class="error">{{ error }}</div>
    <div v-if="msg" class="ok">{{ msg }}</div>

    <form v-if="auth.isDispatcher" class="card form" @submit.prevent="record">
      <h2>Record count</h2>
      <div class="grid">
        <label>Trip
          <select v-model="form.trip_id" required>
            <option value="">Select trip…</option>
            <option v-for="t in trips" :key="t.id" :value="t.id">#{{ t.id }} — {{ t.status }}</option>
          </select>
        </label>
        <label>Waiting <input v-model.number="form.passengers_waiting" type="number" min="0" required /></label>
        <label>Boarded <input v-model.number="form.passengers_boarded" type="number" min="0" required /></label>
        <label>Seats available <input v-model.number="form.seats_available" type="number" min="0" required /></label>
      </div>
      <button type="submit">Save count</button>
    </form>

    <div v-if="loading" class="loading">Loading passenger counts…</div>
    <table v-else>
      <thead><tr><th>ID</th><th>Trip</th><th>Waiting</th><th>Boarded</th><th>Seats Left</th><th>Recorded By</th><th>Recorded At</th></tr></thead>
      <tbody>
        <tr v-for="item in items" :key="item.id">
          <td>{{ item.id }}</td>
          <td>#{{ item.trip_id }}</td>
          <td>{{ item.passengers_waiting }}</td>
          <td>{{ item.passengers_boarded }}</td>
          <td>{{ item.seats_available }}</td>
          <td>{{ item.recorded_by ?? '—' }}</td>
          <td>{{ item.recorded_at }}</td>
        </tr>
      </tbody>
    </table>
    <div v-if="items.length === 0 && !loading" class="empty">No passenger counts found.</div>
  </div>
</template>

<style scoped>
.list-view { max-width: 1300px; margin: 0 auto; padding: 2rem; }
h1 { color: #333; margin-bottom: 1.2rem; }
.card { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; }
.grid { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 1rem; margin-bottom: 1rem; }
@media (max-width: 800px) { .grid { grid-template-columns: 1fr 1fr; } }
label { font-size: 0.9rem; display: block; }
select, input { width: 100%; margin-top: 0.3rem; padding: 0.7rem; border: 1px solid #d1d5db; border-radius: 6px; }
button { background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 0.6rem 1rem; cursor: pointer; }
table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; overflow: auto; }
th, td { padding: 0.8rem; text-align: left; border-bottom: 1px solid #e0e0e0; font-size: 0.9rem; }
th { background: #f5f5f5; }
.loading { text-align: center; padding: 3rem; color: #666; }
.error { background: #fee2e2; color: #991b1b; padding: 1rem; border-radius: 4px; margin-bottom: 1rem; }
.ok { background: #dcfce7; color: #166534; padding: 1rem; border-radius: 4px; margin-bottom: 1rem; }
.empty { text-align: center; padding: 2rem; color: #666; }
</style>
