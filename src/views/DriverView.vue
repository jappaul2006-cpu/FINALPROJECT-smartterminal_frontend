<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useCatalogStore } from '@/stores/catalog'

const auth = useAuthStore()
const catalog = useCatalogStore()
const trips = ref([])
const vehicles = ref([])
const routes = ref([])
const loading = ref(true)
const error = ref(null)
const actionMsg = ref(null)
let poll = null

// A driver only ever sees their OWN trips. The profile is locked to
// the logged-in account (users.id <-> drivers.user_id); there is no
// switcher anymore.
const myDriverId = ref(null)
const myDriverName = computed(() => auth.user?.full_name || auth.user?.username || '')

const routeById = computed(() => Object.fromEntries(routes.value.map((r) => [r.id, r])))
const vehicleById = computed(() => Object.fromEntries(vehicles.value.map((v) => [v.id, v])))
const destOf = (t) => routeById.value[t.route_id]?.destination || `Route #${t.route_id}`
const vehicleOf = (t) => vehicleById.value[t.vehicle_id]?.model || `Vehicle #${t.vehicle_id}`

// Active trips (not finished) vs History (completed/cancelled).
const activeTrips = computed(() =>
  trips.value
    .filter((t) => !['completed', 'cancelled'].includes(String(t.status || '').toLowerCase()))
    .sort((a, b) => String(a.scheduled_departure || '').localeCompare(String(b.scheduled_departure || '')))
)
const historyTrips = computed(() =>
  trips.value
    .filter((t) => ['completed', 'cancelled'].includes(String(t.status || '').toLowerCase()))
    .sort((a, b) => String(b.scheduled_departure || '').localeCompare(String(a.scheduled_departure || '')))
)

function badgeForStatus(s) {
  s = String(s || '').toLowerCase()
  if (s === 'boarding') return 'badge-yellow'
  if (s === 'departed') return 'badge-blue'
  if (s === 'completed') return 'badge-green'
  if (s === 'cancelled') return 'badge-black'
  return 'badge-gray'
}
const fmt = (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : '—')

async function resolveMyDriver() {
  try {
    const drivers = await catalog.fetch('drivers')
    const match = (drivers || []).find((d) => String(d.user_id) === String(auth.user?.id))
    myDriverId.value = match?.id ?? null
  } catch (_) {
    myDriverId.value = null
  }
}

async function fetchLookups() {
  try {
    const [v, r] = await Promise.all([
      catalog.fetch('vehicles').catch(() => []),
      catalog.fetch('routes').catch(() => []),
    ])
    vehicles.value = v || []
    routes.value = r || []
  } catch (_) {}
}

const fetchTrips = async () => {
  try {
    if (!myDriverId.value) return
    const r = await api.get(`/api/drivers/${myDriverId.value}/trips`)
    trips.value = r.data.data || []
    error.value = null
  } catch (err) {
    error.value = 'Failed to load assigned trips'
    console.error(err)
  } finally {
    loading.value = false
  }
}

async function act(id, action, label) {
  actionMsg.value = null
  try {
    await api.post(`/api/trips/${id}/${action}`)
    actionMsg.value = `Trip #${id} marked ${label}.`
    await fetchTrips()
  } catch (err) {
    error.value = `Failed to mark ${label}`
  }
}
const boarding = (id) => act(id, 'boarding', 'boarding')
const depart = (id) => act(id, 'depart', 'departed')
const complete = (id) => act(id, 'complete', 'completed')

onMounted(async () => {
  loading.value = true
  await resolveMyDriver()
  await Promise.all([fetchLookups(), fetchTrips()])
  poll = setInterval(fetchTrips, 15000)
})
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><div class="page-title">My Trips</div><div class="page-sub">{{ myDriverName }} — your assigned trips</div></div>
      <div class="head-btns">
        <button type="button" class="btn-ghost" @click="fetchTrips">Refresh</button>
      </div>
    </div>

    <div v-if="error" class="error-bar">{{ error }}</div>
    <div v-if="actionMsg" class="ok-bar">{{ actionMsg }}</div>

    <div v-if="myDriverId === null && !loading" class="empty-box">No driver profile is linked to your account yet. Ask the admin to set it up.</div>

    <template v-else>
      <div class="card">
        <div class="card-head"><span class="card-title">🚌</span><strong>Active Trips</strong><span class="pill light">{{ activeTrips.length }}</span></div>
        <div v-if="activeTrips.length === 0" class="empty-box muted">No active trips. Completed and cancelled trips are in History below.</div>
        <div v-else style="overflow:auto">
          <table class="data">
            <thead><tr><th>Trip</th><th>Destination</th><th>Vehicle</th><th>Scheduled</th><th>Actual</th><th>Status</th><th style="text-align:right">Actions</th></tr></thead>
            <tbody>
              <tr v-for="t in activeTrips" :key="t.id">
                <td><strong>#{{ t.id }}</strong></td>
                <td>{{ destOf(t) }}</td>
                <td>{{ vehicleOf(t) }}</td>
                <td class="muted">{{ fmt(t.scheduled_departure) }}</td>
                <td class="muted">{{ fmt(t.actual_departure) }}</td>
                <td><span class="badge" :class="badgeForStatus(t.status)">{{ String(t.status || '').replace('_',' ').replace(/\b\w/g, c => c.toUpperCase()) }}</span></td>
                <td style="text-align:right; white-space:nowrap">
                  <button v-if="String(t.status).toLowerCase() === 'scheduled'" type="button" class="btn-yellow" @click="boarding(t.id)">Boarding</button>
                  <button v-if="String(t.status).toLowerCase() === 'boarding'" type="button" class="btn-ghost" @click="depart(t.id)">Departed</button>
                  <button v-if="String(t.status).toLowerCase() === 'departed'" type="button" class="btn-dark" @click="complete(t.id)">Completed</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card" style="margin-top:.8rem">
        <div class="card-head"><span class="card-title">🕐</span><strong>History</strong><span class="pill light">{{ historyTrips.length }}</span></div>
        <div v-if="historyTrips.length === 0" class="empty-box muted">No completed or cancelled trips yet.</div>
        <div v-else style="overflow:auto">
          <table class="data">
            <thead><tr><th>Trip</th><th>Destination</th><th>Vehicle</th><th>Scheduled</th><th>Actual</th><th>Status</th></tr></thead>
            <tbody>
              <tr v-for="t in historyTrips" :key="t.id">
                <td><strong>#{{ t.id }}</strong></td>
                <td>{{ destOf(t) }}</td>
                <td>{{ vehicleOf(t) }}</td>
                <td class="muted">{{ fmt(t.scheduled_departure) }}</td>
                <td class="muted">{{ fmt(t.actual_departure) }}</td>
                <td><span class="badge" :class="badgeForStatus(t.status)">{{ String(t.status || '').replace('_',' ').replace(/\b\w/g, c => c.toUpperCase()) }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.head-btns { display:flex; gap:.5rem; }
.ok-bar { background:#dcfce7; color:#166534; padding:.8rem 1.1rem; border-radius:9px; margin-bottom:.9rem; }
.pill.light { background:#e2e8f0; color:#334155; }
</style>
