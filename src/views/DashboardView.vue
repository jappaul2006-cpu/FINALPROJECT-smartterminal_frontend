<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '@/api'
import { useCatalogStore } from '@/stores/catalog'
import { useAuthStore } from '@/stores/auth'
import { localDate } from '@/datetime'

const catalog = useCatalogStore()
const auth = useAuthStore()
const isDriver = computed(() => auth.role === 'driver')

const vehicles = ref([])
const drivers = ref([])
const trips = ref([])
const queue = ref([])
const overrides = ref([])
const adherence = ref(null)
const passengerCounts = ref([])
const loading = ref(true)
const error = ref(null)

function todayStr() { return localDate() }
function isToday(ds) { return String(ds||'').startsWith(todayStr()) }
function fmtTime(v) {
  if (!v) return '—'
  const d = new Date(String(v).replace(' ', 'T'))
  if (isNaN(d)) return v
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
function fmtDateShort(v) {
  if (!v) return '—'
  const d = new Date(String(v).replace(' ', 'T'))
  if (isNaN(d)) return v
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
function timeAgo(v) {
  if (!v) return '—'
  const s = Math.floor((Date.now() - new Date(String(v).replace(' ','T')).getTime())/1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s/60); if (m < 60) return `${m} min ago`
  const h = Math.floor(m/60); if (h < 24) return `${h} hour${h>1?'s':''} ago`
  return `${Math.floor(h/24)} days ago`
}

const vehiclesReady = computed(() => vehicles.value.filter(v => ['available','queued'].includes(String(v.status||'').toLowerCase())).length)
const activeDrivers = computed(() => drivers.value.filter(d => String(d.status||'').toLowerCase() === 'active').length)
const tripsToday = computed(() => trips.value.filter(t => isToday(t.scheduled_departure)))
const passengersToday = computed(() => {
  const rows = passengerCounts.value.filter(c => isToday(c.recorded_at))
  if (rows.length) return rows.reduce((s,c) => s + (Number(c.passengers_boarded)||0), 0)
  // fallback: count tickets scanned? use 0
  return 0
})
const adherencePct = computed(() => adherence.value?.summary?.adherence_percent ?? null)

const waitingQueue = computed(() => {
  return queue.value
    .filter(q => String(q.status||'').toLowerCase() === 'waiting')
    .sort((a,b) => (a.queue_position??999)-(b.queue_position??999))
})

const vById = computed(() => Object.fromEntries(vehicles.value.map(v => [v.id, v])))
const dById = computed(() => Object.fromEntries(drivers.value.map(d => [d.id, d])))
const routeName = computed(() => '')

const routes = ref([])
const rById = computed(() => Object.fromEntries(routes.value.map(r => [r.id, r])))

function qRoute(q) { return rById.value[q.route_id] || {} }
function qPlate(q) { return vById.value[q.vehicle_id]?.plate_number || `#${q.vehicle_id}` }
function qDriverName(q) { return dById.value[q.driver_id]?.full_name || `#${q.driver_id}` }

const recentOverrides = computed(() => [...overrides.value].sort((a,b) => String(b.created_at||b.id).localeCompare(String(a.created_at||a.id))).slice(0,6))
function overrideDest(o) {
  const t = trips.value.find(t => String(t.id) === String(o.trip_id))
  if (!t) return `Trip #${o.trip_id}`
  return rById.value[t.route_id]?.destination || `Trip #${o.trip_id}`
}
function overrideBy(o) {
  // overridden_by is users.id; try to resolve via trips created_by? fallback to user lookup not loaded
  return o.overridden_by ? `User #${o.overridden_by}` : '—'
}

function tripRow(t) {
  return {
    route: rById.value[t.route_id]?.destination || `Route #${t.route_id}`,
    plate: vById.value[t.vehicle_id]?.plate_number || `#${t.vehicle_id}`,
    driver: dById.value[t.driver_id]?.full_name || `#${t.driver_id}`,
  }
}

const todayLabel = computed(() => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))

async function load() {
  // Show cached data instantly on repeat visits; only the first
  // visit (or after TTL expiry with no cache) waits on the network.
  loading.value = true; error.value = null
  try {
    const [v, d, t, q, o, a, pc, r] = await Promise.all([
      catalog.fetch('vehicles').catch(() => []),
      catalog.fetch('drivers').catch(() => []),
      catalog.fetch('trips').catch(() => []),
      catalog.fetch('dispatchQueue').catch(() => []),
      catalog.fetch('scheduleOverrides').catch(() => []),
      catalog.fetch('adherence').catch(() => null),
      catalog.fetch('passengerCounts').catch(() => []),
      catalog.fetch('routes').catch(() => []),
    ])
    vehicles.value = v || []
    drivers.value = d || []
    trips.value = t || []
    queue.value = q || []
    overrides.value = o || []
    adherence.value = a || null
    passengerCounts.value = pc || []
    routes.value = r || []
  } catch (e) { error.value = e?.response?.data?.error || 'Failed to load dashboard' }
  finally { loading.value = false }
}
onMounted(load)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <div class="page-title">Terminal Dashboard</div>
        <div class="page-sub">Calapan City Terminal · {{ todayLabel }}</div>
      </div>
      <div class="head-actions" v-if="!isDriver">
        <a class="btn-yellow" href="/dispatch-queue" @click.prevent="$router.push('/dispatch-queue')">+ Queue a Van</a>
        <a class="btn-ghost" href="/passenger-display" @click.prevent="$router.push('/passenger-display')">▭ Passenger Screen</a>
      </div>
    </div>

    <div v-if="error" class="error-bar">{{ error }}</div>
    <div v-if="loading" class="empty-box">Loading dashboard…</div>

    <template v-else>
      <div class="info-bar">🔔 <strong>Push notifications (FCM) are off.</strong> Alerts are still stored and shown in-app. Paste your Firebase service-account values into <code>.env</code> and set <code>FCM_ENABLED=1</code> to enable delivery.</div>

      <div class="stat-grid">
        <div class="card stat-card">
          <div>
            <div class="stat-label">VANS READY</div>
            <div class="stat-value">{{ vehiclesReady }}</div>
            <div class="muted">{{ vehicles.length }} total fleet</div>
          </div><span class="stat-ico yellow">🚌</span>
        </div>
        <div class="card stat-card">
          <div>
            <div class="stat-label">ACTIVE DRIVERS</div>
            <div class="stat-value">{{ activeDrivers }}</div>
            <div class="muted">not inactive</div>
          </div><span class="stat-ico dark">👥</span>
        </div>
        <div class="card stat-card">
          <div>
            <div class="stat-label">TRIPS TODAY</div>
            <div class="stat-value">{{ tripsToday.length }}</div>
            <div class="muted">{{ new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }}</div>
          </div><span class="stat-ico dark">📅</span>
        </div>
        <div class="card stat-card">
          <div>
            <div class="stat-label">PASSENGERS TODAY</div>
            <div class="stat-value">{{ passengersToday }}</div>
            <div class="muted">boarded so far</div>
          </div><span class="stat-ico dark">👥</span>
        </div>
        <div class="card stat-card">
          <div>
            <div class="stat-label">SCHEDULE ADHERENCE</div>
            <div class="stat-value">{{ adherencePct ?? '—' }}{{ adherencePct != null ? '%' : '' }}</div>
            <div class="muted">departures within 5 min</div>
          </div><span class="stat-ico dark">◐</span>
        </div>
      </div>

      <div class="two-col">
        <div class="card">
          <div class="card-head"><span class="card-title"><span>☰</span>Live Dispatch Queue</span><span class="pill">{{ waitingQueue.length }} waiting</span></div>
          <div v-if="waitingQueue.length === 0" class="empty-box muted">No vans waiting.</div>
          <div v-for="q in waitingQueue.slice(0,5)" :key="q.id" class="queue-row">
            <span class="queue-num">{{ q.queue_position }}</span>
            <div class="queue-main">
              <strong>{{ qRoute(q).destination || `Route #${q.route_id}` }}</strong>
              <div class="muted">{{ qPlate(q) }} · {{ qDriverName(q) }}</div>
            </div>
            <div class="queue-right"><span class="badge badge-gray" style="text-transform:capitalize">{{ q.status }}</span><div class="muted" style="margin-top:.3rem">{{ fmtTime(q.queued_at) }}</div></div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><span class="card-title"><span>▣</span>Today's Trips</span><a v-if="!isDriver" href="#" @click.prevent="$router.push('/trips')" class="manage">Manage</a></div>
          <div v-if="tripsToday.length === 0" class="empty-box"><div style="font-size:2rem">🗓</div><div class="muted">No trips scheduled today.</div></div>
          <div v-else v-for="t in tripsToday.slice(0,6)" :key="t.id" class="trip-row">
            <div><strong>{{ tripRow(t).route }}</strong><div class="muted">{{ tripRow(t).plate }} · {{ fmtTime(t.scheduled_departure) }}</div></div>
            <span class="badge badge-gray" style="text-transform:capitalize">{{ t.status }}</span>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:1rem">
        <div class="card-head"><span class="card-title"><span>✎</span>Recent Schedule Overrides</span><span class="pill light">Audit trail</span></div>
        <div v-if="recentOverrides.length === 0" class="empty-box muted">No schedule overrides yet.</div>
        <div v-else style="overflow:auto">
          <table class="data">
            <thead><tr><th>Trip</th><th>From</th><th>To</th><th>Reason</th><th>By</th><th>When</th></tr></thead>
            <tbody>
              <tr v-for="o in recentOverrides" :key="o.id">
                <td><strong>{{ overrideDest(o) }}</strong></td>
                <td>{{ fmtDateShort(o.old_departure) }}</td>
                <td><strong>{{ fmtDateShort(o.new_departure) }}</strong></td>
                <td>{{ o.reason || '—' }}</td>
                <td>{{ overrideBy(o) }}</td>
                <td class="muted">{{ timeAgo(o.created_at) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.head-actions { display: flex; gap: .5rem; }
.head-actions a { text-decoration: none; }
.stat-grid { display: grid; grid-template-columns: repeat(5,1fr); gap: .8rem; margin-bottom: .8rem; }
.stat-card { display: flex; justify-content: space-between; align-items: flex-start; padding: .9rem 1rem; }
.stat-label { font-size: .7rem; font-weight: 700; color: #64748b; letter-spacing: .05em; }
.stat-value { font-size: 1.7rem; font-weight: 800; color: #0f172a; line-height: 1.2; }
.stat-ico { width: 38px; height: 38px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; }
.stat-ico.yellow { background: #fbbf24; }
.stat-ico.dark { background: #0f2b4c; color: #fff; }
.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: .8rem; }
.queue-row, .trip-row { display: flex; align-items: center; gap: .8rem; padding: .7rem 1rem; border-bottom: 1px solid #eef2f7; }
.queue-row:last-child, .trip-row:last-child { border-bottom: none; }
.queue-num { width: 32px; height: 32px; border-radius: 50%; background: #fbbf24; font-weight: 800; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.queue-main { flex: 1; }
.queue-right { text-align: right; }
.manage { color: #2563eb; font-size: .85rem; font-weight: 600; text-decoration: none; }
.pill.light { background: #e2e8f0; color: #475569; }
@media (max-width: 900px) { .stat-grid { grid-template-columns: repeat(2,1fr); } .two-col { grid-template-columns: 1fr; } }
</style>
