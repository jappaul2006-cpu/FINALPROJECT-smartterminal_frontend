<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '@/api'
import { useCatalogStore } from '@/stores/catalog'
import { useAuthStore } from '@/stores/auth'
import { downloadReportPdf } from '@/reportsPdf'
import { localDate } from '@/datetime'

const catalog = useCatalogStore()
const auth = useAuthStore()
const isAdmin = computed(() => auth.role === 'admin')

const history = ref([])
const adherence = ref(null)
const volume = ref([])
const trips = ref([])
const routes = ref([])
const tickets = ref([])
const overrides = ref([])
const loading = ref(true)
const error = ref(null)
const fromDate = ref(localDate(new Date(Date.now() - 29*86400e3)))
const toDate = ref(localDate())

const inRange = (v) => {
  if (!v) return false
  const d = String(v).slice(0,10)
  return d >= fromDate.value && d <= toDate.value
}

const filteredHistory = computed(() => history.value.filter(t => inRange(t.scheduled_departure)))
const summary = computed(() => {
  const h = filteredHistory.value
  const passengers = h.length // placeholder until override by tickets below
  const passCount = tickets.value.filter(t => inRange(t.created_at || t.scanned_at || '')).length || passengers
  // better: passengers carried = non-cancelled tickets in range
  const isCancelledTk = (t) => String(t.status||'').toLowerCase() === 'cancelled'
  const tkInRange = tickets.value.filter(t => !isCancelledTk(t) && inRange(t.created_at || ''))
  // On-time % from adherence rows in range
  const rows = (adherence.value?.rows || []).filter(r => inRange(r.scheduled))
  const withActual = rows.length
  const onTime = rows.filter(r => r.delay_minutes >= -5 && r.delay_minutes <= 15).length
  const pct = withActual ? Math.round(onTime/withActual*100) : (adherence.value?.summary?.adherence_percent ?? 0)
  const delays = rows.map(r => r.delay_minutes).filter(x => x != null)
  const avgDelay = delays.length ? Math.round(delays.reduce((a,b)=>a+b,0)/delays.length) : 0
  const manual = overrides.value.filter(o => inRange(o.created_at || o.new_departure || '')).length
  return { trips: h.length, passengers: tkInRange.length || 0, onTimePct: pct, avgDelay, manual }
})

const dailyVolume = computed(() => volume.value.filter(v => inRange(v.date)))
const destData = computed(() => {
  // Count non-cancelled tickets per destination via trip->route
  const map = {}
  tickets.value.forEach(tk => {
    if (String(tk.status||'').toLowerCase() === 'cancelled') return
    const trip = trips.value.find(x => String(x.id)===String(tk.trip_id))
    if (!trip) return
    const dest = routes.value.find(r => String(r.id)===String(trip.route_id))?.destination || 'Unknown'
    map[dest] = (map[dest]||0)+1
  })
  const total = Object.values(map).reduce((a,b)=>a+b,0) || 1
  const colors = ['#0f2b4c','#f59e0b','#3b82f6','#22c55e','#ef4444','#8b5cf6']
  let acc = 0
  return Object.entries(map).sort((a,b)=>b[1]-a[1]).map(([label, val], i) => {
    const pct = val/total
    const seg = { label, val, pct, color: colors[i % colors.length], start: acc }
    acc += pct
    return seg
  })
})
const delayData = computed(() => {
  // average delay per day from adherence rows
  const byDay = {}
  ;(adherence.value?.rows || []).forEach(r => {
    if (!inRange(r.scheduled)) return
    const day = String(r.scheduled||'').slice(0,10)
    if (!day) return
    if (!byDay[day]) byDay[day] = []
    byDay[day].push(r.delay_minutes)
  })
  return Object.entries(byDay).sort().map(([date, arr]) => ({ date, avg: Math.round(arr.reduce((a,b)=>a+b,0)/arr.length) }))
})

const maxVolume = computed(() => Math.max(1, ...dailyVolume.value.map(v => Math.max(v.boarded||0, v.waiting||0))))
const maxDelay = computed(() => Math.max(1, ...delayData.value.map(d => d.avg)))

// Admin-only: actually download a .pdf file with the report contents.
function savePdf() {
  if (!isAdmin.value) return
  downloadReportPdf({
    fromDate: fromDate.value,
    toDate: toDate.value,
    summary: summary.value,
    destData: destData.value,
    dailyVolume: dailyVolume.value,
    tripRows: filteredHistory.value,
  })
}

function donutSegs(){
  // build SVG circle segments using stroke-dasharray
  const C = 2*Math.PI*80
  let offset = 0
  return destData.value.map(s => {
    const len = s.pct * C
    const seg = { ...s, dash: `${len} ${C-len}`, rotate: -90 + (offset*360), offsetPx: -offset*C }
    offset += s.pct
    return seg
  })
}

async function load({ force = false } = {}){
  loading.value = true; error.value = null
  try {
    const [h, a, v, tr, r, tk, ov] = await Promise.all([
      catalog.fetch('tripHistory', { force }).catch(()=>[]),
      catalog.fetch('adherence', { force }).catch(()=>null),
      catalog.fetch('dailyVolume', { force }).catch(()=>[]),
      catalog.fetch('trips', { force }).catch(()=>[]),
      catalog.fetch('routes', { force }).catch(()=>[]),
      catalog.fetch('tickets', { force }).catch(()=>[]),
      catalog.fetch('scheduleOverrides', { force }).catch(()=>[]),
    ])
    history.value = h || []
    adherence.value = a || null
    volume.value = v || []
    trips.value = tr || []
    routes.value = r || []
    tickets.value = tk || []
    overrides.value = ov || []
  } catch (e) { error.value = e?.response?.data?.error || 'Failed to load reports' }
  finally { loading.value = false }
}

function setRange(days){ toDate.value = localDate(); fromDate.value = localDate(new Date(Date.now() - (days-1)*86400e3)); load() }
onMounted(() => load())
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><div class="page-title">Reports</div><div class="page-sub">Trip history, schedule adherence and passenger volume</div></div>
      <!-- Save PDF is admin-only. -->
      <div class="head-btns no-print">
        <template v-if="isAdmin">
          <button type="button" class="btn-dark" @click="savePdf">⬇ Save PDF</button>
        </template>
        <span v-else class="muted">Save PDF is admin-only.</span>
      </div>
    </div>
    <div v-if="error" class="error-bar">{{ error }}</div>

    <div class="filter-row">
      <div class="filter-field"><label>From</label><input v-model="fromDate" type="date" /></div>
      <div class="filter-field"><label>To</label><input v-model="toDate" type="date" /></div>
      <button type="button" class="btn-yellow" @click="load">Apply</button>
      <button type="button" class="btn-ghost" @click="setRange(7)">7 days</button>
      <button type="button" class="btn-ghost" @click="setRange(30)">30 days</button>
    </div>

    <div v-if="loading" class="empty-box">Loading reports…</div>
    <template v-else>
      <div class="stat-grid5">
        <div class="card stat-card"><div><div class="stat-label">TRIPS IN RANGE</div><div class="stat-value">{{ summary.trips }}</div></div><span class="stat-ico dark">📅</span></div>
        <div class="card stat-card"><div><div class="stat-label">PASSENGERS CARRIED</div><div class="stat-value">{{ summary.passengers }}</div></div><span class="stat-ico dark">👥</span></div>
        <div class="card stat-card"><div><div class="stat-label">ON-TIME DEPARTURES</div><div class="stat-value">{{ summary.onTimePct }}%</div></div><span class="stat-ico dark">◐</span></div>
        <div class="card stat-card"><div><div class="stat-label">AVERAGE DELAY</div><div class="stat-value">{{ summary.avgDelay }} min</div></div><span class="stat-ico dark">◐</span></div>
        <div class="card stat-card"><div><div class="stat-label">MANUAL OVERRIDES</div><div class="stat-value">{{ summary.manual }}</div></div><span class="stat-ico dark">✎</span></div>
      </div>

      <div class="reports-2col">
        <div class="card">
          <div class="card-head"><span class="card-title">📊</span><strong>Daily passenger volume</strong></div>
          <div v-if="dailyVolume.length===0" class="empty-box muted">No passenger data in range.</div>
          <div v-else class="bar-chart">
            <div class="bar-day" v-for="d in dailyVolume" :key="d.date">
              <div class="bars">
                <div class="bar dark" :style="{ height: ((d.boarded||0)/maxVolume*120)+'px' }"></div>
                <div class="bar yellow" :style="{ height: ((d.waiting||0)/maxVolume*120)+'px' }"></div>
              </div>
              <div class="muted small">{{ new Date(d.date+'T00:00').toLocaleDateString('en-US',{ month:'short', day:'numeric' }) }}</div>
            </div>
          </div>
          <div class="legend"><span><i class="sq dark"></i>Boarded</span><span><i class="sq yellow"></i>Waiting</span></div>
        </div>

        <div class="card">
          <div class="card-head"><span class="card-title">◐</span><strong>Passengers by destination</strong></div>
          <div v-if="destData.length===0" class="empty-box muted">No ticket data yet.</div>
          <div v-else class="donut-wrap">
            <svg viewBox="0 0 200 200" class="donut">
              <circle cx="100" cy="100" r="80" fill="none" stroke="#e2e8f0" stroke-width="34" />
              <circle v-for="s in donutSegs()" :key="s.label" cx="100" cy="100" r="80" fill="none" :stroke="s.color" stroke-width="34" :stroke-dasharray="s.dash" :stroke-dashoffset="s.offsetPx" transform="rotate(-90 100 100)" />
            </svg>
            <div class="legend-col">
              <div v-for="s in destData" :key="s.label"><i class="sq" :style="{background:s.color}"></i>{{ s.label }} ({{ Math.round(s.pct*100) }}%)</div>
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:.8rem">
        <div class="card-head"><span class="card-title">∿</span><strong>Average departure delay (minutes)</strong></div>
        <div v-if="delayData.length===0" class="empty-box muted">No delay data in range.</div>
        <div v-else class="line-chart">
          <svg viewBox="0 0 720 180" style="width:100%;height:180px">
            <line v-for="i in 6" :key="i" :x1="40" :x2="700" :y1="20 + (i-1)*28" :y2="20 + (i-1)*28" stroke="#e2e8f0" />
            <polyline v-if="delayData.length>1" :points="delayData.map((d,i) => `${40 + i*(660/Math.max(delayData.length-1,1))},${160 - (d.avg/maxDelay*130)}`).join(' ')" fill="none" stroke="#f59e0b" stroke-width="3" />
            <circle v-for="(d,i) in delayData" :key="d.date" :cx="40 + i*(660/Math.max(delayData.length-1,1))" :cy="160 - (d.avg/maxDelay*130)" r="4" fill="#f59e0b" />
          </svg>
          <div class="legend-center"><i class="sq yellow"></i>Average delay (min)</div>
        </div>
      </div>

      <div class="card" style="margin-top:.8rem">
        <div class="card-head"><span class="card-title">🕐</span><strong>Trip history</strong></div>
        <div v-if="filteredHistory.length===0" class="empty-box muted">No trip history in range.</div>
        <div v-else style="overflow:auto">
          <table class="data">
            <thead><tr><th>Trip</th><th>Status</th><th>Route</th><th>Plate</th><th>Driver</th><th>Scheduled</th><th>Actual</th><th>Delay</th></tr></thead>
            <tbody>
              <tr v-for="t in filteredHistory" :key="t.trip_id">
                <td>#{{ t.trip_id }}</td>
                <td><span class="badge badge-blue" style="text-transform:capitalize">{{ t.status }}</span></td>
                <td>{{ t.origin }} → {{ t.destination }}</td>
                <td>{{ t.plate_number || '—' }}</td>
                <td>{{ t.driver_name || '—' }}</td>
                <td>{{ t.scheduled_departure ? new Date(String(t.scheduled_departure).replace(' ','T')).toLocaleString('en-US',{ month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) : '—' }}</td>
                <td>{{ t.actual_departure ? new Date(String(t.actual_departure).replace(' ','T')).toLocaleString('en-US',{ month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) : '—' }}</td>
                <td>{{ t.delay_minutes ?? '—' }}{{ t.delay_minutes != null ? ' min' : '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.filter-row { display:flex; gap:.6rem; align-items:flex-end; margin-bottom:.8rem; flex-wrap:wrap; }
.filter-field label { font-size:.75rem; font-weight:600; color:#475569; display:block; margin-bottom:.3rem; }
.filter-field input { padding:.5rem .7rem; border:1px solid #cbd5e1; border-radius:8px; background:#fff; font-size:.85rem; }
.stat-grid5 { display:grid; grid-template-columns: repeat(5,1fr); gap:.8rem; margin-bottom:.8rem; }
.stat-card { display:flex; justify-content:space-between; align-items:flex-start; padding:.9rem 1rem; }
.stat-label { font-size:.7rem; font-weight:700; color:#64748b; letter-spacing:.05em; }
.stat-value { font-size:1.5rem; font-weight:800; }
.stat-ico { width:38px; height:38px; border-radius:8px; display:flex; align-items:center; justify-content:center; background:#0f2b4c; color:#fff; }
.reports-2col { display:grid; grid-template-columns: 1.1fr 1fr; gap:.8rem; }
.bar-chart { display:flex; align-items:flex-end; gap:.6rem; padding:1rem; min-height:160px; overflow:auto; }
.bar-day { display:flex; flex-direction:column; align-items:center; gap:.4rem; min-width:52px; }
.bars { display:flex; align-items:flex-end; gap:3px; height:130px; }
.bar { width:20px; border-radius:4px 4px 0 0; min-height:2px; }
.bar.dark { background:#0f2b4c; }
.bar.yellow { background:#f59e0b; }
.small { font-size:.7rem; }
.legend { display:flex; gap:1rem; justify-content:center; padding:.5rem; color:#475569; font-size:.8rem; }
.legend-center { text-align:center; padding:.4rem; color:#475569; font-size:.8rem; }
.sq { display:inline-block; width:12px; height:12px; border-radius:3px; margin-right:.35rem; vertical-align:middle; }
.sq.dark { background:#0f2b4c; } .sq.yellow { background:#f59e0b; }
.donut-wrap { display:flex; gap:1rem; align-items:center; padding:1rem; flex-wrap:wrap; }
.donut { width:200px; height:200px; }
.legend-col { display:flex; flex-direction:column; gap:.4rem; font-size:.83rem; color:#334155; }
@media (max-width: 900px){ .stat-grid5{grid-template-columns:repeat(2,1fr)} .reports-2col{grid-template-columns:1fr} }
@media print {
  .no-print, .filter-row, .no-print * { display:none !important }
  .page { padding: 0 }
}
</style>
