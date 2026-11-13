<script setup>
import { ref, onMounted, computed } from 'vue'
import { api } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useCatalogStore } from '@/stores/catalog'

const auth = useAuthStore()
const catalog = useCatalogStore()
const items = ref([])
const users = ref([])
const loading = ref(true)
const error = ref(null)
const toast = ref(null)
const showCompose = ref(false)
const form = ref({ message: '', category: 'boarding', voice: 'Filipino (PH)' })

function showToast(m){ toast.value = m; setTimeout(()=>{ toast.value=null }, 2200) }
function timeAgo(v){
  if (!v) return '—'
  const s = Math.floor((Date.now() - new Date(String(v).replace(' ','T')).getTime())/1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s/60); if (m < 60) return `${m} minutes ago`
  const h = Math.floor(m/60); if (h < 24) return `${h} hour${h>1?'s':''} ago`
  return `${Math.floor(h/24)} days ago`
}

const templates = [
  { key: 'boarding', label: 'Boarding', message: 'Boarding for the van bound for DESTINATION has started. Please proceed to the boarding area.', category: 'Boarding' },
  { key: 'departure', label: 'Departure', message: 'The van bound for DESTINATION is departing now.', category: 'Departure' },
  { key: 'delay', label: 'Delay', message: 'Attention passengers: the van bound for DESTINATION is delayed. We will announce the new departure time shortly. Thank you for your patience.', category: 'Delay' },
  { key: 'safety', label: 'Safety', message: 'For your safety, please keep your tickets ready and wait behind the marked lines while boarding.', category: 'Safety' },
  { key: 'general', label: 'General', message: 'Please prepare your tickets. Scanning is required before boarding.', category: 'General' },
]

function voiceCode(label){ return label === 'Filipino (PH)' ? 'fil-PH' : label === 'English (PH)' ? 'en-PH' : 'fil-PH' }
function categoryCode(label){ return { Boarding:'boarding', Departure:'departure', Delay:'delay', Safety:'safety', General:'general' }[label] || 'general' }
function catBadge(c){ return c === 'boarding' ? 'badge-yellow' : 'badge-light' }
function creatorName(id){ return users.value.find(u => String(u.id)===String(id))?.full_name || (id ? `User #${id}` : '—') }

async function load({ force = false } = {}){
  loading.value = true; error.value = null
  try {
    const [a, u] = await Promise.all([catalog.fetch('announcements', { force }).catch(()=>[]), catalog.fetch('users', { force }).catch(()=>[])])
    items.value = [...(a||[])].sort((x,y)=>String(y.created_at||'').localeCompare(String(x.created_at||'')))
    users.value = u || []
  } catch (e) { error.value = e?.response?.data?.error || 'Failed to load announcements' }
  finally { loading.value = false }
}

function applyTemplate(t){ form.value = { message: t.message, category: t.category, voice: 'Filipino (PH)' }; showCompose.value = true }
function openCompose(){ form.value = { message:'', category:'Boarding', voice:'Filipino (PH)' }; showCompose.value = true }

async function send(){
  try {
    const res = await api.post('/api/announcements', {
      message: form.value.message.substr(0,255),
      category: categoryCode(form.value.category),
      voice: voiceCode(form.value.voice),
      created_by: auth.user?.id ?? null,
    })
    showCompose.value = false
    showToast('Announcement sent')
    if (res.data?.data) {
      items.value = [res.data.data, ...items.value]
      const entry = catalog.cache?.announcements
      if (entry && Array.isArray(entry.data)) { entry.data = [res.data.data, ...entry.data]; entry.at = Date.now() }
    }
  } catch (e) { error.value = e?.response?.data?.error || 'Failed to send announcement' }
}

onMounted(() => load())
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><div class="page-title">Terminal Announcements</div><div class="page-sub">Displayed on the passenger screen and spoken by the IVR engine</div></div>
      <button type="button" class="btn-yellow" @click="openCompose">📢 New announcement</button>
    </div>
    <div v-if="error" class="error-bar">{{ error }}</div>

    <div class="card" style="margin-bottom:.8rem">
      <div class="card-head"><span class="card-title">💡</span><strong>Quick templates</strong></div>
      <div style="padding:1rem">
        <div class="muted" style="margin-bottom:.7rem">Click a template to load it into the composer, then replace the destination.</div>
        <div class="tpl-row">
          <button v-for="t in templates" :key="t.key" type="button" class="tpl-btn" @click="applyTemplate(t)">{{ t.label }}</button>
        </div>
      </div>
    </div>

    <div v-if="loading" class="empty-box">Loading announcements…</div>
    <div v-else class="card">
      <div class="card-head"><span class="card-title">🕐</span><strong>Recent announcements</strong><span class="pill light">{{ items.length }}</span></div>
      <div v-if="items.length === 0" class="empty-box muted">No announcements yet.</div>
      <div v-else style="overflow:auto">
        <table class="data">
          <thead><tr><th>Message</th><th>Category</th><th>Voice</th><th>By</th><th>When</th></tr></thead>
          <tbody>
            <tr v-for="a in items" :key="a.id">
              <td>{{ a.message }}</td>
              <td><span class="badge" :class="catBadge(a.category)" style="text-transform:capitalize">{{ a.category }}</span></td>
              <td>{{ a.voice }}</td>
              <td>{{ creatorName(a.created_by) }}</td>
              <td class="muted">{{ timeAgo(a.created_at) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="showCompose" class="modal-overlay" @click.self="showCompose = false">
      <div class="modal"><div class="modal-head">📢 Compose announcement <button type="button" class="modal-close" @click="showCompose = false">✕</button></div>
        <form @submit.prevent="send">
          <div class="modal-body">
            <div class="field"><label>Message</label><textarea v-model="form.message" rows="4" required maxlength="255"></textarea><div class="muted" style="margin-top:.2rem">Shown as a banner and spoken aloud on the terminal screen.</div></div>
            <div class="form-grid" style="margin-top:1rem">
              <div class="field"><label>Category</label><select v-model="form.category"><option>Boarding</option><option>Departure</option><option>Delay</option><option>Safety</option><option>General</option></select></div>
              <div class="field"><label>Voice</label><select v-model="form.voice"><option>Filipino (PH)</option><option>English (PH)</option></select></div>
            </div>
          </div>
          <div class="modal-foot"><button type="button" class="btn-ghost" @click="showCompose = false">Cancel</button><button type="submit" class="btn-yellow">✈ Send</button></div>
        </form>
      </div>
    </div>
    <div class="toast-wrap"><div v-if="toast" class="toast">{{ toast }}</div></div>
  </div>
</template>

<style scoped>
.tpl-row { display:flex; gap:.5rem; flex-wrap:wrap; }
.tpl-btn { background:#fff; border:1px solid #cbd5e1; padding:.45rem .8rem; border-radius:6px; cursor:pointer; font-size:.83rem; }
.tpl-btn:hover { background:#f8fafc; border-color:#94a3b8; }
</style>
