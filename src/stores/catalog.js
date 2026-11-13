import { reactive } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/api'

// Central catalog cache for SmartTerminal reference data.
// Problem: every admin view re-fetched vehicles/drivers/routes/trips/
// dispatch-queue/... independently, so each navigation paid 4-8 HTTP
// round-trips to the remote Aiven MySQL (50-300ms each) and the UI
// showed a blank "Loading..." until Promise.all finished.
//
// This store adds:
//  - in-memory cache (per session, SPA navigation = instant)
//  - sessionStorage persistence (survives F5 / tab reload)
//  - TTL per resource (live data short, reference data long)
//  - in-flight deduplication (concurrent views share one request)
//  - stale-while-revalidate: return stale data instantly, refresh
//    in the background for the next visit
//  - invalidation API so mutations trigger a fresh fetch once

const LOADERS = {
  vehicles:           { path: '/api/vehicles',           ttl: 60_000 },
  drivers:            { path: '/api/drivers',            ttl: 60_000 },
  routes:             { path: '/api/routes',             ttl: 60_000 },
  trips:              { path: '/api/trips',              ttl: 15_000 },
  dispatchQueue:      { path: '/api/dispatch-queue',     ttl: 10_000 },
  passengerCounts:    { path: '/api/passenger-counts',   ttl: 10_000 },
  users:              { path: '/api/users',              ttl: 30_000 },
  announcements:      { path: '/api/announcements',      ttl: 15_000 },
  tickets:            { path: '/api/tickets',            ttl: 10_000 },
  scheduleOverrides:  { path: '/api/schedule-overrides', ttl: 30_000 },
  adherence:          { path: '/api/reports/adherence',  ttl: 30_000 },
  tripHistory:        { path: '/api/reports/trip-history', ttl: 30_000 },
  dailyVolume:        { path: '/api/reports/daily-volume', ttl: 30_000 },
  passengerStatus:    { path: '/api/passenger-status',   ttl: 5_000 },
}

const STORAGE_PREFIX = 'st_catalog:'

function readSessionCache(key) {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !('data' in parsed)) return null
    return parsed // { data, at }
  } catch (_) {
    return null
  }
}

function writeSessionCache(key, data) {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify({ data, at: Date.now() }))
  } catch (_) {
    // storage full / private mode — memory cache still works
  }
}

export const useCatalogStore = defineStore('catalog', () => {
  // key -> { data, at }
  const cache = reactive({})
  const inflight = new Map()

  function getEntry(key) {
    if (cache[key]) return cache[key]
    const fromSession = readSessionCache(key)
    if (fromSession) {
      cache[key] = fromSession
      return fromSession
    }
    return null
  }

  function setEntry(key, data) {
    const entry = { data, at: Date.now() }
    cache[key] = entry
    writeSessionCache(key, data)
    return entry
  }

  function isFresh(entry, ttlMs) {
    return !!entry && (Date.now() - entry.at) < ttlMs
  }

  /**
   * fetch(key, { force }) -> Promise<Array|Object>
   *
   * - fresh cache hit: resolve immediately, no network.
   * - stale cache hit: resolve immediately with stale data,
   *   background-refresh the cache for the next caller.
   * - cache miss / force: network request (deduplicated).
   */
  async function fetch(key, options = {}) {
    const cfg = LOADERS[key]
    if (!cfg) throw new Error(`[catalog] unknown key: ${key}`)
    const { force = false } = options
    const ttlMs = options.ttl ?? cfg.ttl

    const entry = getEntry(key)
    if (!force && isFresh(entry, ttlMs)) return entry.data

    // Dedupe concurrent requests for the same key.
    if (inflight.has(key) && !force) {
      if (entry && !isFresh(entry, ttlMs)) {
        // stale hit: return stale now, the in-flight refresh
        // will update the cache for the next caller.
        return entry.data
      }
      return inflight.get(key)
    }

    const p = api
      .get(cfg.path, force ? { params: { _fresh: 1 } } : undefined)
      .then((res) => {
        const data = res.data?.data ?? []
        setEntry(key, data)
        return data
      })
      .catch((err) => {
        // Keep showing stale data on transient failure instead
        // of blank/erroring the whole admin page.
        const stale = getEntry(key)
        if (stale) return stale.data
        throw err
      })
      .finally(() => {
        inflight.delete(key)
      })

    inflight.set(key, p)

    if (!force && entry && !isFresh(entry, ttlMs)) {
      // Stale-while-revalidate: don't block the UI on the network.
      p.catch(() => {})
      return entry.data
    }
    return p
  }

  async function fetchMany(keys, options = {}) {
    // Promise.all with dedupe inside fetch() — still parallel,
    // but each key is served from cache when hot.
    const results = await Promise.all(keys.map((k) => fetch(k, options)))
    const out = {}
    keys.forEach((k, i) => { out[k] = results[i] })
    return out
  }

  function invalidate(...keys) {
    keys.forEach((k) => {
      delete cache[k]
      try { sessionStorage.removeItem(STORAGE_PREFIX + k) } catch (_) {}
    })
  }

  function invalidateAll() {
    Object.keys(cache).forEach((k) => { delete cache[k] })
    try {
      Object.keys(sessionStorage)
        .filter((k) => k.startsWith(STORAGE_PREFIX))
        .forEach((k) => sessionStorage.removeItem(k))
    } catch (_) {}
  }

  /** Warm the cache for the reference data used by almost every admin page. */
  async function prefetchReference() {
    try {
      await fetchMany(['vehicles', 'drivers', 'routes'])
    } catch (_) {}
  }

  return { cache, fetch, fetchMany, invalidate, invalidateAll, prefetchReference }
})
