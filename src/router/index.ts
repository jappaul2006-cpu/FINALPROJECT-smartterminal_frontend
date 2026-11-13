import { createRouter, createWebHistory } from 'vue-router'

// Lazy-load views: each admin interface is its own chunk so the
// initial bundle stays small and switching tabs downloads only
// the code it needs. This makes first paint + navigation faster
// than statically importing every view up front.
const LoginView = () => import('../views/LoginView.vue')
const DashboardView = () => import('../views/DashboardView.vue')
const RoutesView = () => import('../views/RoutesView.vue')
const TripsView = () => import('../views/TripsView.vue')
const VehiclesView = () => import('../views/VehiclesView.vue')
const DriversView = () => import('../views/DriversView.vue')
const DispatchQueueView = () => import('../views/DispatchQueueView.vue')
const TicketsView = () => import('../views/TicketsView.vue')
const ScanView = () => import('../views/ScanView.vue')
const FleetView = () => import('../views/FleetView.vue')
const AnnouncementsView = () => import('../views/AnnouncementsView.vue')
const PassengerCountsView = () => import('../views/PassengerCountsView.vue')
const UsersView = () => import('../views/UsersView.vue')
const PassengerDisplayView = () => import('../views/PassengerDisplayView.vue')
const DriverView = () => import('../views/DriverView.vue')
const ReportsView = () => import('../views/ReportsView.vue')
const NotificationsView = () => import('../views/NotificationsView.vue')
const ScheduleOverridesView = () => import('../views/ScheduleOverridesView.vue')

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: LoginView, meta: { public: true } },
    { path: '/login', name: 'login', component: LoginView, meta: { public: true } },
    // Public live board for terminal TV/monitor (no login required)
    { path: '/passenger-display', name: 'passengerDisplay', component: PassengerDisplayView, meta: { public: true } },
    { path: '/dashboard', name: 'dashboard', component: DashboardView, meta: { roles: ['admin', 'dispatcher', 'driver'] } },
    { path: '/routes', name: 'routes', component: RoutesView, meta: { roles: ['admin', 'dispatcher'] } },
    { path: '/trips', name: 'trips', component: TripsView, meta: { roles: ['admin', 'dispatcher', 'driver'] } },
    { path: '/vehicles', name: 'vehicles', component: VehiclesView, meta: { roles: ['admin', 'dispatcher'] } },
    { path: '/drivers', name: 'drivers', component: DriversView, meta: { roles: ['admin', 'dispatcher'] } },
    { path: '/dispatch-queue', name: 'dispatchQueue', component: DispatchQueueView, meta: { roles: ['admin', 'dispatcher', 'driver'] } },
    { path: '/driver', name: 'driver', component: DriverView, meta: { roles: ['driver', 'admin'] } },
    { path: '/tickets', name: 'tickets', component: TicketsView, meta: { roles: ['admin', 'dispatcher', 'driver'] } },
    { path: '/scan', name: 'scan', component: ScanView, meta: { roles: ['admin', 'dispatcher', 'driver'] } },
    { path: '/fleet', name: 'fleet', component: FleetView, meta: { roles: ['admin', 'dispatcher'] } },
    { path: '/announcements', name: 'announcements', component: AnnouncementsView, meta: { roles: ['admin', 'dispatcher'] } },
    { path: '/passenger-counts', name: 'passengerCounts', component: PassengerCountsView, meta: { roles: ['admin', 'dispatcher'] } },
    { path: '/users', name: 'users', component: UsersView, meta: { roles: ['admin'] } },
    { path: '/notifications', name: 'notifications', component: NotificationsView, meta: { roles: ['admin', 'dispatcher', 'driver'] } },
    { path: '/schedule-overrides', name: 'scheduleOverrides', component: ScheduleOverridesView, meta: { roles: ['admin', 'dispatcher'] } },
    { path: '/reports', name: 'reports', component: ReportsView, meta: { roles: ['admin', 'dispatcher'] } },
  ],
})

router.beforeEach((to) => {
  const raw = localStorage.getItem('st_user')
  const user = raw ? JSON.parse(raw) : null
  const isPublic = to.meta?.public === true
  if (isPublic) return true
  if (!user) return { path: '/login', query: { redirect: to.fullPath } }
  const roles = to.meta?.roles as string[] | undefined
  if (roles && roles.length > 0 && !roles.includes(user.role)) {
    const home = user.role === 'driver' ? '/driver' : user.role === 'dispatcher' ? '/dispatch-queue' : '/dashboard'
    return { path: home }
  }
  return true
})

router.afterEach((to) => {
  const map: Record<string, string> = {
    home: 'SmartTerminal — Home',
    login: 'SmartTerminal — Login',
    dashboard: 'Dashboard · SmartTerminal',
    dispatchQueue: 'Dispatch Queue · SmartTerminal',
    trips: 'Trips · SmartTerminal',
    tickets: 'QR Tickets · SmartTerminal',
    scan: 'Boarding Scanner · SmartTerminal',
    fleet: 'Fleet · SmartTerminal',
    users: 'User Accounts · SmartTerminal',
    announcements: 'Announcements · SmartTerminal',
    reports: 'Reports · SmartTerminal',
    passengerDisplay: 'SmartTerminal — Passenger Status Display',
    driver: 'SmartTerminal — Driver App',
  }
  document.title = map[to.name as string] || 'SmartTerminal'
})

export default router
