<script setup>
import { computed, ref, onBeforeUnmount, onMounted, watch } from 'vue'
import { RouterLink, RouterView, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useCatalogStore } from '@/stores/catalog'

const auth = useAuthStore()
const catalog = useCatalogStore()
const router = useRouter()
const showMenu = ref(false)
const userMenuRef = ref(null)

const isLoginPage = computed(() => {
  const path = router.currentRoute.value.path
  return path === '/login' || path === '/'
})

const isPublicBoard = computed(() => {
  const path = router.currentRoute.value.path
  return path === '/passenger-display'
})

const links = computed(() => {
  const common = [
    { to: '/dashboard', label: 'Dashboard', icon: '☷' },
    { to: '/dispatch-queue', label: 'Dispatch Queue', icon: '☰' },
    { to: '/trips', label: 'Trips', icon: '▣' },
    { to: '/tickets', label: 'QR Tickets', icon: '▦' },
    { to: '/fleet', label: 'Fleet', icon: '🚌' },
    // User management is admin-only; dispatchers get every other
    // admin function but never see this nav item.
    ...(auth.role === 'admin' ? [{ to: '/users', label: 'Users', icon: '👥' }] : []),
    { to: '/announcements', label: 'Announce', icon: '📢' },
    { to: '/reports', label: 'Reports', icon: '📈' },
  ]
  if (!auth.isLoggedIn) return []
  if (auth.role === 'driver') {
    return [
      { to: '/driver', label: 'My Trips', icon: '🚌' },
      { to: '/dashboard', label: 'Dashboard', icon: '☷' },
      { to: '/tickets', label: 'QR Tickets', icon: '▦' },
      { to: '/dispatch-queue', label: 'Dispatch Queue', icon: '☰' },
    ]
  }
  return common
})

const userName = computed(() => auth.user?.full_name || auth.user?.username || '')

async function onLogout() {
  showMenu.value = false
  await auth.logout()
  router.push('/login')
}

function closeMenu() { showMenu.value = false }
function toggleMenu() { showMenu.value = !showMenu.value }
function onDocClick(e) {
  if (showMenu.value && userMenuRef.value && !userMenuRef.value.contains(e.target)) showMenu.value = false
}

onBeforeUnmount(() => { document.removeEventListener('click', onDocClick) })

// Warm the shared cache the moment the admin is authenticated so the
// first table renders instantly. Runs after login and on page load
// when a session already exists — never blocks the UI.
onMounted(() => {
  document.addEventListener('click', onDocClick)
  if (auth.isLoggedIn) catalog.prefetchReference()
})
watch(() => auth.isLoggedIn, (v) => { if (v) catalog.prefetchReference() })
</script>

<template>
  <div class="app" :class="{ bare: isLoginPage || isPublicBoard }">
    <header v-if="!isLoginPage && !isPublicBoard" class="topbar">
      <div class="topbar-inner">
        <RouterLink to="/dashboard" class="brand">
          <span class="brand-badge">🚌</span>
          <span class="brand-name">Smart<span class="brand-or">Terminal</span></span>
        </RouterLink>
        <nav class="topnav">
          <RouterLink v-for="l in links" :key="l.to" :to="l.to" class="nav-item">
            <span class="nav-icon">{{ l.icon }}</span>{{ l.label }}
          </RouterLink>
        </nav>
        <div class="top-actions">
          <RouterLink to="/passenger-display" class="btn-outline">▭ Passenger Screen</RouterLink>
          <div v-if="auth.isLoggedIn" ref="userMenuRef" class="user-menu">
            <button type="button" class="user-btn" @click="toggleMenu">
              <span class="user-avatar">👤</span><span class="user-name">{{ userName }}</span><span class="caret">▾</span>
            </button>
            <div v-if="showMenu" class="dropdown">
              <div class="dropdown-head">{{ userName }}<small>{{ auth.role }}</small></div>
              <button type="button" class="dropdown-item" @click="onLogout">Logout</button>
            </div>
          </div>
        </div>
      </div>
    </header>
    <main :class="{ 'full-bleed': isLoginPage || isPublicBoard }">
      <RouterView />
    </main>
  </div>
</template>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; background: #eef2f7; color: #1e293b; font-size: 17.5px; }
.app { min-height: 100vh; display: flex; flex-direction: column; }
.app.bare main { padding: 0; }
main { padding: 0; flex: 1; width: 100%; }

/* Header: reference layout - full-width bar, brand+nav left, actions right */
.topbar { background: #0c2a4b; color: #fff; box-shadow: 0 1px 4px rgba(15,23,42,.3); position: sticky; top: 0; z-index: 100; }
.topbar-inner { max-width: none; width: 100%; margin: 0; padding: 0 1.25rem; display: flex; align-items: center; gap: 1rem; flex-wrap: nowrap; min-height: 68px; }
.brand { display: flex; align-items: center; gap: .55rem; text-decoration: none; color: #fff; font-weight: 800; font-size: 1.35rem; letter-spacing: .01em; white-space: nowrap; flex-shrink: 0; }
.brand-badge { background: #fbbf24; color: #111; border-radius: 8px; padding: .3rem .4rem; font-size: 1.2rem; line-height: 1; }
.brand-or { color: #f59e0b; }
.topnav { display: flex; align-items: center; gap: .25rem; flex-wrap: nowrap; flex: 1; overflow-x: auto; scrollbar-width: none; -ms-overflow-style: none; padding: .25rem 0; }
.topnav::-webkit-scrollbar { display: none; }
.nav-item { color: #dbeafe; text-decoration: none; padding: .7rem .85rem; border-radius: 8px; font-size: 1.05rem; font-weight: 600; white-space: nowrap; flex-shrink: 0; line-height: 1.2; }
.nav-item:hover { background: rgba(255,255,255,.12); color: #fff; }
.nav-item.router-link-active { background: rgba(255,255,255,.16); color: #fff; font-weight: 700; }
.nav-icon { margin-right: .4rem; opacity: .95; font-size: 1.05rem; }
.top-actions { display: flex; align-items: center; gap: .7rem; margin-left: auto; flex-shrink: 0; }
.btn-outline { color: #fff; border: 1.5px solid rgba(255,255,255,.7); text-decoration: none; padding: .6rem 1rem; border-radius: 8px; font-size: 1rem; font-weight: 700; white-space: nowrap; flex-shrink: 0; }
.btn-outline:hover { background: rgba(255,255,255,.12); }
.user-menu { position: relative; flex-shrink: 0; }
.user-btn { background: #fff; color: #111827; border: none; border-radius: 8px; padding: .6rem .9rem; cursor: pointer; font-size: 1rem; font-weight: 700; display: flex; align-items: center; gap: .45rem; white-space: nowrap; box-shadow: 0 1px 3px rgba(0,0,0,.2); }
.user-name { max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.user-avatar { font-size: 1.05rem; }
.caret { font-size: .8rem; }
.dropdown { position: absolute; right: 0; top: calc(100% + 8px); background: #fff; color: #111827; border-radius: 10px; box-shadow: 0 12px 28px rgba(0,0,0,.22); width: 230px; overflow: hidden; z-index: 200; border: 1px solid #e5e7eb; }
.dropdown-head { padding: .75rem .95rem; border-bottom: 1px solid #e5e7eb; font-size: 1rem; font-weight: 700; word-break: break-word; line-height: 1.3; }
.dropdown-head small { display: block; color: #6b7280; font-weight: 500; text-transform: capitalize; font-size: .85rem; margin-top: .1rem; }
.dropdown-item { width: 100%; text-align: left; background: none; border: none; padding: .7rem .95rem; cursor: pointer; font-size: 1rem; font-weight: 600; }
.dropdown-item:hover { background: #f1f5f9; }

/* Page: larger container - uses screen without overstretching tables */
.page { max-width: 1720px; width: 100%; margin: 0 auto; padding: 1.75rem 1.75rem 2.25rem; }
.page-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: 1.25rem; flex-wrap: wrap; }
.page-title { font-size: 2.25rem; font-weight: 800; color: #0f172a; line-height: 1.15; letter-spacing: -.015em; }
.page-sub { color: #475569; font-size: 1.12rem; margin-top: .4rem; }
.card { background: #fff; border: 1px solid #dbe3ee; border-radius: 14px; box-shadow: 0 1px 4px rgba(15,23,42,.06); overflow: hidden; }
.card-head { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.3rem; border-bottom: 1px solid #eef2f7; }
.card-title { font-size: 1.25rem; font-weight: 800; color: #0f172a; }
.card-title span { margin-right: .45rem; }
.pill { font-size: .95rem; font-weight: 700; padding: .3rem .7rem; border-radius: 999px; background: #dcfce7; color: #15803d; }
table.data { width: 100%; border-collapse: collapse; table-layout: auto; }
table.data th { text-align: left; font-size: .92rem; letter-spacing: .04em; text-transform: uppercase; color: #475569; font-weight: 800; padding: .9rem 1.25rem; background: #f1f5f9; border-bottom: 2px solid #e2e8f0; white-space: nowrap; }
table.data td { padding: .95rem 1.25rem; border-bottom: 1px solid #eef2f7; font-size: 1.1rem; line-height: 1.5; color: #1e293b; vertical-align: middle; }
table.data tr:hover td { background: #f8fafc; }
table.data tr:last-child td { border-bottom: none; }
.badge { display: inline-block; font-size: .95rem; font-weight: 800; padding: .32rem .7rem; border-radius: 7px; color: #fff; }
.badge-blue { background: #2563eb; }
.badge-green { background: #16a34a; }
.badge-yellow { background: #eab308; color: #111; }
.badge-gray { background: #64748b; }
.badge-black { background: #111827; }
.badge-light { background: #e2e8f0; color: #334155; }
.btn-yellow { background: #fbbf24; color: #111827; border: none; padding: .8rem 1.25rem; border-radius: 9px; font-weight: 800; cursor: pointer; font-size: 1.05rem; }
.btn-yellow:hover { background: #f59e0b; }
.btn-dark { background: #111827; color: #fff; border: none; padding: .8rem 1.25rem; border-radius: 9px; font-weight: 700; cursor: pointer; font-size: 1.05rem; }
.btn-ghost { background: #fff; border: 1px solid #94a3b8; color: #1e293b; padding: .72rem 1.1rem; border-radius: 9px; cursor: pointer; font-weight: 700; font-size: 1.02rem; }
.icon-btn { width: 44px; height: 44px; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer; font-size: 1.1rem; display: inline-flex; align-items: center; justify-content: center; }
.icon-btn:hover { background: #f8fafc; }
.icon-btn.yellow { border-color: #fbbf24; color: #d97706; background: #fffbeb; }
.icon-btn.green { border-color: #16a34a; color: #16a34a; background: #f0fdf4; }
.icon-btn.red { border-color: #fca5a5; color: #dc2626; background: #fef2f2; }
.field label { font-size: 1rem; font-weight: 700; color: #334155; display: block; margin-bottom: .4rem; }
.field input, .field select, .field textarea { width: 100%; padding: .75rem .9rem; border: 1px solid #94a3b8; border-radius: 9px; font-size: 1.1rem; box-sizing: border-box; }
.modal-overlay { position: fixed; inset: 0; background: rgba(15,23,42,.45); display: flex; align-items: flex-start; justify-content: center; padding: 5vh 1rem 1rem; z-index: 100; }
.modal { background: #fff; border-radius: 12px; width: 100%; max-width: 620px; max-height: 88vh; overflow: auto; box-shadow: 0 20px 50px rgba(0,0,0,.3); }
.modal-head { display: flex; justify-content: space-between; align-items: center; padding: 1.1rem 1.3rem; border-bottom: 1px solid #eef2f7; font-weight: 800; font-size: 1.2rem; }
.modal-close { background: none; border: none; font-size: 1.4rem; cursor: pointer; color: #64748b; }
.modal-body { padding: 1.3rem; }
.modal-foot { display: flex; justify-content: flex-end; gap: .6rem; padding: 1.1rem 1.3rem; border-top: 1px solid #eef2f7; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
.form-grid .full { grid-column: 1 / -1; }
.toast-wrap { position: fixed; right: 1rem; bottom: 1rem; z-index: 200; display: flex; flex-direction: column; gap: .5rem; }
.toast { background: #0f172a; color: #fff; padding: .85rem 1.1rem; border-radius: 9px; font-size: 1.05rem; box-shadow: 0 8px 20px rgba(0,0,0,.3); border-left: 4px solid #22c55e; }
.empty-box { padding: 2.5rem 1rem; text-align: center; color: #475569; font-size: 1.1rem; }
.muted { color: #475569; font-size: 1rem; }
.error-bar { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; padding: .8rem 1.1rem; border-radius: 9px; margin-bottom: .9rem; font-size: 1.02rem; }
.info-bar { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; padding: .75rem 1.1rem; border-radius: 9px; margin-bottom: .9rem; font-size: 1rem; }

/* Dashboard/stats: big numbers, full-width grids */
.stat-grid { display: grid; grid-template-columns: repeat(5,1fr); gap: 1.1rem; margin-bottom: 1.1rem; }
.stat-grid5 { display: grid !important; grid-template-columns: repeat(5,1fr) !important; gap: 1.1rem !important; margin-bottom: 1.1rem !important; }
.stat-card { padding: 1.35rem 1.45rem !important; }
.stat-label { font-size: .95rem !important; font-weight: 800 !important; letter-spacing: .04em; }
.stat-value { font-size: 2.9rem !important; line-height: 1.1 !important; }
.stat-ico { width: 52px !important; height: 52px !important; font-size: 1.5rem !important; }
.two-col { display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 1.1rem !important; }
.queue-row, .trip-row { padding: 1rem 1.3rem !important; font-size: 1.1rem; }
.queue-num { width: 46px !important; height: 46px !important; font-size: 1.2rem !important; }
.qnum { width: 44px !important; height: 44px !important; font-size: 1.15rem !important; }
.bar-chart { min-height: 240px !important; }
.donut { width: 280px !important; height: 280px !important; }

/* Secondary list views: same balanced shell */
.list-view { max-width: 1720px !important; width: 100% !important; margin: 0 auto !important; padding: 1.75rem 1.75rem 2.25rem !important; }
.list-view h1 { font-size: 2.25rem !important; }
.list-view td, .list-view th { font-size: 1.1rem !important; padding: .95rem 1.25rem !important; }

.filter-row { margin-bottom: 1.1rem !important; }
.filter-grid { margin-bottom: 1.1rem !important; }
.filter-field label, .filter-grid label { font-size: 1rem !important; font-weight: 700; color: #334155; display: block; margin-bottom: .4rem; }
.filter-field input, .filter-field select { font-size: 1.08rem !important; padding: .7rem .9rem !important; border: 1px solid #94a3b8; border-radius: 9px; background: #fff; min-width: 180px; }

@media (max-width: 1100px) {
  .stat-grid, .stat-grid5 { grid-template-columns: repeat(3,1fr) !important; }
}
@media (max-width: 900px) {
  .stat-grid, .stat-grid5 { grid-template-columns: repeat(2,1fr) !important; }
  .two-col { grid-template-columns: 1fr !important; }
  .topbar-inner { padding: 0 .75rem; gap: .5rem; }
  .brand-name { font-size: 1.05rem; }
  .nav-item { padding: .55rem .6rem; font-size: .9rem; }
  .page, .list-view { padding: .9rem .9rem 1.25rem !important; }
  .page-title, .list-view h1 { font-size: 1.5rem !important; }
}

@media print {
  .topbar, .toast-wrap, .top-actions { display: none !important; }
  .page { padding: 0 !important; }
  .card { box-shadow: none !important; break-inside: avoid; }
}
</style>
