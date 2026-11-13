<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useCatalogStore } from '@/stores/catalog'
import { localDateTime } from '@/datetime'

const auth = useAuthStore()
const catalog = useCatalogStore()
const queue = ref([])
const vehicles = ref([])
const drivers = ref([])
const routes = ref([])
const trips = ref([])
const passengerCounts = ref([])
const tickets = ref([])
const loading = ref(false)
const error = ref(null)
const toast = ref(null)

const showQueueModal = ref(false)
const form = ref({ trip_id: '' })

// Drivers are read-only here: no queueing, no queue actions.
const isDriver = computed(() => auth.role === 'driver')

function showToast(msg) { toast.value = msg; setTimeout(() => { toast.value = null }, 2200) }

const vById = computed(() => Object.fromEntries(vehicles.value.map(v => [v.id, v])))
const dById = computed(() => Object.fromEntries(drivers.value.map(d => [d.id, d])))
const rById = computed(() => Object.fromEntries(routes.value.map(r => [r.id, r])))
const tById = computed(() => Object.fromEntries(trips.value.map(t => [t.id, t])))

const ACTIVE_STATUSES = ['waiting', 'boarding']
const HISTORY_STATUSES = ['departed', 'removed', 'completed', 'cancelled']

const waiting = computed(() => queue.value
  .filter(q => ACTIVE_STATUSES.includes(String(q.status||'').toLowerCase()))
  .sort((a,b) => (a.queue_position??999)-(b.queue_position??999)))
const history = computed(() => queue.value
  .filter(q => HISTORY_STATUSES.includes(String(q.status||'').toLowerCase()))
  .sort((a,b) => String(b.departed_at||b.queued_at||'').localeCompare(String(a.departed_at||a.queued_at||'')))
  .slice(0,10))

// Trip-only queue: only scheduled trips not already in the active queue
// can be added. Van/Driver/Route/Departure all come from the trip.
const queueableTrips = computed(() => {
  const activeTripIds = new Set(waiting.value.map(q => String(q.trip_id)).filter(Boolean))
  return trips.value
    .filter(t => String(t.status||'').toLowerCase() === 'scheduled' && !activeTripIds.has(String(t.id)))
    .sort((a,b) => String(a.scheduled_departure||'').localeCompare(String(b.scheduled_departure||'')))
})
const selectedTrip = computed(() => trips.value.find(t => String(t.id) === String(form.value.trip_id)) || null)
function tripOptionLabel(t) {
  const dest = rById.value[t.route_id]?.destination || `Route #${t.route_id}`
  const plate = vById.value[t.vehicle_id]?.plate_number || `Van #${t.vehicle_id}`
  const drv = dById.value[t.driver_id]?.full_name || `Driver #${t.driver_id}`
  const when = t.scheduled_departure ? new Date(String(t.scheduled_departure).replace(' ','T')).toLocaleString('en-US',{ month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) : `Trip #${t.id}`
  return `${when} — ${dest} (${plate} · ${drv})`
}

function plate(q) { return vById.value[q.vehicle_id]?.plate_number || `#${q.vehicle_id}` }
function driverName(q) { return dById.value[q.driver_id]?.full_name || `#${q.driver_id}` }
function dest(q) { return rById.value[q.route_id]?.destination || `Route #${q.route_id}` }
function ride(q) { const m = rById.value[q.route_id]?.estimated_minutes; return m ? `${m} min ride` : '—' }
function departureTime(q) {
  const t = tById.value[q.trip_id]
  if (t?.scheduled_departure) return t.scheduled_departure
  return q.queued_at
}
function fmtTime(v) {
  if (!v) return '—'
  const d = new Date(String(v).replace(' ','T')); if (isNaN(d)) return v
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
function overdueText(q) {
  const dep = departureTime(q)
  if (!dep) return ''
  const diffMin = Math.floor((Date.now() - new Date(String(dep).replace(' ','T')).getTime())/60000)
  if (diffMin > 0) return `${diffMin} min overdue`
  if (diffMin < 0) return `in ${Math.abs(diffMin)} min`
  return 'Now'
}
function seatsInfo(q) {
  // Boarded = scanned/boarded tickets for the linked trip. Scanning a QR
  // auto-increments this. Cancelled tickets are NEVER counted (seat restored).
  // Waiting is intentionally not shown (removed). Completed-trip counts are
  // ignored so seats reset for the next trip.
  const cap = Number(vById.value[q.vehicle_id]?.capacity) || 0
  const trip = q.trip_id ? tById.value[q.trip_id] : null
  const tripStatus = String(trip?.status || '').toLowerCase()
  const tripFinished = ['completed', 'cancelled', 'departed'].includes(tripStatus)
  let boarded = 0
  if (q.trip_id && !tripFinished) {
    const tk = tickets.value.filter(t => {
      if (String(t.trip_id) !== String(q.trip_id)) return false
      if (String(t.status||'').toLowerCase() === 'cancelled') return false
      return String(t.status||'').toLowerCase() === 'boarded' || String(t.status||'').toLowerCase() === 'scanned' || !!t.scanned_at
    })
    if (tickets.value.some(t => String(t.trip_id) === String(q.trip_id))) {
      boarded = tk.length
    } else {
      // No ticket rows yet: fall back to latest passenger_counts (legacy).
      const pc = passengerCounts.value.filter(c => String(c.trip_id) === String(q.trip_id)).sort((a,b) => String(b.recorded_at||'').localeCompare(String(a.recorded_at||'')))[0] || null
      boarded = pc ? Number(pc.passengers_boarded)||0 : 0
    }
  }
  const free = Math.max(cap - boarded, 0)
  return { free, cap, boarded }
}
function badgeFor(q) {
  // Queue status wins for active items so Boarding stays visible in Waiting.
  const qs = String(q.status || '').toLowerCase()
  if (qs === 'boarding') return 'badge-yellow'
  if (qs === 'waiting') return 'badge-gray'
  const t = tById.value[q.trip_id]
  const s = String(t?.status || '').toLowerCase()
  if (s === 'scheduled') return 'badge-gray'
  if (s === 'boarding') return 'badge-yellow'
  if (s === 'departed') return 'badge-blue'
  return 'badge-gray'
}
function statusLabel(q) {
  const t = tById.value[q.trip_id]
  return String(t?.status || q.status || '').toLowerCase()
}

async function load({ force = false } = {}) {
  loading.value = true; error.value = null
  try {
    const [q, v, d, r, t, pc, tk] = await Promise.all([
      catalog.fetch('dispatchQueue', { force }).catch(() => []),
      catalog.fetch('vehicles', { force }).catch(() => []),
      catalog.fetch('drivers', { force }).catch(() => []),
      catalog.fetch('routes', { force }).catch(() => []),
      catalog.fetch('trips', { force }).catch(() => []),
      catalog.fetch('passengerCounts', { force }).catch(() => []),
      catalog.fetch('tickets', { force }).catch(() => []),
    ])
    queue.value = q || []
    vehicles.value = v || []
    drivers.value = d || []
    routes.value = r || []
    trips.value = t || []
    passengerCounts.value = pc || []
    tickets.value = tk || []
  } catch (e) { error.value = e?.response?.data?.error || 'Failed to load dispatch queue' }
  finally { loading.value = false }
}

function patchLocalQueue(id, patch) {
  const i = queue.value.findIndex(q => String(q.id) === String(id))
  if (i >= 0) queue.value[i] = { ...queue.value[i], ...patch }
  // Keep catalog cache in sync so next nav doesn't flash stale.
  const entry = catalog.cache?.dispatchQueue
  if (entry && Array.isArray(entry.data)) {
    const j = entry.data.findIndex(q => String(q.id) === String(id))
    if (j >= 0) entry.data[j] = { ...entry.data[j], ...patch }
    entry.at = Date.now()
  }
}
function patchLocalTrip(id, patch) {
  if (!id) return
  const i = trips.value.findIndex(t => String(t.id) === String(id))
  if (i >= 0) trips.value[i] = { ...trips.value[i], ...patch }
  const entry = catalog.cache?.trips
  if (entry && Array.isArray(entry.data)) {
    const j = entry.data.findIndex(t => String(t.id) === String(id))
    if (j >= 0) entry.data[j] = { ...entry.data[j], ...patch }
    entry.at = Date.now()
  }
}
function insertLocalQueue(row) {
  if (!row?.id) return
  queue.value = [...queue.value.filter(q => String(q.id) !== String(row.id)), row]
  const entry = catalog.cache?.dispatchQueue
  if (entry && Array.isArray(entry.data)) {
    entry.data = [...entry.data.filter(q => String(q.id) !== String(row.id)), row]
    entry.at = Date.now()
  }
}

async function moveUp(item) {
  const idx = waiting.value.findIndex(q => String(q.id) === String(item.id))
  if (idx <= 0) return
  const prev = waiting.value[idx-1]
  // Optimistic swap - instant on first click.
  patchLocalQueue(item.id, { queue_position: prev.queue_position })
  patchLocalQueue(prev.id, { queue_position: item.queue_position })
  try {
    await Promise.all([
      api.put(`/api/dispatch-queue/${item.id}`, { queue_position: prev.queue_position }),
      api.put(`/api/dispatch-queue/${prev.id}`, { queue_position: item.queue_position }),
    ])
    showToast('Queue updated')
  } catch (e) { error.value = e?.response?.data?.error || 'Move failed' }
}

async function startBoarding(item) {
  // Optimistic: status becomes Boarding immediately, stays in Waiting.
  patchLocalQueue(item.id, { status: 'boarding' })
  if (item.trip_id) patchLocalTrip(item.trip_id, { status: 'boarding' })
  try {
    const res = await api.put(`/api/dispatch-queue/${item.id}`, { status: 'boarding' })
    if (res.data?.data) patchLocalQueue(item.id, res.data.data)
    if (item.trip_id) { try { await api.put(`/api/trips/${item.trip_id}`, { status: 'boarding' }) } catch {} }
    showToast('Boarding started')
  } catch (e) { error.value = e?.response?.data?.error || 'Start boarding failed' }
}

async function releaseVan(item) {
  const now = localDateTime()
  // Optimistic: move to History immediately.
  patchLocalQueue(item.id, { status: 'departed', departed_at: now })
  if (item.trip_id) patchLocalTrip(item.trip_id, { status: 'departed', actual_departure: now })
  try {
    const res = await api.put(`/api/dispatch-queue/${item.id}`, { status: 'departed', departed_at: now })
    if (res.data?.data) patchLocalQueue(item.id, res.data.data)
    if (item.trip_id) {
      try { await api.post(`/api/trips/${item.trip_id}/depart`) } catch { try { await api.put(`/api/trips/${item.trip_id}`, { status: 'departed', actual_departure: now }) } catch {} }
    }
    showToast('Van released')
  } catch (e) { error.value = e?.response?.data?.error || 'Release failed' }
}

async function removeEntry(item) {
  if (!confirm(`Remove ${plate(item)} from queue? It will move to History as Deleted and can no longer board.`)) return
  // Soft-delete: keep the row, just change status to 'removed' (displayed as
  // Deleted in History). Optimistically move it to History immediately.
  patchLocalQueue(item.id, { status: 'removed' })
  try {
    const res = await api.put(`/api/dispatch-queue/${item.id}`, { status: 'removed' })
    if (res.data?.data) patchLocalQueue(item.id, res.data.data)
    showToast('Van deleted')
  } catch (e) { error.value = e?.response?.data?.error || 'Remove failed' }
}

function openQueueModal() {
  // Trip-only: van/driver/route/departure all come from the chosen trip.
  form.value = { trip_id: '' }
  showQueueModal.value = true
}

async function addQueue() {
  try {
    const trip = selectedTrip.value
    if (!trip) { error.value = 'Please select a scheduled trip to queue.'; return }
    const res = await api.post('/api/dispatch-queue', {
      vehicle_id: trip.vehicle_id,
      driver_id: trip.driver_id,
      route_id: trip.route_id,
      trip_id: trip.id,
      status: 'waiting',
    })
    showQueueModal.value = false
    form.value = { trip_id: '' }
    showToast('Queue updated')
    // Instant: append the new row locally, no full reload.
    if (res.data?.data) insertLocalQueue(res.data.data)
  } catch (e) { error.value = e?.response?.data?.error || 'Failed to queue van' }
}

onMounted(() => load())
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><div class="page-title">Dispatch Queue</div><div class="page-sub">Order in which vans are released from the terminal</div></div>
      <button v-if="!isDriver" type="button" class="btn-yellow" @click="openQueueModal">+ Queue a Van</button>
    </div>
    <div v-if="error" class="error-bar">{{ error }}</div>
    <div v-if="loading" class="empty-box">Loading dispatch queue…</div>

    <template v-else>
      <div class="card" style="margin-bottom:1rem">
        <div class="card-head"><span class="card-title"><span>☰</span>Waiting Vans</span><span class="pill">{{ waiting.length }} in queue</span></div>
        <div v-if="waiting.length === 0" class="empty-box muted">No vans waiting.</div>
        <div v-else style="overflow:auto"><table class="data">
            <thead><tr><th>#</th><th>Van / Driver</th><th>Route</th><th>Departure</th><th>Seats</th><th>Status</th><th style="text-align:right">Actions</th></tr></thead>
            <tbody>
              <tr v-for="(q, idx) in waiting" :key="q.id">
                <td><span class="qnum">{{ idx + 1 }}</span></td>
                <td><strong>{{ plate(q) }}</strong><div class="muted">{{ driverName(q) }}</div></td>
                <td><strong>{{ dest(q) }}</strong><div class="muted">{{ ride(q) }}</div></td>
                <td><strong>{{ fmtTime(departureTime(q)) }}</strong><div class="muted" :style="{color: overdueText(q).includes('overdue') ? '#dc2626' : ''}">{{ overdueText(q) }}</div></td>
                <td><strong>{{ seatsInfo(q).boarded }}/{{ seatsInfo(q).cap }} boarded</strong><div class="muted">{{ seatsInfo(q).free }} free</div></td>
                <td><span class="badge" :class="badgeFor(q)" style="text-transform:capitalize">{{ statusLabel(q) }}</span></td>
                <td style="text-align:right; white-space:nowrap">
                  <!-- Drivers see the queue read-only (no actions). -->
                  <template v-if="!isDriver">
                    <button type="button" class="icon-btn" title="Move up" @click="moveUp(q)">↑</button>
                    <button v-if="String(q.status||'').toLowerCase() !== 'boarding'" type="button" class="icon-btn yellow" title="Start boarding" @click="startBoarding(q)">🧑✓</button>
                    <button type="button" class="icon-btn green" title="Release van" @click="releaseVan(q)">⇥</button>
                    <button type="button" class="icon-btn red" title="Remove" @click="removeEntry(q)">✕</button>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><span class="card-title"><span>🕐</span>Recent Dispatch History</span></div>
        <div v-if="history.length === 0" class="empty-box muted">No dispatch history yet.</div>
        <div v-else style="overflow:auto"><table class="data">
            <thead><tr><th>Van</th><th>Destination</th><th>Driver</th><th>Queued</th><th>Departed</th><th>Result</th></tr></thead>
            <tbody>
              <tr v-for="q in history" :key="q.id">
                <td><strong>{{ plate(q) }}</strong></td>
                <td>{{ dest(q) }}</td>
                <td>{{ driverName(q) }}</td>
                <td>{{ fmtTime(q.queued_at) }}</td>
                <td>{{ q.departed_at ? fmtTime(q.departed_at) : '—' }}</td>
                <td><span class="badge" :class="String(q.status).toLowerCase() === 'removed' ? 'badge-black' : String(q.status).toLowerCase() === 'cancelled' ? 'badge-gray' : 'badge-blue'" style="text-transform:capitalize">{{ String(q.status).toLowerCase() === 'removed' ? 'Deleted' : q.status }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <div v-if="showQueueModal" class="modal-overlay" @click.self="showQueueModal = false">
      <div class="modal">
        <div class="modal-head">+ Queue a Van <button type="button" class="modal-close" @click="showQueueModal = false">✕</button></div>
        <form @submit.prevent="addQueue">
          <div class="modal-body">
            <div class="field full">
              <label>Select Trip to queue</label>
              <select v-model="form.trip_id" required>
                <option value="">Select a scheduled trip…</option>
                <option v-for="t in queueableTrips" :key="t.id" :value="t.id">Trip #{{ t.id }} — {{ tripOptionLabel(t) }}</option>
              </select>
              <div class="muted" style="margin-top:.3rem">Van, driver, route and departure time are taken automatically from the selected trip.</div>
            </div>
            <div v-if="queueableTrips.length === 0" class="empty-box muted" style="margin-top:.8rem">
              <div>No scheduled trips available to queue.</div>
              <div style="margin-top:.4rem"><a href="javascript:void(0)" @click.prevent="$router.push('/trips')" class="manage">Create a Trip first →</a></div>
            </div>
            <div v-else-if="selectedTrip" class="trip-preview">
              <div><span class="muted">Van</span><strong>{{ vById[selectedTrip.vehicle_id]?.plate_number || `#${selectedTrip.vehicle_id}` }}</strong></div>
              <div><span class="muted">Driver</span><strong>{{ dById[selectedTrip.driver_id]?.full_name || `#${selectedTrip.driver_id}` }}</strong></div>
              <div><span class="muted">Route</span><strong>{{ rById[selectedTrip.route_id]?.destination || `Route #${selectedTrip.route_id}` }}</strong></div>
              <div><span class="muted">Departure</span><strong>{{ fmtTime(selectedTrip.scheduled_departure) }}<small class="muted"> · {{ overdueText({ trip_id: selectedTrip.id, queued_at: selectedTrip.scheduled_departure }) }}</small></strong></div>
            </div>
          </div>
          <div class="modal-foot"><button type="button" class="btn-ghost" @click="showQueueModal = false">Cancel</button><button type="submit" class="btn-yellow" :disabled="queueableTrips.length === 0">Add to queue</button></div>
        </form>
      </div>
    </div>

    <div class="toast-wrap"><div v-if="toast" class="toast">{{ toast }}</div></div>
  </div>
</template>

<style scoped>
.qnum { width: 30px; height: 30px; border-radius: 50%; background: #fbbf24; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; }
.icon-btn { margin-left: .25rem; }
.trip-preview { margin-top: 1rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: .8rem 1rem; display: grid; grid-template-columns: 1fr 1fr; gap: .6rem .9rem; }
.trip-preview div { display: flex; flex-direction: column; gap: .15rem; }
.trip-preview .muted { font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; }
.manage { color: #2563eb; font-size: .9rem; font-weight: 600; text-decoration: none; }
</style>
