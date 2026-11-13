<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { api } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useCatalogStore } from '@/stores/catalog'
import { useQrScanner } from '@/composables/useQrScanner'
import { useRouter } from 'vue-router'

const auth = useAuthStore()
const catalog = useCatalogStore()
const router = useRouter()
const tickets = ref([])
const trips = ref([])
const vehicles = ref([])
const routes = ref([])
const code = ref('')
const result = ref(null) // { ok:boolean, title, msg }
const recentScans = ref([])
const uploadError = ref('')
const fileInputRef = ref(null)

const {
  videoRef,
  state: cameraState,
  message: cameraMsg,
  error: cameraError,
  devices: cameras,
  selectedDeviceId,
  torchSupported,
  torchOn,
  flash,
  start: startScanner,
  stop: stopScanner,
  toggleTorch,
  selectDevice,
  decodeFile,
} = useQrScanner({ onDetected: handleDetected })

function tripLabel(tripId){
  const t = trips.value.find(x => String(x.id)===String(tripId))
  if (!t) return `Trip #${tripId}`
  const dest = routes.value.find(r => String(r.id)===String(t.route_id))?.destination || ''
  const plate = vehicles.value.find(v => String(v.id)===String(t.vehicle_id))?.plate_number || ''
  const when = t.scheduled_departure ? new Date(String(t.scheduled_departure).replace(' ','T')).toLocaleString('en-US',{ month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) : ''
  return `${when} — ${dest} (${plate})`.trim()
}

async function load({ force = false } = {}){
  try {
    const [t, tr, v, r] = await Promise.all([
      catalog.fetch('tickets', { force }).catch(()=>[]),
      catalog.fetch('trips', { force }).catch(()=>[]),
      catalog.fetch('vehicles', { force }).catch(()=>[]),
      catalog.fetch('routes', { force }).catch(()=>[]),
    ])
    tickets.value = t || []
    trips.value = tr || []
    vehicles.value = v || []
    routes.value = r || []
    recentScans.value = tickets.value.filter(x => x.scanned_at).sort((a,b)=>String(b.scanned_at).localeCompare(String(a.scanned_at))).slice(0,6)
  } catch {}
}

async function checkCode(qr){
  const c = String(qr || code.value || '').trim()
  if (!c) return
  result.value = null
  try {
    // lookup by qr_code
    const found = tickets.value.find(t => String(t.qr_code||'').toLowerCase() === c.toLowerCase())
    if (!found) {
      result.value = { ok:false, title:'Invalid ticket', msg:`Code ${c} was not found.` }
      return
    }
    if (found.scanned_at || String(found.status||'').toLowerCase() === 'scanned' || String(found.status||'').toLowerCase() === 'boarded') {
      result.value = { ok:false, title:'Already boarded', msg:`${found.passenger_name} · ${tripLabel(found.trip_id)} · scanned ${found.scanned_at || ''}` }
      return
    }
    if (String(found.status||'').toLowerCase() === 'cancelled') {
      result.value = { ok:false, title:'Ticket cancelled', msg:`${found.passenger_name} · ${tripLabel(found.trip_id)} · This ticket was cancelled and cannot be boarded.` }
      return
    }
    const res = await api.post(`/api/tickets/${found.id}/scan`, { scanned_by: auth.user?.id ?? null })
    const updated = res.data?.data || found
    result.value = { ok:true, title:'Boarded successfully', msg:`${updated.passenger_name} · ${tripLabel(updated.trip_id)} · ${updated.qr_code}` }
    // Instant: patch the scanned row locally, no full reload.
    tickets.value = tickets.value.map(t => String(t.id) === String(updated.id) ? updated : t)
    const entry = catalog.cache?.tickets
    if (entry && Array.isArray(entry.data)) { entry.data = entry.data.map(t => String(t.id) === String(updated.id) ? updated : t); entry.at = Date.now() }
    recentScans.value = tickets.value.filter(x => x.scanned_at).sort((a,b)=>String(b.scanned_at).localeCompare(String(a.scanned_at))).slice(0,6)
  } catch (e) {
    result.value = { ok:false, title:'Scan failed', msg: e?.response?.data?.error || 'Could not mark as boarded.' }
  }
}

// A QR code was decoded from the camera (or from an uploaded image).
function handleDetected(value){
  code.value = value
  checkCode(value)
}

async function onDeviceChange(e){
  await selectDevice(e.target.value)
}

async function onPickImage(e){
  const file = e.target.files?.[0]
  uploadError.value = ''
  if (!file) return
  const decoded = await decodeFile(file)
  if (decoded) {
    handleDetected(decoded)
  } else {
    uploadError.value = 'No QR code found in that image. Try a sharper, well-lit photo of the ticket.'
  }
  // Allow re-picking the same file.
  if (fileInputRef.value) fileInputRef.value.value = ''
}

onMounted(() => { load(); startScanner() })
onBeforeUnmount(() => stopScanner())
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><div class="page-title">Boarding Scanner</div><div class="page-sub">Scan a passenger's QR code to mark them aboard</div></div>
      <button type="button" class="btn-ghost" @click="router.push('/tickets')">← Back to tickets</button>
    </div>
    <div class="scan-grid">
      <div class="card">
        <div class="card-head">
          <span class="card-title">📷</span>
          <strong>Camera</strong>
          <button
            v-if="cameraState === 'live'"
            type="button"
            class="btn-ghost btn-sm"
            @click="stopScanner"
          >Stop</button>
          <button
            v-else
            type="button"
            class="btn-dark btn-sm"
            @click="startScanner"
          >{{ cameraState === 'starting' ? 'Starting…' : 'Start camera' }}</button>
        </div>
        <div class="camera-box">
          <div class="video-wrap" :class="{ flash }">
            <video ref="videoRef" playsinline autoplay muted></video>
            <div class="reticle"></div>
            <div v-if="cameraState !== 'live'" class="video-overlay">
              <div>{{ cameraState === 'starting' ? 'Starting camera…' : 'Camera is off' }}</div>
              <button type="button" class="btn-dark btn-sm" @click="startScanner">Start camera</button>
            </div>
          </div>
          <div class="cam-status">
            <span class="dot" :class="cameraState"></span>
            <span>{{ cameraMsg }}</span>
          </div>
          <div v-if="cameraError" class="error-bar cam-error">{{ cameraError }}</div>
          <div class="cam-controls">
            <select
              v-if="cameras.length > 1"
              class="cam-select"
              :value="selectedDeviceId"
              @change="onDeviceChange"
            >
              <option v-for="d in cameras" :key="d.id" :value="d.id">{{ d.label }}</option>
            </select>
            <button
              v-if="torchSupported"
              type="button"
              class="btn-ghost btn-sm"
              @click="toggleTorch"
            >{{ torchOn ? '🔦 Torch on' : '🔦 Torch' }}</button>
            <label class="btn-ghost btn-sm file-btn">
              🖼 Scan image
              <input ref="fileInputRef" type="file" accept="image/*" capture="environment" @change="onPickImage" />
            </label>
          </div>
          <div v-if="uploadError" class="error-bar cam-error">{{ uploadError }}</div>
        </div>
      </div>
      <div>
        <div class="card" style="margin-bottom:.8rem">
          <div class="card-head"><span class="card-title">⌨</span><strong>Manual entry</strong></div>
          <div style="padding:1rem">
            <div class="muted" style="margin-bottom:.6rem">No camera? Type the ticket code printed under the QR image.</div>
            <div class="manual-row">
              <input v-model="code" type="text" placeholder="ST-T1-0001-A1B2C3" @keyup.enter="checkCode()" />
              <button type="button" class="btn-dark" @click="checkCode()">Check</button>
            </div>
          </div>
        </div>
        <div class="card" style="margin-bottom:.8rem">
          <div class="card-head"><strong>Result</strong></div>
          <div v-if="!result" class="empty-box"><div style="font-size:1.8rem;opacity:.4">[|||]</div><div class="muted">Waiting for a scan…</div></div>
          <div v-else style="padding:1rem">
            <div :class="result.ok ? 'ok-box' : 'bad-box'"><strong>{{ result.title }}</strong><div>{{ result.msg }}</div></div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><strong>Recent scans</strong></div>
          <div v-if="recentScans.length === 0" class="empty-box muted">No scans yet this session.</div>
          <table class="data" v-else>
            <tbody>
              <tr v-for="t in recentScans" :key="t.id"><td><strong>{{ t.passenger_name }}</strong><div class="muted">{{ t.qr_code }}</div></td><td>{{ t.scanned_at }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scan-grid { display:grid; grid-template-columns: 1fr 1fr; gap:.8rem; }
.camera-box { padding:1rem; }
.video-wrap { position:relative; width:100%; aspect-ratio:4/3; background:#0c2a4b; border-radius:10px; overflow:hidden; }
.video-wrap video { width:100%; height:100%; object-fit:cover; display:block; }
.video-wrap.flash { box-shadow: inset 0 0 0 6px #22c55e; }
.reticle { position:absolute; inset:16%; border:3px solid rgba(255,255,255,.85); border-radius:12px; box-shadow:0 0 0 2000px rgba(0,0,0,.18); pointer-events:none; }
.video-overlay { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:.8rem; color:#dbeafe; background:rgba(12,42,75,.85); font-weight:700; text-align:center; padding:1rem; }
.cam-status { display:flex; align-items:center; gap:.5rem; margin-top:.7rem; font-size:.95rem; color:#475569; }
.dot { width:10px; height:10px; border-radius:50%; background:#94a3b8; flex:none; }
.dot.live { background:#22c55e; box-shadow:0 0 0 3px rgba(34,197,94,.25); }
.dot.starting { background:#f59e0b; }
.dot.error { background:#ef4444; }
.cam-error { margin:.7rem 0 0; }
.cam-controls { display:flex; flex-wrap:wrap; gap:.5rem; margin-top:.7rem; }
.cam-select { padding:.5rem .6rem; border:1px solid #cbd5e1; border-radius:8px; font-size:.9rem; background:#fff; max-width:100%; }
.btn-sm { padding:.45rem .8rem; font-size:.9rem; border-radius:8px; }
.file-btn { display:inline-flex; align-items:center; gap:.35rem; cursor:pointer; }
.file-btn input { display:none; }
.manual-row { display:flex; gap:.5rem; }
.manual-row input { flex:1; padding:.6rem .8rem; border:1px solid #cbd5e1; border-radius:8px; font-size:.9rem; }
.ok-box { background:#dcfce7; color:#166534; padding:.8rem; border-radius:8px; }
.bad-box { background:#fee2e2; color:#991b1b; padding:.8rem; border-radius:8px; }
@media (max-width: 900px){ .scan-grid { grid-template-columns:1fr; } }
</style>
