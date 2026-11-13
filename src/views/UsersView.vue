<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useCatalogStore } from '@/stores/catalog'

const auth = useAuthStore()
const catalog = useCatalogStore()
const items = ref([])
const drivers = ref([])
const loading = ref(true)
const error = ref(null)
const toast = ref(null)

const showCreate = ref(false)
const showReset = ref(false)
const createForm = ref({ full_name: '', role: 'dispatcher', username: '', password: '', email: '', contact_no: '' })
const resetForm = ref({ id: '', username: '', password: '' })

function showToast(m){ toast.value = m; setTimeout(()=>{ toast.value=null }, 2200) }

function timeAgo(v){
  if (!v) return '—'
  const s = Math.floor((Date.now() - new Date(String(v).replace(' ','T')).getTime())/1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s/60); if (m < 60) return `${m} minutes ago`
  const h = Math.floor(m/60); if (h < 24) return `${h} hour${h>1?'s':''} ago`
  return `${Math.floor(h/24)} days ago`
}

const driverByUser = computed(() => Object.fromEntries(drivers.value.filter(d => d.user_id).map(d => [d.user_id, d])))
const stats = computed(() => ({
  accounts: items.value.length,
  admins: items.value.filter(u => u.role === 'admin').length,
  dispatchers: items.value.filter(u => u.role === 'dispatcher').length,
  drivers: items.value.filter(u => u.role === 'driver').length,
  active: items.value.filter(u => Number(u.is_active) === 1).length,
}))
function roleBadge(r){ return r === 'admin' ? 'badge-black' : r === 'dispatcher' ? 'badge-blue' : 'badge-green' }
function roleLabel(r){ return r === 'admin' ? 'Admin' : r === 'dispatcher' ? 'Dispatcher' : 'Driver' }

async function load({ force = false } = {}){
  loading.value = true; error.value = null
  try {
    const [u, d] = await Promise.all([catalog.fetch('users', { force }).catch(()=>[]), catalog.fetch('drivers', { force }).catch(()=>[])])
    items.value = u || []
    drivers.value = d || []
  } catch (e) { error.value = e?.response?.data?.error || 'Failed to load users' }
  finally { loading.value = false }
}

function genPass(){ createForm.value.password = Math.random().toString(36).slice(2,10); resetForm.value.password = createForm.value.password }
function genResetPass(){ resetForm.value.password = Math.random().toString(36).slice(2,10) }

function patchCatalogUser(row) {
  const entry = catalog.cache?.users
  if (entry && Array.isArray(entry.data)) {
    entry.data = [...entry.data.filter(x => String(x.id) !== String(row.id)), row]
    entry.at = Date.now()
  }
}
function patchCatalogList(key, row) {
  const entry = catalog.cache?.[key]
  if (entry && Array.isArray(entry.data)) {
    entry.data = [...entry.data.filter(x => String(x.id) !== String(row.id)), row]
    entry.at = Date.now()
  }
}
async function createUser(){
  try {
    const payload = { ...createForm.value }
    if (!payload.email) payload.email = `${payload.username}@smartterminal.local`
    const res = await api.post('/api/users', payload)
    const created = res.data?.data
    showCreate.value = false
    const createdRole = created?.role || payload.role
    createForm.value = { full_name:'', role:'dispatcher', username:'', password:'', email:'', contact_no:'' }
    showToast(createdRole === 'driver' ? 'Driver account + profile created' : 'Account created')
    if (created) { items.value = [...items.value.filter(x => String(x.id) !== String(created.id)), created]; patchCatalogUser(created) }
    // Driver accounts auto-save a drivers row — show it immediately.
    if (created?.driver) {
      drivers.value = [...drivers.value.filter(x => String(x.id) !== String(created.driver.id)), created.driver]
      patchCatalogList('drivers', created.driver)
    }
  } catch (e) { error.value = e?.response?.data?.error || 'Failed to create user' }
}

function openReset(u){ resetForm.value = { id: u.id, username: u.username, password: '' }; showReset.value = true }
async function saveReset(){
  try {
    await api.put(`/api/users/${resetForm.value.id}`, { password: resetForm.value.password })
    showReset.value = false; showToast('Password updated')
  } catch (e) { error.value = e?.response?.data?.error || 'Failed to update password' }
}

async function toggleActive(u){
  if (String(u.id) === String(auth.user?.id)) { error.value = 'You cannot deactivate your own account.'; return }
  if (!confirm(`${Number(u.is_active) === 1 ? 'Deactivate' : 'Activate'} ${u.username}?`)) return
  const nextActive = Number(u.is_active) === 1 ? 0 : 1
  // Optimistic: toggle immediately.
  items.value = items.value.map(x => String(x.id) === String(u.id) ? { ...x, is_active: nextActive } : x)
  const entry = catalog.cache?.users
  if (entry && Array.isArray(entry.data)) { entry.data = entry.data.map(x => String(x.id) === String(u.id) ? { ...x, is_active: nextActive } : x); entry.at = Date.now() }
  try {
    const res = await api.put(`/api/users/${u.id}`, { is_active: nextActive })
    if (res.data?.data) { items.value = items.value.map(x => String(x.id) === String(u.id) ? { ...x, ...res.data.data } : x) }
    showToast('Account updated')
  } catch (e) { error.value = e?.response?.data?.error || 'Update failed' }
}

async function deleteUser(u){
  if (String(u.id) === String(auth.user?.id)) { error.value = 'You cannot delete your own account.'; return }
  const alsoDriver = u.role === 'driver' ? ', and the driver profile' : ''
  if (!confirm(`Permanently delete ${u.username}${alsoDriver}?`)) return
  const driverProfile = driverByUser.value[u.id]
  // Optimistic: disappear immediately (user + linked driver profile).
  items.value = items.value.filter(x => String(x.id) !== String(u.id))
  const entry = catalog.cache?.users
  if (entry && Array.isArray(entry.data)) { entry.data = entry.data.filter(x => String(x.id) !== String(u.id)); entry.at = Date.now() }
  if (driverProfile) {
    drivers.value = drivers.value.filter(x => String(x.id) !== String(driverProfile.id))
    const dEntry = catalog.cache?.drivers
    if (dEntry && Array.isArray(dEntry.data)) { dEntry.data = dEntry.data.filter(x => String(x.id) !== String(driverProfile.id)); dEntry.at = Date.now() }
  }
  try { await api.delete(`/api/users/${u.id}`); showToast('User deleted') }
  catch (e) { error.value = e?.response?.data?.error || 'Delete failed' }
}

onMounted(() => load())
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><div class="page-title">User Accounts</div><div class="page-sub">Create sign-ins for dispatchers and drivers</div></div>
      <button type="button" class="btn-yellow" @click="showCreate = true">+ New user</button>
    </div>
    <div v-if="error" class="error-bar">{{ error }}</div>
    <div v-if="loading" class="empty-box">Loading users…</div>
    <template v-else>
      <div class="stat-grid5">
        <div class="card stat-card"><div><div class="stat-label">ACCOUNTS</div><div class="stat-value">{{ stats.accounts }}</div></div><span class="stat-ico dark">👥</span></div>
        <div class="card stat-card"><div><div class="stat-label">ADMINS</div><div class="stat-value">{{ stats.admins }}</div></div><span class="stat-ico dark">🛡</span></div>
        <div class="card stat-card"><div><div class="stat-label">DISPATCHERS</div><div class="stat-value">{{ stats.dispatchers }}</div></div><span class="stat-ico dark">🎧</span></div>
        <div class="card stat-card"><div><div class="stat-label">DRIVERS</div><div class="stat-value">{{ stats.drivers }}</div></div><span class="stat-ico dark">🚌</span></div>
        <div class="card stat-card"><div><div class="stat-label">ACTIVE</div><div class="stat-value">{{ stats.active }}</div></div><span class="stat-ico dark">✓</span></div>
      </div>

      <div class="card">
        <div class="card-head"><span class="card-title"><span>👥</span>Accounts</span><span class="pill light">{{ items.length }}</span></div>
        <div v-if="items.length === 0" class="empty-box muted">No users found.</div>
        <div v-else style="overflow:auto">
          <table class="data">
            <thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Contact</th><th>Driver Profile</th><th>Last Login</th><th style="text-align:right">Actions</th></tr></thead>
            <tbody>
              <tr v-for="u in items" :key="u.id">
                <td><strong>{{ u.username }}</strong> <span v-if="String(u.id)===String(auth.user?.id)" class="you-badge">you</span> <span v-if="Number(u.is_active)===0" class="badge badge-black" style="margin-left:.3rem">Inactive</span></td>
                <td>{{ u.full_name }}</td>
                <td><span class="badge" :class="roleBadge(u.role)">{{ roleLabel(u.role) }}</span></td>
                <td>{{ u.contact_no || '—' }}</td>
                <td>
                  <template v-if="driverByUser[u.id]"><strong>{{ driverByUser[u.id].license_no || '—' }}</strong><div><span class="badge" :class="String(driverByUser[u.id].status).toLowerCase()==='on_trip' ? 'badge-blue' : 'badge-green'">{{ driverByUser[u.id].status }}</span> <span class="muted">· 0 active</span></div></template>
                  <span v-else class="muted">—</span>
                </td>
                <td class="muted">{{ timeAgo(u.last_login_at) }}</td>
                <td style="text-align:right; white-space:nowrap">
                  <button type="button" class="icon-btn" title="Reset password" @click="openReset(u)">⚿</button>
                  <!-- Admin account: reset password is the only action. -->
                  <template v-if="u.role !== 'admin'">
                    <button type="button" class="icon-btn red" :title="Number(u.is_active)===1 ? 'Deactivate' : 'Activate'" @click="toggleActive(u)">{{ Number(u.is_active)===1 ? '⊘' : '✓' }}</button>
                    <button type="button" class="icon-btn red" title="Delete" @click="deleteUser(u)">✕</button>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <div v-if="showCreate" class="modal-overlay" @click.self="showCreate = false">
      <div class="modal"><div class="modal-head">+ Create account <button type="button" class="modal-close" @click="showCreate = false">✕</button></div>
        <form @submit.prevent="createUser"><div class="modal-body"><div class="form-grid">
          <div class="field"><label>Full name *</label><input v-model="createForm.full_name" type="text" placeholder="Juan Dela Cruz" required /></div>
          <div class="field"><label>Role *</label><select v-model="createForm.role"><option value="dispatcher">Dispatcher — queue &amp; reports</option><option value="driver">Driver</option></select><div class="muted" style="margin-top:.2rem">Only one admin account exists — Admin is not available here.</div></div>
          <div class="field"><label>Username *</label><input v-model="createForm.username" type="text" placeholder="jdelacruz" required /><div class="muted" style="margin-top:.2rem">3–50 characters. Letters, numbers, dot, dash.</div></div>
          <div class="field"><label>Password *</label><div class="pass-row"><input v-model="createForm.password" type="text" required /><button type="button" class="btn-ghost" @click="genPass">✂</button></div><div class="muted" style="margin-top:.2rem">At least 6 characters. Hand it to them privately.</div></div>
          <div class="field"><label>Email</label><input v-model="createForm.email" type="email" placeholder="name@smartterminal.local" /><div class="muted" style="margin-top:.2rem">Leave blank to auto-generate from the username.</div></div>
          <div class="field"><label>Contact no.</label><input v-model="createForm.contact_no" type="text" placeholder="0917xxxxxxx" /></div>
        </div></div><div class="modal-foot"><button type="button" class="btn-ghost" @click="showCreate = false">Cancel</button><button type="submit" class="btn-yellow">+ Create account</button></div></form>
      </div>
    </div>

    <div v-if="showReset" class="modal-overlay" @click.self="showReset = false">
      <div class="modal"><div class="modal-head">⚿ Reset password — {{ resetForm.username }} <button type="button" class="modal-close" @click="showReset = false">✕</button></div>
        <form @submit.prevent="saveReset"><div class="modal-body"><div class="field"><label>New password *</label><div class="pass-row"><input v-model="resetForm.password" type="text" required /><button type="button" class="btn-ghost" @click="genResetPass">✂</button></div><div class="muted" style="margin-top:.2rem">At least 6 characters.</div></div></div><div class="modal-foot"><button type="button" class="btn-ghost" @click="showReset = false">Cancel</button><button type="submit" class="btn-yellow">Save password</button></div></form>
      </div>
    </div>
    <div class="toast-wrap"><div v-if="toast" class="toast">{{ toast }}</div></div>
  </div>
</template>

<style scoped>
.stat-grid5 { display:grid; grid-template-columns: repeat(5,1fr); gap:.8rem; margin-bottom:.8rem; }
.stat-card { display:flex; justify-content:space-between; align-items:flex-start; padding:.9rem 1rem; }
.stat-label { font-size:.7rem; font-weight:700; color:#64748b; letter-spacing:.05em; }
.stat-value { font-size:1.7rem; font-weight:800; }
.stat-ico { width:38px; height:38px; border-radius:8px; display:flex; align-items:center; justify-content:center; background:#0f2b4c; color:#fff; }
.you-badge { background:#22d3ee; color:#111; font-size:.65rem; font-weight:800; padding:.1rem .35rem; border-radius:5px; }
.pass-row { display:flex; gap:.4rem; }
.pass-row input { flex:1; }
.icon-btn { margin-left:.25rem; }
@media (max-width: 900px){ .stat-grid5 { grid-template-columns: repeat(2,1fr); } }
</style>
