<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useCatalogStore } from '@/stores/catalog'
import { useRoute, useRouter } from 'vue-router'

const auth = useAuthStore()
const catalog = useCatalogStore()
const route = useRoute()
const router = useRouter()
const allTickets = ref([])
const trips = ref([])
const vehicles = ref([])
const routes = ref([])
const loading = ref(true)
const error = ref(null)
const toast = ref(null)
const selectedTrip = ref('')
const showIssue = ref(false)
const issueForm = ref({ trip_id: '', passenger_name: '', contact_no: '' })

function showToast(m){ toast.value = m; setTimeout(()=>{ toast.value=null }, 2200) }

function qrImage(code){ return `https://api.qrserver.com/v1/create-qr-code/?size=90x90&data=${encodeURIComponent(code)}` }
function isCancelled(t){ return String(t.status||'').toLowerCase() === 'cancelled' }
function activeSoldCount(tripId){
  // Cancelled tickets no longer count as sold - their seat is restored.
  return allTickets.value.filter(x => String(x.trip_id)===String(tripId) && !isCancelled(x)).length
}
function fmtTripOption(t){
  const plate = vehicles.value.find(v => String(v.id)===String(t.vehicle_id))?.plate_number || ''
  const dest = routes.value.find(r => String(r.id)===String(t.route_id))?.destination || `Route #${t.route_id}`
  const sold = activeSoldCount(t.id)
  const cap = vehicles.value.find(v => String(v.id)===String(t.vehicle_id))?.capacity || 15
  const remaining = Math.max(cap - sold, 0)
  const when = t.scheduled_departure ? new Date(String(t.scheduled_departure).replace(' ','T')).toLocaleString('en-US',{ month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) : `Trip #${t.id}`
  return `${when} — ${dest} (${plate} ${sold}/${cap} sold · ${remaining} remaining)`
}

function badgeForStatus(s){
  const v = String(s||'').toLowerCase()
  if (v === 'boarded' || v === 'scanned') return 'badge-green'
  if (v === 'cancelled') return 'badge-black'
  return 'badge-light'
}
function labelForStatus(t){
  const v = String(t.status||'').toLowerCase()
  if (v === 'scanned') return 'boarded'
  if (v) return v
  return t.scanned_at ? 'boarded' : 'pending'
}

const tickets = computed(() => {
  if (!selectedTrip.value) return allTickets.value
  return allTickets.value.filter(t => String(t.trip_id) === String(selectedTrip.value))
})

// Only boarding trips can receive new tickets (scheduled = not yet
// boarding, completed/cancelled/departed are closed - matches backend guard).
const issuableTrips = computed(() => trips.value.filter(t => String(t.status||'').toLowerCase() === 'boarding'))

// Filter dropdown for the Tickets table: cancelled trips are hidden.
const filterableTrips = computed(() => trips.value.filter(t => String(t.status||'').toLowerCase() !== 'cancelled'))

async function cancelTicket(t){
  if (isCancelled(t)) return
  if (!confirm(`Cancel ticket for ${t.passenger_name}? The seat will be restored.`)) return
  // Optimistic: status becomes Cancelled (and seat restored) instantly.
  const prev = [...allTickets.value]
  allTickets.value = allTickets.value.map(x => String(x.id) === String(t.id) ? { ...x, status: 'cancelled' } : x)
  const entry = catalog.cache?.tickets
  if (entry && Array.isArray(entry.data)) { entry.data = entry.data.map(x => String(x.id) === String(t.id) ? { ...x, status: 'cancelled' } : x); entry.at = Date.now() }
  try {
    const res = await api.post(`/api/tickets/${t.id}/cancel`, {})
    if (res.data?.data) {
      allTickets.value = allTickets.value.map(x => String(x.id) === String(t.id) ? { ...x, ...res.data.data } : x)
    }
    showToast('Ticket cancelled and seat restored')
  } catch (e) {
    allTickets.value = prev
    error.value = e?.response?.data?.error || 'Cancel failed'
  }
}

async function load({ force = false } = {}){
  loading.value = true; error.value = null
  try {
    const [t, tr, v, r] = await Promise.all([
      catalog.fetch('tickets', { force }).catch(()=>[]),
      catalog.fetch('trips', { force }).catch(()=>[]),
      catalog.fetch('vehicles', { force }).catch(()=>[]),
      catalog.fetch('routes', { force }).catch(()=>[]),
    ])
    allTickets.value = t || []
    trips.value = tr || []
    vehicles.value = v || []
    routes.value = r || []
    if (route.query.trip_id && !selectedTrip.value) selectedTrip.value = String(route.query.trip_id)
    if (!selectedTrip.value && trips.value.length) { /* keep empty = all */ }
  } catch (e) { error.value = e?.response?.data?.error || 'Failed to load tickets' }
  finally { loading.value = false }
}

async function issueTickets(){
  try {
    // One ticket per issue (quantity removed). Backend auto-assigns seat_no.
    const res = await api.post('/api/tickets', {
      trip_id: Number(issueForm.value.trip_id),
      passenger_name: issueForm.value.passenger_name,
      contact_no: issueForm.value.contact_no || null,
    })
    showIssue.value = false
    issueForm.value = { trip_id: selectedTrip.value || '', passenger_name:'', contact_no:'' }
    showToast(res.data?.data?.seat_no ? `Ticket issued · Seat #${res.data.data.seat_no}` : 'Ticket issued')
    // Instant: append created ticket locally, no full reload.
    const created = res.data?.data ? [res.data.data] : []
    if (created.length) {
      allTickets.value = [...allTickets.value, ...created]
      const entry = catalog.cache?.tickets
      if (entry && Array.isArray(entry.data)) { entry.data = [...entry.data, ...created]; entry.at = Date.now() }
    }
  } catch (e) { error.value = e?.response?.data?.error || 'Failed to issue ticket' }
}

function openIssue(){
  // Pick the currently selected trip if issuable, else first issuable trip.
  const cur = issuableTrips.value.find(t => String(t.id) === String(issueForm.value.trip_id))
  issueForm.value.trip_id = String(cur?.id ?? issuableTrips.value[0]?.id ?? '')
  issueForm.value.passenger_name = ''; issueForm.value.contact_no = ''
  showIssue.value = true
}

function applyFilter(){ /* selectedTrip is reactive - instant, no reload needed */ }

onMounted(() => load())
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><div class="page-title">QR Tickets</div><div class="page-sub">Issue a boarding pass, scan it at the gate</div></div>
      <div class="head-btns">
        <button type="button" class="btn-dark" @click="router.push('/scan')">▣ Open scanner</button>
        <button type="button" class="btn-yellow" @click="openIssue">+ Issue ticket</button>
      </div>
    </div>
    <div v-if="error" class="error-bar">{{ error }}</div>

    <div class="filter-grid">
      <div class="field"><label>Trip</label><select v-model="selectedTrip"><option value="">All trips</option><option v-for="t in filterableTrips" :key="t.id" :value="t.id">{{ fmtTripOption(t) }}</option></select></div>
      <button type="button" class="btn-dark" @click="applyFilter">Load</button>
    </div>

    <div v-if="loading" class="empty-box">Loading tickets…</div>
    <div v-else class="card">
      <div class="card-head"><span class="card-title"><span>🎫</span>Tickets</span><span class="pill light">{{ tickets.length }} issued</span></div>
      <div v-if="tickets.length === 0" class="empty-box"><div style="font-size:2rem;opacity:.4">🎫</div><div class="muted">No tickets yet for this trip. Use <strong>Issue ticket</strong> to create one.</div></div>
      <div v-else style="overflow:auto">
        <table class="data">
          <thead><tr><th>Passenger</th><th>Trip</th><th>Seat</th><th>QR Code</th><th>Status</th><th>Scanned</th><th style="text-align:right">Actions</th></tr></thead>
          <tbody>
            <tr v-for="t in tickets" :key="t.id">
              <td><strong>{{ t.passenger_name }}</strong><div class="muted">{{ t.contact_no || '' }}</div></td>
              <td>#{{ t.trip_id }}</td>
              <td>{{ t.seat_no ?? '—' }}</td>
              <td><img v-if="t.qr_code" :src="qrImage(t.qr_code)" alt="QR" style="width:56px;height:56px" /><div class="muted" style="font-family:monospace">{{ t.qr_code }}</div></td>
              <td><span class="badge" :class="badgeForStatus(t.status)" style="text-transform:capitalize">{{ labelForStatus(t) }}</span></td>
              <td>{{ t.scanned_at || '—' }}</td>
              <td style="text-align:right; white-space:nowrap">
                <button v-if="!isCancelled(t)" type="button" class="icon-btn red" title="Cancel ticket (restores seat)" @click="cancelTicket(t)">✕</button>
                <span v-else class="muted">Cancelled</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="showIssue" class="modal-overlay" @click.self="showIssue = false">
      <div class="modal">
        <div class="modal-head">⊕ Issue Ticket <button type="button" class="modal-close" @click="showIssue = false">✕</button></div>
        <form @submit.prevent="issueTickets">
          <div class="modal-body">
            <div class="form-grid">
              <div class="field full"><label>Trip</label><select v-model="issueForm.trip_id" required><option value="">Select boarding trip…</option><option v-for="t in issuableTrips" :key="t.id" :value="t.id">{{ fmtTripOption(t) }}</option></select><div v-if="issuableTrips.length === 0" class="muted" style="margin-top:.3rem">No boarding trips available — start boarding a van first (Dispatch Queue → Start boarding). Scheduled trips cannot receive tickets yet.</div></div>
              <div class="field full"><label>Passenger name</label><input v-model="issueForm.passenger_name" type="text" placeholder="Juan Dela Cruz" required /></div>
              <div class="field full"><label>Contact no.</label><input v-model="issueForm.contact_no" type="text" placeholder="0917xxxxxxx" /></div>
              <div class="muted full">Seat number is assigned automatically (next available seat). Cancelled seats become available again.</div>
            </div>
          </div>
          <div class="modal-foot"><button type="button" class="btn-ghost" @click="showIssue = false">Cancel</button><button type="submit" class="btn-yellow" :disabled="issuableTrips.length === 0">Issue</button></div>
        </form>
      </div>
    </div>
    <div class="toast-wrap"><div v-if="toast" class="toast">{{ toast }}</div></div>
  </div>
</template>

<style scoped>
.head-btns { display:flex; gap:.5rem; }
.filter-grid { display:grid; grid-template-columns: minmax(0, 440px) auto; justify-content: start; gap:.6rem; align-items:flex-end; margin-bottom:.8rem; }
.filter-grid .field select { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
