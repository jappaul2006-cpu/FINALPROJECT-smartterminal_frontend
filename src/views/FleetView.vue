<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useCatalogStore } from '@/stores/catalog'

const auth = useAuthStore()
const catalog = useCatalogStore()
const vehicles = ref([])
const drivers = ref([])
const routes = ref([])
const trips = ref([])
const loading = ref(true)
const error = ref(null)
const toast = ref(null)

const modal = ref(null) // 'van' | 'driver' | 'route' | 'edit-van' | 'edit-driver'
const vanForm = ref({ plate_number: '', model: '', capacity: 15 })
const editVanForm = ref({ id: '', plate_number: '', model: '', capacity: 15, status: 'available' })
const editDriverForm = ref({ id: '', full_name: '', license_no: '', contact_no: '', status: 'active' })
const driverForm = ref({ full_name: '', license_no: '', contact_no: '', username: '', password: '', email: '' })
const routeForm = ref({ origin: 'Calapan City Terminal', destination: '', estimated_minutes: 45, fare: 0 })

function showToast(m){ toast.value = m; setTimeout(()=>{ toast.value=null }, 2200) }

const totalSeats = computed(() => vehicles.value.reduce((s,v) => s + (Number(v.capacity)||0), 0))
const availableCount = computed(() => vehicles.value.filter(v => String(v.status).toLowerCase() === 'available').length)
const maintenanceCount = computed(() => vehicles.value.filter(v => String(v.status).toLowerCase() === 'maintenance').length)
const driverActiveTrips = computed(() => {
  const map = {}
  trips.value.filter(t => ['scheduled','boarding','departed'].includes(String(t.status).toLowerCase())).forEach(t => { map[t.driver_id] = (map[t.driver_id]||0)+1 })
  return map
})
function badgeForStatus(s){
  s = String(s||'').toLowerCase()
  if (s === 'available' || s === 'active') return 'badge-green'
  if (s === 'on_trip' || s === 'dispatched' || s === 'on trip') return 'badge-blue'
  if (s === 'queued') return 'badge-yellow'
  if (s === 'maintenance' || s === 'inactive') return 'badge-black'
  return 'badge-gray'
}
function statusLabel(s){ return String(s||'').replace('_',' ').replace(/\b\w/g, c => c.toUpperCase()) }

async function load({ force = false } = {}){
  loading.value = true; error.value = null
  try {
    const [v, d, r, t] = await Promise.all([
      catalog.fetch('vehicles', { force }).catch(()=>[]),
      catalog.fetch('drivers', { force }).catch(()=>[]),
      catalog.fetch('routes', { force }).catch(()=>[]),
      catalog.fetch('trips', { force }).catch(()=>[]),
    ])
    vehicles.value = v || []
    drivers.value = d || []
    routes.value = r || []
    trips.value = t || []
  } catch (e) { error.value = e?.response?.data?.error || 'Failed to load fleet' }
  finally { loading.value = false }
}

function patchCatalogList(key, row) {
  const entry = catalog.cache?.[key]
  if (entry && Array.isArray(entry.data)) {
    entry.data = [...entry.data.filter(x => String(x.id) !== String(row.id)), row]
    entry.at = Date.now()
  }
}
function appendLocal(ref, key, row) {
  if (!row?.id) return
  ref.value = [...ref.value.filter(x => String(x.id) !== String(row.id)), row]
  patchCatalogList(key, row)
}

async function addVan(){
  try {
    const res = await api.post('/api/vehicles', { plate_number: vanForm.value.plate_number, model: vanForm.value.model, capacity: Number(vanForm.value.capacity), status: 'available' })
    modal.value = null; vanForm.value = { plate_number:'', model:'', capacity:15 }
    showToast('Van added')
    if (res.data?.data) appendLocal(vehicles, 'vehicles', res.data.data)
  } catch (e) { error.value = e?.response?.data?.error || 'Failed to add van' }
}

async function addDriver(){
  try {
    let userId = null
    const wantsLogin = !!(driverForm.value.username && driverForm.value.password)
    // User accounts are admin-only. A dispatcher adding a driver
    // still succeeds, but without a portal login.
    const skippedLogin = wantsLogin && auth.role !== 'admin'
    if (wantsLogin && auth.role === 'admin') {
      const res = await api.post('/api/users', {
        full_name: driverForm.value.full_name,
        username: driverForm.value.username,
        email: driverForm.value.email || `${driverForm.value.username}@smartterminal.local`,
        password: driverForm.value.password,
        role: 'driver',
        contact_no: driverForm.value.contact_no || null,
      })
      userId = res.data?.data?.id ?? null
    }
    const dres = await api.post('/api/drivers', {
      user_id: userId,
      full_name: driverForm.value.full_name,
      license_no: driverForm.value.license_no || null,
      contact_no: driverForm.value.contact_no || null,
      status: 'active',
    })
    modal.value = null; driverForm.value = { full_name:'', license_no:'', contact_no:'', username:'', password:'', email:'' }
    showToast(skippedLogin ? 'Driver added (login skipped — admin only)' : 'Driver added')
    if (dres.data?.data) appendLocal(drivers, 'drivers', dres.data.data)
  } catch (e) { error.value = e?.response?.data?.error || 'Failed to add driver' }
}

async function addRoute(){
  try {
    const res = await api.post('/api/routes', {
      origin: routeForm.value.origin,
      destination: routeForm.value.destination,
      estimated_minutes: Number(routeForm.value.estimated_minutes) || null,
      fare: Number(routeForm.value.fare) || 0,
      is_active: 1,
    })
    modal.value = null; routeForm.value = { origin:'Calapan City Terminal', destination:'', estimated_minutes:45, fare:0 }
    showToast('Route added')
    if (res.data?.data) appendLocal(routes, 'routes', res.data.data)
  } catch (e) { error.value = e?.response?.data?.error || 'Failed to add route' }
}

function genPass(){ driverForm.value.password = Math.random().toString(36).slice(2,10) }

function openEditVan(v) {
  editVanForm.value = { id: v.id, plate_number: v.plate_number || '', model: v.model || '', capacity: Number(v.capacity) || 15, status: String(v.status || 'available').toLowerCase() === 'maintenance' ? 'maintenance' : 'available' }
  // If the van is currently queued/dispatched by a trip, its status is
  // trip-derived - manual edits to Available/Maintenance still allowed,
  // but the modal warns that trip status may overwrite it.
  modal.value = 'edit-van'
}
async function saveEditVan() {
  try {
    const f = editVanForm.value
    const res = await api.put(`/api/vehicles/${f.id}`, {
      plate_number: f.plate_number,
      model: f.model || null,
      capacity: Number(f.capacity) || null,
      status: f.status,
    })
    modal.value = null
    showToast(`Van set to ${f.status === 'maintenance' ? 'Maintenance' : 'Available'}`)
    if (res.data?.data) appendLocal(vehicles, 'vehicles', res.data.data)
  } catch (e) { error.value = e?.response?.data?.error || 'Failed to update van' }
}

function openEditDriver(d) {
  editDriverForm.value = { id: d.id, full_name: d.full_name || '', license_no: d.license_no || '', contact_no: d.contact_no || '', status: String(d.status || 'active').toLowerCase() === 'inactive' ? 'inactive' : 'active' }
  // If the driver is currently on_trip by a trip, its status is
  // trip-derived - manual edits to Active/Inactive still allowed,
  // but the modal warns that trip status may overwrite it.
  modal.value = 'edit-driver'
}
async function saveEditDriver() {
  try {
    const f = editDriverForm.value
    const res = await api.put(`/api/drivers/${f.id}`, {
      full_name: f.full_name,
      license_no: f.license_no || null,
      contact_no: f.contact_no || null,
      status: f.status,
    })
    modal.value = null
    const savedStatus = String(res.data?.data?.status || f.status).toLowerCase()
    showToast(`Driver set to ${savedStatus === 'inactive' ? 'Inactive' : savedStatus === 'on_trip' ? 'On Trip (active trip)' : 'Active'}`)
    if (res.data?.data) appendLocal(drivers, 'drivers', res.data.data)
  } catch (e) { error.value = e?.response?.data?.error || 'Failed to update driver' }
}

// Fleet status must be fresh on every visit (trip actions change
// vehicle status in background). Force fetch - still fast via
// backend file cache (~40ms warm), never shows 60s-stale data.
onMounted(() => load({ force: true }))
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><div class="page-title">Fleet</div><div class="page-sub">Vans, drivers and routes</div></div>
      <div class="head-btns">
        <button type="button" class="btn-ghost" @click="modal = 'route'">⇄ Route</button>
        <button type="button" class="btn-ghost" @click="modal = 'driver'">+ Driver</button>
        <button type="button" class="btn-yellow" @click="modal = 'van'">+ Van</button>
      </div>
    </div>
    <div v-if="error" class="error-bar">{{ error }}</div>
    <div v-if="loading" class="empty-box">Loading fleet…</div>
    <template v-else>
      <div class="stat-grid5">
        <div class="card stat-card"><div><div class="stat-label">VANS</div><div class="stat-value">{{ vehicles.length }}</div></div><span class="stat-ico dark">🚌</span></div>
        <div class="card stat-card"><div><div class="stat-label">AVAILABLE</div><div class="stat-value">{{ availableCount }}</div></div><span class="stat-ico dark">✓</span></div>
        <div class="card stat-card"><div><div class="stat-label">IN MAINTENANCE</div><div class="stat-value">{{ maintenanceCount }}</div></div><span class="stat-ico dark">⚙</span></div>
        <div class="card stat-card"><div><div class="stat-label">DRIVERS</div><div class="stat-value">{{ drivers.length }}</div></div><span class="stat-ico dark">👥</span></div>
        <div class="card stat-card"><div><div class="stat-label">TOTAL SEATS</div><div class="stat-value">{{ totalSeats }}</div></div><span class="stat-ico dark">▦</span></div>
      </div>

      <div class="card" style="margin-bottom:.8rem">
        <div class="card-head"><span class="card-title">🚌</span><strong>Vans</strong></div>
        <div v-if="vehicles.length === 0" class="empty-box muted">No vans yet.</div>
        <div v-else style="overflow:auto">
          <table class="data">
            <thead><tr><th>Plate</th><th>Model</th><th>Seats</th><th>Status</th><th style="text-align:right">Actions</th></tr></thead>
            <tbody><tr v-for="v in vehicles" :key="v.id"><td><strong>{{ v.plate_number }}</strong></td><td>{{ v.model || '—' }}</td><td>{{ v.capacity }}</td><td><span class="badge" :class="badgeForStatus(v.status)">{{ statusLabel(v.status) }}</span></td><td style="text-align:right"><button type="button" class="icon-btn" title="Edit van status" @click="openEditVan(v)">✎</button></td></tr></tbody>
          </table>
        </div>
      </div>

      <div class="two-col">
        <div class="card">
          <div class="card-head"><span class="card-title">👥</span><strong>Drivers</strong></div>
          <div v-if="drivers.length === 0" class="empty-box muted">No drivers yet.</div>
          <div v-else style="overflow:auto">
            <table class="data">
              <thead><tr><th>Name</th><th>Licence</th><th>Trips</th><th>Status</th><th style="text-align:right">Actions</th></tr></thead>
              <tbody>
                <tr v-for="d in drivers" :key="d.id">
                  <td><strong>{{ d.full_name }}</strong></td>
                  <td>{{ d.license_no || '—' }}</td>
                  <td>{{ driverActiveTrips[d.id] || 0 }} active</td>
                  <td><span class="badge" :class="badgeForStatus(d.status)">{{ statusLabel(d.status) }}</span></td>
                  <td style="text-align:right"><button type="button" class="icon-btn" title="Edit driver status" @click="openEditDriver(d)">✎</button></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><span class="card-title">⇄</span><strong>Routes</strong></div>
          <div v-if="routes.length === 0" class="empty-box muted">No routes yet.</div>
          <div v-else style="overflow:auto">
            <table class="data">
              <thead><tr><th>Destination</th><th>Ride</th><th>Fare</th></tr></thead>
              <tbody>
                <tr v-for="r in routes" :key="r.id">
                  <td><strong>{{ r.destination }}</strong><div class="muted">from {{ r.origin }}</div></td>
                  <td>{{ r.estimated_minutes }} min</td>
                  <td>₱{{ Number(r.fare||0).toFixed(2) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>

    <div v-if="modal === 'route'" class="modal-overlay" @click.self="modal = null">
      <div class="modal"><div class="modal-head">Add a Route <button type="button" class="modal-close" @click="modal = null">✕</button></div>
        <form @submit.prevent="addRoute"><div class="modal-body"><div class="form-grid">
          <div class="field"><label>Origin</label><input v-model="routeForm.origin" type="text" required /></div>
          <div class="field"><label>Destination</label><input v-model="routeForm.destination" type="text" required /></div>
          <div class="field"><label>Estimated ride (minutes)</label><input v-model="routeForm.estimated_minutes" type="number" min="1" required /></div>
          <div class="field"><label>Fare (₱)</label><input v-model="routeForm.fare" type="number" min="0" step="0.01" required /></div>
        </div></div><div class="modal-foot"><button type="button" class="btn-ghost" @click="modal = null">Cancel</button><button type="submit" class="btn-yellow">Add route</button></div></form>
      </div>
    </div>
    <div v-if="modal === 'driver'" class="modal-overlay" @click.self="modal = null">
      <div class="modal"><div class="modal-head">Add a Driver <button type="button" class="modal-close" @click="modal = null">✕</button></div>
        <form @submit.prevent="addDriver"><div class="modal-body"><div class="form-grid">
          <div class="field"><label>Full name</label><input v-model="driverForm.full_name" type="text" required /></div>
          <div class="field"><label>Licence no.</label><input v-model="driverForm.license_no" type="text" placeholder="N01-23-000005" /></div>
          <div class="field full"><label>Contact no.</label><input v-model="driverForm.contact_no" type="text" placeholder="0917xxxxxxx" /></div>
        </div>
        <div class="muted" style="margin:1rem 0 .5rem">Optional — create a portal login so the driver can use the Driver Web App.<span v-if="auth.role !== 'admin'" class="muted"> Logins are admin-only — as dispatcher, only the driver record will be created.</span></div>
        <div class="form-grid">
          <div class="field"><label>Username</label><input v-model="driverForm.username" type="text" /></div>
          <div class="field"><label>Password</label><div class="pass-row"><input v-model="driverForm.password" type="text" /><button type="button" class="btn-ghost" @click="genPass">✂</button></div></div>
          <div class="field full"><label>Email</label><input v-model="driverForm.email" type="email" placeholder="leave blank to auto-generate" /></div>
        </div></div><div class="modal-foot"><button type="button" class="btn-ghost" @click="modal = null">Cancel</button><button type="submit" class="btn-yellow">Add driver</button></div></form>
      </div>
    </div>
    <div v-if="modal === 'van'" class="modal-overlay" @click.self="modal = null">
      <div class="modal"><div class="modal-head">Add a Van <button type="button" class="modal-close" @click="modal = null">✕</button></div>
        <form @submit.prevent="addVan"><div class="modal-body"><div class="form-grid">
          <div class="field full"><label>Plate number</label><input v-model="vanForm.plate_number" type="text" placeholder="ABC 1234" required /></div>
          <div class="field"><label>Model</label><input v-model="vanForm.model" type="text" placeholder="Toyota HiAce" /></div>
          <div class="field"><label>Seats</label><input v-model="vanForm.capacity" type="number" min="1" required /></div>
        </div></div><div class="modal-foot"><button type="button" class="btn-ghost" @click="modal = null">Cancel</button><button type="submit" class="btn-yellow">Add van</button></div></form>
      </div>
    </div>
    <div v-if="modal === 'edit-van'" class="modal-overlay" @click.self="modal = null">
      <div class="modal"><div class="modal-head">✎ Edit Van — {{ editVanForm.plate_number }} <button type="button" class="modal-close" @click="modal = null">✕</button></div>
        <form @submit.prevent="saveEditVan"><div class="modal-body"><div class="form-grid">
          <div class="field full"><label>Plate number</label><input v-model="editVanForm.plate_number" type="text" required /></div>
          <div class="field"><label>Model</label><input v-model="editVanForm.model" type="text" /></div>
          <div class="field"><label>Seats</label><input v-model="editVanForm.capacity" type="number" min="1" required /></div>
          <div class="field full"><label>Status</label>
            <select v-model="editVanForm.status" required>
              <option value="available">Available (active)</option>
              <option value="maintenance">Maintenance</option>
            </select>
            <div class="muted" style="margin-top:.2rem">Maintenance vans cannot be assigned to new trips. When not in maintenance, Queued/Dispatched/Available follows the van's trips automatically.</div>
          </div>
        </div></div><div class="modal-foot"><button type="button" class="btn-ghost" @click="modal = null">Cancel</button><button type="submit" class="btn-yellow">Save van</button></div></form>
      </div>
    </div>
    <div v-if="modal === 'edit-driver'" class="modal-overlay" @click.self="modal = null">
      <div class="modal"><div class="modal-head">✎ Edit Driver — {{ editDriverForm.full_name }} <button type="button" class="modal-close" @click="modal = null">✕</button></div>
        <form @submit.prevent="saveEditDriver"><div class="modal-body"><div class="form-grid">
          <div class="field full"><label>Full name</label><input v-model="editDriverForm.full_name" type="text" required /></div>
          <div class="field"><label>Licence no.</label><input v-model="editDriverForm.license_no" type="text" /></div>
          <div class="field"><label>Contact no.</label><input v-model="editDriverForm.contact_no" type="text" /></div>
          <div class="field full"><label>Status</label>
            <select v-model="editDriverForm.status" required>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <div class="muted" style="margin-top:.2rem">Inactive drivers cannot be assigned to new trips. When not inactive, On Trip/Active follows the driver's trips automatically (scheduled/boarding/departed → On Trip).</div>
          </div>
        </div></div><div class="modal-foot"><button type="button" class="btn-ghost" @click="modal = null">Cancel</button><button type="submit" class="btn-yellow">Save driver</button></div></form>
      </div>
    </div>
    <div class="toast-wrap"><div v-if="toast" class="toast">{{ toast }}</div></div>
  </div>
</template>

<style scoped>
.head-btns { display:flex; gap:.5rem; }
.stat-grid5 { display:grid; grid-template-columns: repeat(5,1fr); gap:.8rem; margin-bottom:.8rem; }
.stat-card { display:flex; justify-content:space-between; align-items:flex-start; padding:.9rem 1rem; }
.stat-label { font-size:.7rem; font-weight:700; color:#64748b; letter-spacing:.05em; }
.stat-value { font-size:1.7rem; font-weight:800; }
.stat-ico { width:38px; height:38px; border-radius:8px; display:flex; align-items:center; justify-content:center; background:#0f2b4c; color:#fff; }
.two-col { display:grid; grid-template-columns:1fr 1fr; gap:.8rem; }
.pass-row { display:flex; gap:.4rem; }
.pass-row input { flex:1; }
@media (max-width: 900px){ .stat-grid5 { grid-template-columns: repeat(2,1fr); } .two-col { grid-template-columns:1fr; } }
</style>
