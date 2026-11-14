<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { api } from '@/api'
import {
  initOneSignal,
  oneSignalConfigured,
  oneSignalStatus,
  onPermissionChange,
  requestPushPermission,
  resubscribePush,
} from '@/onesignal'
import { localDate } from '@/datetime'

const rows = ref([])
const announcements = ref([])
const loading = ref(true)
const error = ref(null)
const clock = ref(new Date().toLocaleString('en-PH', { hour12: true }))
let timer = null
let clockTimer = null

// Push notification state: idle | loading | ready | enabled | blocked | error
const pushState = ref('idle')
const pushMessage = ref('')
let oneSignal = null

const todayStr = () => localDate()

// Only announcements created TODAY are shown on the board —
// yesterday and older are never displayed.
const todayAnnouncements = computed(() =>
  announcements.value
    .filter((a) => String(a.created_at || '').startsWith(todayStr()))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
)

const fetchStatus = async () => {
  try {
    const response = await api.get('/api/passenger-status')
    // Show only scheduled trips (hide completed and departed)
    rows.value = (response.data.data || []).filter((r) => r.trip_status === 'scheduled')
    error.value = null
  } catch (err) {
    error.value = 'Failed to load passenger status'
    console.error(err)
  } finally {
    loading.value = false
  }
}

const fetchAnnouncements = async () => {
  try {
    const response = await api.get('/api/announcements')
    announcements.value = response.data.data || []
  } catch (_) {}
}

const fetchAll = () => { fetchStatus(); fetchAnnouncements() }

// ── OneSignal push notifications ──────────────────────────────────────
// Passengers are anonymous: no login, no user id. They simply allow the
// browser notification prompt and land in the "Subscribed Users" segment,
// which the backend broadcasts announcements to.
function applyPushStatus(status) {
  if (status.subscribed) {
    pushState.value = 'enabled'
    pushMessage.value = ''
    return
  }
  if (status.blocked) {
    pushState.value = 'blocked'
    pushMessage.value = 'Notifications are blocked for this site, so the browser will not ask again. To turn them on: click the icon at the left of the address bar → “Site permissions” → set “Notifications” to “Allow”, then reload this page.'
    return
  }
  if (status.permission === 'granted') {
    // Permission is fine but no push subscription was created - say why.
    pushState.value = 'ready'
    const reasons = []
    if (!status.workerReady) reasons.push('the OneSignal service worker is not registered')
    if (status.error) reasons.push(status.error)
    pushMessage.value = reasons.length
      ? `Permission granted, but no push subscription was created (${reasons.join('; ')}). On iPhone, add this page to your Home Screen and open it again.`
      : 'Permission granted, but the subscription is not active yet. On iPhone, add this page to your Home Screen and open it again.'
    return
  }
  pushState.value = 'ready'
  pushMessage.value = ''
}

async function setupPush() {
  if (!oneSignalConfigured()) {
    pushState.value = 'error'
    pushMessage.value = 'Push notifications are not configured for this terminal.'
    return
  }
  pushState.value = 'loading'
  try {
    oneSignal = await initOneSignal()
    let status = await oneSignalStatus(oneSignal)

    // Self-heal: the browser permission is allowed, but the subscription may
    // never have reached OneSignal (a lost worker message, a blocked
    // request, ...). Then the player belongs to no segment and broadcasts to
    // "Subscribed Users" never arrive. Registering the subscription again
    // fixes it, and it is rate limited to once a day so it does not create
    // a new player on every page view.
    if (status.permission === 'granted' && !status.subscribed) {
      status = await requestPushPermission(oneSignal)
    }
    if (status.permission === 'granted') {
      const lastSync = Number(localStorage.getItem('st_onesignal_synced') || 0)
      if (Date.now() - lastSync > 24 * 60 * 60 * 1000) {
        try {
          status = await resubscribePush(oneSignal)
          localStorage.setItem('st_onesignal_synced', String(Date.now()))
        } catch (err) {
          console.warn('[OneSignal] re-registration failed:', err)
        }
      }
    }

    applyPushStatus(status)
    onPermissionChange(oneSignal, applyPushStatus)
  } catch (err) {
    console.warn('[OneSignal] could not initialise:', err)
    pushState.value = 'error'
    const reason = String(err?.message || err)
    // A blocked/tracker-blocked OneSignal domain is the most common cause.
    if (/timeout|timed out|already initialized/i.test(reason)) {
      pushMessage.value = 'The push notification service could not start. Brave Shields or an ad blocker is probably blocking OneSignal - allow cdn.onesignal.com and api.onesignal.com for this site, then reload.'
    } else if (/can only be used on/i.test(reason)) {
      pushMessage.value = `Push notifications are not available on ${window.location.origin}. Add this address to the OneSignal dashboard under Settings → Web Push Configurations → Site URL, then reload.`
    } else {
      pushMessage.value = `Notifications are unavailable right now (${reason}). Please try again later.`
    }
  }
}

async function enableNotifications() {
  if (!oneSignal) await setupPush()
  if (!oneSignal) return
  pushState.value = 'loading'
  try {
    // Must run inside the click handler so the browser shows its own
    // Allow/Block prompt - never on page load.
    applyPushStatus(await requestPushPermission(oneSignal))
  } catch (err) {
    console.warn('[OneSignal] permission request failed:', err)
    // Fall back to the native permission state so a blocked browser shows
    // a useful hint instead of a generic error.
    applyPushStatus(await oneSignalStatus(oneSignal))
    if (pushState.value !== 'blocked') {
      pushState.value = 'error'
      pushMessage.value = 'Could not enable notifications. Please try again.'
    }
  }
}

function reloadPage() {
  window.location.reload()
}

/**
 * Sends the subscription to OneSignal again.
 *
 * Clicking the "Notifications enabled" badge re-registers the browser
 * subscription. Useful when the first attempt was lost (a blocked request,
 * a closed laptop, ...) and OneSignal does not know the passenger yet.
 */
async function resubscribe() {
  if (!oneSignal) return
  pushState.value = 'loading'
  try {
    const status = await resubscribePush(oneSignal)
    localStorage.setItem('st_onesignal_synced', String(Date.now()))
    applyPushStatus(status)
  } catch (err) {
    console.warn('[OneSignal] re-subscribe failed:', err)
    pushState.value = 'error'
    pushMessage.value = 'Could not send the subscription to OneSignal. Please try again.'
  }
}

onMounted(() => {
  fetchAll()
  timer = setInterval(fetchAll, 10000)
  clockTimer = setInterval(() => { clock.value = new Date().toLocaleString('en-PH', { hour12: true }) }, 1000)
  setupPush()
})
onUnmounted(() => { clearInterval(timer); clearInterval(clockTimer) })
</script>

<template>
  <div class="board-page">
    <header class="board-header">
      <div class="brand">
        <div class="bus-icon">🚌</div>
        <div>
          <div class="brand-name">Yellow Mega Van</div>
          <div class="brand-sub">Calapan City Terminal · Live Departure Board</div>
        </div>
      </div>
      <div class="clock-box">
        <div class="big-time">{{ clock }}</div>
        <div class="updated">Updated {{ new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }) }}</div>
      </div>
    </header>

    <div v-if="error" class="error">{{ error }}</div>
    <div v-if="loading" class="loading">Loading live board…</div>

    <table v-else>
      <thead>
        <tr>
          <th>Destination</th>
          <th>Plate No.</th>
          <th>Driver</th>
          <th>Scheduled Departure</th>
          <th>Status</th>
          <th>Queue #</th>
          <th>Waiting</th>
          <th>Boarded</th>
          <th>Seats Left</th>
          <th>Fare</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(r, i) in rows" :key="r.trip_id">
          <td class="strong">{{ r.destination }} <small>(from {{ r.origin }})</small></td>
          <td>{{ r.plate_number }}</td>
          <td>{{ r.driver_name }}</td>
          <td>{{ r.scheduled_departure }}</td>
          <td><span class="badge">{{ r.trip_status }}</span></td>
          <td>{{ r.queue_position ?? '—' }} <small v-if="r.queue_status">({{ r.queue_status }})</small></td>
          <td>{{ r.passengers_waiting ?? '—' }}</td>
          <td>{{ r.passengers_boarded ?? '—' }}</td>
          <td>{{ r.seats_available ?? '—' }}</td>
          <td>₱{{ r.fare ?? '—' }}</td>
        </tr>
      </tbody>
    </table>
    <div v-if="rows.length === 0 && !loading" class="empty">No scheduled trips currently on the board.</div>

    <section class="announce-section">
      <div class="announce-head">
        <div class="announce-title">📢 Announcements — Today</div>
        <div class="notify-wrap">
          <button
            v-if="pushState !== 'enabled'"
            type="button"
            class="notify-btn"
            :disabled="pushState === 'loading'"
            @click="enableNotifications"
          >{{ pushState === 'loading' ? '⏳ Enabling…' : '🔔 Notify me of announcements' }}</button>
          <button
            v-else
            type="button"
            class="notify-on"
            title="Click to re-send your subscription to OneSignal"
            @click="resubscribe"
          >🔔 Notifications enabled ✓</button>
        </div>
      </div>
      <div v-if="pushMessage" class="notify-note" :class="{ warn: pushState === 'blocked' || pushState === 'error' }">{{ pushMessage }}</div>
      <div v-if="pushState === 'blocked' || pushState === 'error'" class="notify-actions">
        <button type="button" class="notify-mini" @click="reloadPage">↻ Reload page</button>
      </div>
      <div class="notify-note">On iPhone, tap Share → Add to Home Screen first to enable notifications.</div>
      <div v-if="todayAnnouncements.length === 0" class="announce-empty">No announcements today.</div>
      <div v-for="a in todayAnnouncements" :key="a.id" class="announce-card">
        <span class="announce-cat">{{ a.category || 'general' }}</span>
        <span class="announce-msg">{{ a.message }}</span>
        <span class="announce-time">{{ a.created_at ? String(a.created_at).replace('T', ' ').slice(11, 16) : '' }}</span>
      </div>
    </section>

    <footer class="board-footer">
      <span>SmartTerminal · Schedule Enforcement &amp; Passenger Status Tracking</span>
      <span class="footer-right">Data refreshes automatically · <a href="/login" class="staff-link">Staff sign in</a></span>
    </footer>
  </div>
</template>

<style scoped>
.board-page {
  min-height: 100vh;
  width: 100%;
  background: linear-gradient(180deg, #0f172a 0%, #1e3a8a 100%);
  color: #fff;
  display: flex;
  flex-direction: column;
  padding: 1.5rem;
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
}

.board-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 1.5rem;
  margin-bottom: 1.5rem;
  border-bottom: 1px solid #334155;
  padding-bottom: 1rem;
}

.brand {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

.bus-icon {
  font-size: 2rem;
}

.brand-name {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0;
  color: #fff;
}

.brand-sub {
  font-size: 0.9rem;
  color: #94a3b8;
  margin: 0;
}

.clock-box {
  text-align: right;
}

.big-time {
  font-size: 3.5rem;
  font-weight: 800;
  letter-spacing: -1px;
  margin: 0;
  line-height: 1;
}

.updated {
  font-size: 0.875rem;
  color: #94a3b8;
  margin-top: 0.25rem;
}

table {
  width: 100%;
  border-collapse: collapse;
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 10px;
  overflow: auto;
  font-size: 0.95rem;
  margin-bottom: 1.5rem;
}

th, td {
  padding: 0.85rem 0.75rem;
  text-align: left;
  border-bottom: 1px solid #334155;
}

th {
  background: #0f172a;
  color: #fff;
  font-weight: 600;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

tr:nth-child(even) {
  background: #1e293b;
}

tr:hover {
  background: #26344d;
}

.strong {
  font-weight: 700;
  color: #fbbf24;
}

.badge {
  background: #3b82f6;
  color: #fff;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  font-size: 0.8rem;
}

.loading, .empty {
  text-align: center;
  padding: 3rem;
  color: #94a3b8;
}

.error {
  background: #7f1d1d;
  color: #fecaca;
  padding: 1rem;
  border-radius: 6px;
  margin-bottom: 1rem;
  font-size: 0.9rem;
}

.announce-section {
  margin-bottom: 1.5rem;
}

.announce-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 0.7rem;
}

.announce-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: #fbbf24;
}

.notify-wrap {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.notify-btn {
  background: #2563eb;
  color: #fff;
  border: 1px solid #3b82f6;
  padding: 0.55rem 0.95rem;
  border-radius: 8px;
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
  font-family: inherit;
}

.notify-btn:hover:not(:disabled) {
  background: #1d4ed8;
}

.notify-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.notify-on {
  background: #14532d;
  border: 1px solid #22c55e;
  color: #bbf7d0;
  padding: 0.5rem 0.9rem;
  border-radius: 8px;
  font-size: 0.95rem;
  font-weight: 700;
}

.notify-note {
  font-size: 0.8rem;
  color: #94a3b8;
  margin-bottom: 0.5rem;
}

.notify-note.warn {
  color: #fcd34d;
}

.notify-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin: -0.2rem 0 0.6rem;
}

.notify-mini {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid #475569;
  color: #e2e8f0;
  padding: 0.35rem 0.7rem;
  border-radius: 7px;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
  text-decoration: none;
  font-family: inherit;
}

.notify-mini:hover {
  background: rgba(255, 255, 255, 0.16);
}

.announce-empty {
  text-align: center;
  padding: 1.5rem;
  color: #94a3b8;
  border: 1px dashed #334155;
  border-radius: 10px;
}

.announce-card {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  background: #1e293b;
  border: 1px solid #334155;
  border-left: 4px solid #fbbf24;
  border-radius: 10px;
  padding: 0.85rem 1rem;
  margin-bottom: 0.6rem;
}

.announce-cat {
  background: #fbbf24;
  color: #111;
  font-size: 0.75rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  flex-shrink: 0;
}

.announce-msg {
  flex: 1;
  font-size: 1rem;
  color: #fff;
}

.announce-time {
  color: #94a3b8;
  font-size: 0.85rem;
  flex-shrink: 0;
}

.board-footer {
  margin-top: auto;
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
  color: #94a3b8;
  padding-top: 1rem;
  border-top: 1px solid #334155;
}

.footer-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.staff-link {
  color: #3b82f6;
  text-decoration: none;
  font-size: 0.85rem;
}

.staff-link:hover {
  text-decoration: underline;
}

@media (max-width: 768px) {
  .board-header {
    flex-direction: column;
    align-items: stretch;
  }
  .clock-box {
    text-align: left;
  }
  .big-time {
    font-size: 2.5rem;
  }
  table {
    font-size: 0.8rem;
  }
  th, td {
    padding: 0.6rem 0.4rem;
  }
}
</style>
