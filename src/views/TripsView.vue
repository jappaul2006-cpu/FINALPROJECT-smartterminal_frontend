<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useCatalogStore } from '@/stores/catalog'
import { localDate, localDateTimeInput } from '@/datetime'

const auth = useAuthStore()
const catalog = useCatalogStore()
const items = ref([])
const vehicles = ref([])
const drivers = ref([])
const routes = ref([])
const passengerCounts = ref([])
const tickets = ref([])
const loading = ref(true)
const error = ref(null)
const toast = ref(null)

const filterDate = ref(localDate())
const filterStatus = ref('')
const showAllDates = ref(false)

const showNewModal = ref(false)
const showEditModal = ref(false)
const showOverrideModal = ref(false)
const newForm = ref({ vehicle_id: '', driver_id: '', route_id: '', scheduled_departure: '', status: 'scheduled' })
const editForm = ref(null)
const overrideForm = ref({ trip_id: '', new_departure: '', reason: '' })

function showToast(m){ toast.value = m; setTimeout(()=>{ toast.value=null }, 2200) }
function fmtDate(v){
  if (!v) return '—'
  const d = new Date(String(v).replace(' ','T')); if (isNaN(d)) return v
  return d.toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' })
}
function inMinutes(v){
  if (!v) return ''
  const diff = Math.round((new Date(String(v).replace(' ','T')).getTime() - Date.now())/60000)
  if (diff > 0) return `in ${diff} minutes`
  if (diff < 0) return `${Math.abs(diff)} min ago`
  return 'Now'
}

const vById = computed(() => Object.fromEntries(vehicles.value.map(v => [v.id, v])))
const dById = computed(() => Object.fromEntries(drivers.value.map(d => [d.id, d])))
const rById = computed(() => Object.fromEntries(routes.value.map(r => [r.id, r])))

function seats(t){
  // Boarded comes from scanned (boarded) tickets when the trip has tickets;
  // old trips without ticket rows fall back to latest passenger_counts.
  // Cancelled tickets are NEVER counted (seat was restored on cancel).
  // Waiting is intentionally not shown (removed per user request).
  const tkBoarded = tickets.value.filter(x => {
    if (String(x.trip_id) !== String(t.id)) return false
    if (String(x.status||'').toLowerCase() === 'cancelled') return false
    return String(x.status||'').toLowerCase() === 'boarded' || String(x.status||'').toLowerCase() === 'scanned' || !!x.scanned_at
  }).length
  const pc = passengerCounts.value.filter(c => String(c.trip_id) === String(t.id)).sort((a,b)=>String(b.recorded_at||'').localeCompare(String(a.recorded_at||'')))[0]
  const hasTickets = tickets.value.some(x => String(x.trip_id) === String(t.id))
  const boarded = hasTickets ? tkBoarded : (pc ? Number(pc.passengers_boarded)||0 : 0)
  return { boarded }
}
function badgeClass(s){
  s = String(s||'').toLowerCase()
  if (s === 'scheduled') return 'badge-gray'
  if (s === 'boarding') return 'badge-yellow'
  if (s === 'departed') return 'badge-blue'
  if (s === 'completed') return 'badge-green'
  if (s === 'cancelled') return 'badge-black'
  return 'badge-gray'
}

const filtered = computed(() => {
  return items.value.filter(t => {
    if (!showAllDates.value && filterDate.value) {
      if (!String(t.scheduled_departure||'').startsWith(filterDate.value)) return false
    }
    if (filterStatus.value && String(t.status).toLowerCase() !== filterStatus.value) return false
    return true
  }).sort((a,b) => String(a.scheduled_departure||'').localeCompare(String(b.scheduled_departure||'')))
})

// For New Trip: vehicles/drivers with a non-completed (scheduled/boarding/
// departed) trip cannot be picked again - they are busy on that trip.
// Maintenance vehicles and On-Trip/Inactive drivers are also blocked.
const busyVehicleIds = computed(() => new Set(items.value.filter(t => ['scheduled','boarding','departed'].includes(String(t.status||'').toLowerCase())).map(t => String(t.vehicle_id))))
const busyDriverIds = computed(() => new Set(items.value.filter(t => ['scheduled','boarding','departed'].includes(String(t.status||'').toLowerCase())).map(t => String(t.driver_id))))
const availableVehicles = computed(() => vehicles.value.filter(v => !busyVehicleIds.value.has(String(v.id)) && String(v.status||'').toLowerCase() !== 'maintenance'))
const availableDrivers = computed(() => drivers.value.filter(d => !busyDriverIds.value.has(String(d.id)) && String(d.status||'').toLowerCase() === 'active'))

async function load({ force = false } = {}){
  loading.value = true; error.value = null
  try {
    const [t, v, d, r, pc, tk] = await Promise.all([
      catalog.fetch('trips', { force }).catch(() => []),
      catalog.fetch('vehicles', { force }).catch(() => []),
      catalog.fetch('drivers', { force }).catch(() => []),
      catalog.fetch('routes', { force }).catch(() => []),
      catalog.fetch('passengerCounts', { force }).catch(() => []),
      catalog.fetch('tickets', { force }).catch(() => []),
    ])
    items.value = t || []
    vehicles.value = v || []
    drivers.value = d || []
    routes.value = r || []
    passengerCounts.value = pc || []
    tickets.value = tk || []
  } catch (e) { error.value = e?.response?.data?.error || 'Failed to load trips' }
  finally { loading.value = false }
}

function patchLocalTrip(id, patch) {
  const i = items.value.findIndex(t => String(t.id) === String(id))
  if (i >= 0) items.value[i] = { ...items.value[i], ...patch }
  const entry = catalog.cache?.trips
  if (entry && Array.isArray(entry.data)) {
    const j = entry.data.findIndex(t => String(t.id) === String(id))
    if (j >= 0) entry.data[j] = { ...entry.data[j], ...patch }
    entry.at = Date.now()
  }
}
function insertLocalTrip(row) {
  if (!row?.id) return
  items.value = [...items.value.filter(t => String(t.id) !== String(row.id)), row]
  const entry = catalog.cache?.trips
  if (entry && Array.isArray(entry.data)) {
    entry.data = [...entry.data.filter(t => String(t.id) !== String(row.id)), row]
    entry.at = Date.now()
  }
}
function toLocalInput(val){
  if (!val) return ''
  const s = String(val).replace(' ','T').slice(0,16)
  return s
}

// Filters are computed (instant) - Apply does not need a network reload.
function applyFilters(){ /* no-op: filtered() reacts immediately */ }

async function openNewTrip() {
  // Refresh busy/maintenance state first so the dropdown never offers
  // a vehicle/driver that became busy in another tab/session.
  try {
    const [v, d, t] = await Promise.all([
      catalog.fetch('vehicles', { force: true }).catch(() => vehicles.value),
      catalog.fetch('drivers', { force: true }).catch(() => drivers.value),
      catalog.fetch('trips', { force: true }).catch(() => items.value),
    ])
    vehicles.value = v || []
    drivers.value = d || []
    items.value = t || []
  } catch {}
  const nowLocal = localDateTimeInput()
  newForm.value = { vehicle_id: '', driver_id: '', route_id: '', scheduled_departure: nowLocal, status: 'scheduled' }
  showNewModal.value = true
}

async function createTrip(){
  try {
    const dt = newForm.value.scheduled_departure ? newForm.value.scheduled_departure.replace('T',' ') + ':00' : ''
    const res = await api.post('/api/trips', {
      vehicle_id: Number(newForm.value.vehicle_id),
      driver_id: Number(newForm.value.driver_id),
      route_id: Number(newForm.value.route_id),
      scheduled_departure: dt,
      status: newForm.value.status,
      created_by: auth.user?.id ?? null,
    })
    showNewModal.value = false
    newForm.value = { vehicle_id:'', driver_id:'', route_id:'', scheduled_departure:'', status:'scheduled' }
    showToast('Trip created')
    if (res.data?.data) insertLocalTrip(res.data.data)
  } catch (e) { error.value = e?.response?.data?.error || 'Failed to create trip' }
}

function openEdit(t){
  editForm.value = {
    id: t.id,
    vehicle_id: t.vehicle_id,
    driver_id: t.driver_id,
    route_id: t.route_id,
    scheduled_departure: toLocalInput(t.scheduled_departure),
    status: t.status,
  }
  showEditModal.value = true
}
async function saveEdit(){
  try {
    const f = editForm.value
    const res = await api.put(`/api/trips/${f.id}`, {
      vehicle_id: Number(f.vehicle_id),
      driver_id: Number(f.driver_id),
      route_id: Number(f.route_id),
      scheduled_departure: String(f.scheduled_departure).replace('T',' ') + ':00',
      status: f.status,
    })
    showEditModal.value = false
    showToast('Trip updated')
    if (res.data?.data) patchLocalTrip(f.id, res.data.data)
    else patchLocalTrip(f.id, { vehicle_id: Number(f.vehicle_id), driver_id: Number(f.driver_id), route_id: Number(f.route_id), scheduled_departure: String(f.scheduled_departure).replace('T',' ') + ':00', status: f.status })
  } catch (e) { error.value = e?.response?.data?.error || 'Update failed' }
}

function openOverride(t){
  overrideForm.value = { trip_id: t.id, new_departure: toLocalInput(t.scheduled_departure), reason: '' }
  showOverrideModal.value = true
}
async function saveOverride(){
  try {
    const f = overrideForm.value
    const newDep = String(f.new_departure).replace('T',' ') + ':00'
    // Optimistic: trip departure updates immediately.
    patchLocalTrip(f.trip_id, { scheduled_departure: newDep })
    await api.post('/api/schedule-overrides', {
      trip_id: Number(f.trip_id),
      new_departure: newDep,
      reason: f.reason,
      overridden_by: auth.user?.id ?? null,
    })
    showOverrideModal.value = false
    showToast('Schedule overridden')
  } catch (e) { error.value = e?.response?.data?.error || 'Override failed' }
}

async function markComplete(t){
  // Optimistic: badge becomes Completed on first click.
  patchLocalTrip(t.id, { status: 'completed' })
  try {
    const res = await api.post(`/api/trips/${t.id}/complete`)
    if (res.data?.data) patchLocalTrip(t.id, res.data.data)
    showToast('Trip completed')
  }
  catch (e) { error.value = e?.response?.data?.error || 'Complete failed' }
}

onMounted(() => load())
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><div class="page-title">Trips</div><div class="page-sub">Schedule, reschedule and track every departure</div></div>
      <button type="button" class="btn-yellow" @click="openNewTrip">+ New Trip</button>
    </div>
    <div v-if="error" class="error-bar">{{ error }}</div>

    <div class="filter-row">
      <div class="filter-field"><label>Date</label><input v-model="filterDate" type="date" /></div>
      <div class="filter-field"><label>Status</label>
        <select v-model="filterStatus">
          <option value="">All statuses</option>
          <option value="scheduled">Scheduled</option>
          <option value="boarding">Boarding</option>
          <option value="departed">Departed</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>
      <button type="button" class="btn-dark" @click="applyFilters">Apply</button>
      <button type="button" class="btn-ghost" @click="showAllDates = !showAllDates">{{ showAllDates ? 'Filtering: all dates' : 'Show all dates' }}</button>
    </div>

    <div v-if="loading" class="empty-box">Loading trips…</div>
    <div v-else class="card">
      <div class="card-head"><span class="card-title"><span>▣</span>Trips</span><span class="pill light">{{ filtered.length }} found</span></div>
      <div v-if="filtered.length === 0" class="empty-box muted">No trips found.</div>
      <div v-else style="overflow:auto">
        <table class="data">
          <thead><tr><th>Departure</th><th>Destination</th><th>Van</th><th>Driver</th><th>Seats</th><th>Status</th><th style="text-align:right">Actions</th></tr></thead>
          <tbody>
            <tr v-for="t in filtered" :key="t.id">
              <td><strong>{{ fmtDate(t.scheduled_departure) }}</strong><div class="muted">{{ inMinutes(t.scheduled_departure) }}</div></td>
              <td><strong>{{ rById[t.route_id]?.destination || `Route #${t.route_id}` }}</strong></td>
              <td>{{ vById[t.vehicle_id]?.plate_number || `#${t.vehicle_id}` }}</td>
              <td>{{ dById[t.driver_id]?.full_name || `#${t.driver_id}` }}</td>
              <td><strong>{{ seats(t).boarded }}</strong> boarded</td>
              <td><span class="badge" :class="badgeClass(t.status)" style="text-transform:capitalize">{{ t.status }}</span></td>
              <td style="text-align:right; white-space:nowrap">
                <button type="button" class="icon-btn" title="Edit" @click="openEdit(t)">✎</button>
                <button type="button" class="icon-btn yellow" title="Override departure" @click="openOverride(t)">◐</button>
                <button type="button" class="icon-btn green" title="Mark as complete" @click="markComplete(t)">✓</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="showNewModal" class="modal-overlay" @click.self="showNewModal = false">
      <div class="modal">
        <div class="modal-head">+ New Trip <button type="button" class="modal-close" @click="showNewModal = false">✕</button></div>
        <form @submit.prevent="createTrip">
          <div class="modal-body">
            <div class="form-grid">
              <div class="field"><label>Vehicle</label><select v-model="newForm.vehicle_id" required><option value="">Select vehicle…</option><option v-for="v in availableVehicles" :key="v.id" :value="v.id">{{ v.plate_number }} — {{ v.model }}</option></select><div v-if="availableVehicles.length === 0" class="muted" style="margin-top:.2rem">No available vehicles — all are busy on an unfinished trip.</div></div>
              <div class="field"><label>Driver</label><select v-model="newForm.driver_id" required><option value="">Select driver…</option><option v-for="d in availableDrivers" :key="d.id" :value="d.id">{{ d.full_name }}</option></select><div v-if="availableDrivers.length === 0" class="muted" style="margin-top:.2rem">No available drivers — all are On Trip or Inactive.</div></div>
              <div class="field"><label>Route</label><select v-model="newForm.route_id" required><option value="">Select route…</option><option v-for="r in routes" :key="r.id" :value="r.id">{{ r.origin }} → {{ r.destination }} (₱{{ r.fare }})</option></select></div>
              <div class="field"><label>Scheduled departure</label><input v-model="newForm.scheduled_departure" type="datetime-local" required /></div>
              <div class="field"><label>Status</label><select v-model="newForm.status"><option value="scheduled">Scheduled</option><option value="boarding">Boarding</option><option value="departed">Departed</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></div>
            </div>
          </div>
          <div class="modal-foot"><button type="button" class="btn-ghost" @click="showNewModal = false">Cancel</button><button type="submit" class="btn-yellow">Create trip</button></div>
        </form>
      </div>
    </div>

    <div v-if="showEditModal && editForm" class="modal-overlay" @click.self="showEditModal = false">
      <div class="modal">
        <div class="modal-head">✎ Edit Trip #{{ editForm.id }} <button type="button" class="modal-close" @click="showEditModal = false">✕</button></div>
        <form @submit.prevent="saveEdit">
          <div class="modal-body">
            <div class="form-grid">
              <div class="field"><label>Vehicle</label><select v-model="editForm.vehicle_id" required><option v-for="v in vehicles" :key="v.id" :value="v.id">{{ v.plate_number }} — {{ v.model }}</option></select></div>
              <div class="field"><label>Driver</label><select v-model="editForm.driver_id" required><option v-for="d in drivers" :key="d.id" :value="d.id">{{ d.full_name }}</option></select></div>
              <div class="field"><label>Route</label><select v-model="editForm.route_id" required><option v-for="r in routes" :key="r.id" :value="r.id">{{ r.destination }}</option></select></div>
              <div class="field"><label>Scheduled departure</label><input v-model="editForm.scheduled_departure" type="datetime-local" required /></div>
              <div class="field"><label>Status</label><select v-model="editForm.status"><option value="scheduled">Scheduled</option><option value="boarding">Boarding</option><option value="departed">Departed</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></div>
            </div>
          </div>
          <div class="modal-foot"><button type="button" class="btn-ghost" @click="showEditModal = false">Cancel</button><button type="submit" class="btn-yellow">Save changes</button></div>
        </form>
      </div>
    </div>

    <div v-if="showOverrideModal" class="modal-overlay" @click.self="showOverrideModal = false">
      <div class="modal">
        <div class="modal-head">◐ Override Departure <button type="button" class="modal-close" @click="showOverrideModal = false">✕</button></div>
        <form @submit.prevent="saveOverride">
          <div class="modal-body">
            <div class="form-grid">
              <div class="field"><label>Trip</label><select v-model="overrideForm.trip_id" required><option v-for="t in items" :key="t.id" :value="t.id">#{{ t.id }} — {{ t.scheduled_departure }} — {{ t.status }}</option></select></div>
              <div class="field"><label>New departure</label><input v-model="overrideForm.new_departure" type="datetime-local" required /></div>
              <div class="field full"><label>Reason</label><input v-model="overrideForm.reason" type="text" placeholder="e.g. Waiting for late passengers from Naujan" /></div>
            </div>
          </div>
          <div class="modal-foot"><button type="button" class="btn-ghost" @click="showOverrideModal = false">Cancel</button><button type="submit" class="btn-yellow">Save override</button></div>
        </form>
      </div>
    </div>

    <div class="toast-wrap"><div v-if="toast" class="toast">{{ toast }}</div></div>
  </div>
</template>

<style scoped>
.filter-row { display: flex; gap: .6rem; align-items: flex-end; margin-bottom: .8rem; flex-wrap: wrap; }
.filter-field label { font-size: .75rem; font-weight: 600; color: #475569; display: block; margin-bottom: .3rem; }
.filter-field input, .filter-field select { padding: .5rem .7rem; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; font-size: .85rem; min-width: 150px; }
.icon-btn { margin-left: .25rem; }
</style>
