/**
 * OneSignal Web Push (v16) integration.
 *
 * The passenger display board (/passenger-display) is public and anonymous:
 * there are no passenger accounts, so nobody is signed in and no
 * OneSignal.login() call is made. Passengers opt in through the browser's
 * native permission prompt (our own "Notify me" button) and the backend
 * broadcasts announcements to the "Subscribed Users" segment.
 *
 * The SDK script is injected on demand, so it is only downloaded when the
 * passenger board is opened. Staff pages never load it.
 *
 * Note: only the OneSignal App ID lives in the frontend. The REST API key
 * is backend-only and must never be bundled into the frontend.
 */

const SDK_LOCAL_PATH = '/OneSignalSDK.page.es6.js'
const SDK_CDN_URL = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js'

// The SDK waits 60s for its service worker before giving up. We do not want
// the passenger board to sit on a spinner for a minute, so we stop waiting
// much earlier and show a helpful message instead.
const INIT_TIMEOUT_MS = 15000

const APP_ID = import.meta.env.VITE_ONESIGNAL_APP_ID

// The init state lives on the window, not in this module: a Vite hot reload
// re-evaluates the module (and resets module level variables) while the
// OneSignal SDK keeps its own "already initialized" flag. Calling
// OneSignal.init() twice makes the SDK throw "SDK already initialized".
const STATE_KEY = '__smartTerminalOneSignal'

function initState() {
  if (typeof window === 'undefined') return null
  if (!window[STATE_KEY]) {
    window[STATE_KEY] = { state: 'idle', promise: null, instance: null, error: null }
  }
  return window[STATE_KEY]
}

/** True when an App ID is configured (build-time env). */
export function oneSignalConfigured() {
  return !!APP_ID
}

/**
 * Adds a script tag and resolves once it has loaded.
 *
 * @param {string} src
 * @returns {Promise<string>}
 */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.defer = true
    script.async = true
    script.onload = () => resolve(src)
    script.onerror = () => reject(new Error(`Could not load ${src}`))
    document.head.appendChild(script)
  })
}

/**
 * Points the SDK at the first-party API proxy when one is available.
 *
 * The SDK normally talks to https://api.onesignal.com/ and fetches the app
 * configuration with a JSONP script request. Brave Shields, uBlock and
 * similar tools block that domain, and the SDK then waits for a request
 * that will never arrive. The proxy forwards the same calls from the
 * server, so the browser only talks to our own origin.
 *
 * The patched SDK bundle falls back to the real OneSignal URLs when
 * window.__ONESIGNAL_API_BASE__ is not set, so a missing proxy is harmless.
 */
async function enableApiProxy() {
  if (typeof window === 'undefined') return
  if (window.__ONESIGNAL_API_BASE__) return
  try {
    const response = await fetch('/onesignal-api/__health', { method: 'GET' })
    if (!response.ok) return
    // A SPA fallback (for example Vercel's catch-all rewrite) answers every
    // unknown path with index.html and a 200 status. Only trust the proxy
    // when the answer really is our JSON health payload - otherwise the SDK
    // would point at /onesignal-api/ and every sync call would return HTML.
    const payload = await response.json().catch(() => null)
    if (!payload || payload.ok !== true) return
    window.__ONESIGNAL_API_BASE__ = `${window.location.origin}/onesignal-api/`
    console.info('[OneSignal] using the first-party API proxy')
  } catch (_) {
    // No proxy (production without the PHP endpoint) - use OneSignal directly.
  }
}

/**
 * Loads the OneSignal v16 SDK (once) and initialises it.
 *
 * The SDK is served from /public so it keeps working when an ad blocker or
 * tracking protection blocks cdn.onesignal.com - the CDN copy is only used
 * as a fallback.
 *
 * @returns {Promise<object>} the OneSignal SDK instance
 */
export function initOneSignal() {
  if (!APP_ID) {
    return Promise.reject(new Error('VITE_ONESIGNAL_APP_ID is not configured'))
  }

  const state = initState()
  if (!state) return Promise.reject(new Error('No window available'))
  if (state.instance) return Promise.resolve(state.instance)
  if (state.promise) return state.promise
  if (state.state === 'failed') {
    return Promise.reject(new Error(state.error || 'OneSignal could not be initialised'))
  }

  state.state = 'pending'

  state.promise = enableApiProxy().then(() => new Promise((resolve, reject) => {
    // OneSignalDeferred is the queue the SDK picks up once it is ready.
    window.OneSignalDeferred = window.OneSignalDeferred || []
    window.OneSignalDeferred.push(async (OneSignal) => {
      let timer = null
      const timeout = new Promise((_, timeoutReject) => {
        timer = setTimeout(
          () => timeoutReject(new Error('OneSignal timed out while starting up')),
          INIT_TIMEOUT_MS
        )
      })
      try {
        await Promise.race([
          OneSignal.init({
            appId: APP_ID,
            // Development convenience: localhost counts as a secure origin.
            allowLocalhostAsSecureOrigin: true,
            // The passenger board renders its own "Notify me" button.
            notifyButton: { enable: false },
            // Served from /public/OneSignalSDKWorker.js
            serviceWorkerPath: '/OneSignalSDKWorker.js',
          }),
          timeout,
        ])
        state.instance = OneSignal
        state.state = 'done'
        resolve(OneSignal)
      } catch (err) {
        state.state = 'failed'
        state.error = String(err?.message || err)
        reject(err)
      } finally {
        clearTimeout(timer)
      }
    })

    // Local copy first, CDN as a fallback.
    loadScript(SDK_LOCAL_PATH)
      .catch(() => loadScript(SDK_CDN_URL))
      .catch((err) => {
        state.state = 'failed'
        state.error = String(err?.message || err)
        reject(err)
      })
  }))

  return state.promise
}

/**
 * Reads the current push permission / subscription state.
 *
 * OneSignal v16 reports the permission as a boolean (true = granted) while
 * older builds used the strings 'granted' | 'denied' | 'default', so both
 * shapes are normalised here.
 *
 * The native browser permission is checked as well: OneSignal only learns
 * that a visitor blocked the prompt after the fact, while
 * `Notification.permission` reports "denied" straight away.
 *
 * @param {object} OneSignal
 * @returns {Promise<{permission: string, nativePermission: string, optedIn: boolean, subscribed: boolean, blocked: boolean}>}
 */
export async function oneSignalStatus(OneSignal) {
  const raw = OneSignal?.Notifications?.permission
  const permission =
    raw === true || raw === 'granted'
      ? 'granted'
      : raw === 'denied'
        ? 'denied'
        : 'default'
  const nativePermission =
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  const optedIn = !!OneSignal?.User?.PushSubscription?.optedIn
  const subscriptionId = OneSignal?.User?.PushSubscription?.id ?? null

  // Is the OneSignal service worker alive? Without it the browser cannot
  // create a push subscription.
  let workerReady = false
  try {
    if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
      const registration = await navigator.serviceWorker.getRegistration('/')
      workerReady = !!registration
    }
  } catch (_) {
    workerReady = false
  }

  return {
    permission,
    nativePermission,
    optedIn,
    subscriptionId,
    workerReady,
    subscribed: permission === 'granted' && (optedIn || !!subscriptionId),
    blocked: permission === 'denied' || nativePermission === 'denied',
  }
}

/**
 * Asks the browser for notification permission and opts the visitor in to
 * the "Subscribed Users" segment.
 *
 * Must only be called from a user gesture (our button), never on page load.
 *
 * @param {object} OneSignal
 * @returns {Promise<{permission: string, subscribed: boolean}>}
 */
export async function requestPushPermission(OneSignal) {
  let lastError = null
  const subscription = OneSignal?.User?.PushSubscription

  try {
    // optIn() records the choice FIRST and then asks the browser for
    // permission. That order matters: the subscription that is created and
    // sent to the service worker then already carries the opt-in, so the
    // player lands in the "Subscribed Users" segment instead of
    // "Unsubscribed Users" - which is the segment the backend broadcasts to.
    if (subscription && typeof subscription.optIn === 'function') {
      await subscription.optIn()
    } else {
      await OneSignal.Notifications.requestPermission()
    }
  } catch (err) {
    // OneSignal could not open the prompt (for example the browser has the
    // permission blocked, or the SDK failed to register its worker). Fall
    // back to the native browser prompt so the visitor still gets the
    // Allow/Block choice.
    console.warn('[OneSignal] optIn failed, trying the native prompt:', err)
    lastError = err
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        await Notification.requestPermission()
      }
    } catch (nativeError) {
      console.warn('[OneSignal] native permission request failed:', nativeError)
    }
  }

  // Note: `PushSubscription.optedIn` is a read-only property of the SDK.
  // Assigning to it throws "Cannot set property optedIn" and achieves
  // nothing - optIn() above already persists the opt-in. Do not set it here.

  const status = await oneSignalStatus(OneSignal)
  status.error = lastError ? String(lastError?.message || lastError) : null
  return status
}

/**
 * Removes the browser push subscription and lets OneSignal create a new one.
 *
 * OneSignal only sends the subscription to the service worker when it
 * detects a change. If that message was lost (the worker could not reach
 * OneSignal, an ad blocker was in the way, ...) the subscription stays
 * registered locally but the player on OneSignal never gets a
 * "subscription" object - and the player then belongs to no segment, so
 * broadcasts to "Subscribed Users" never reach it.
 *
 * Forcing a new subscription makes the SDK notice the change and register
 * it again.
 *
 * @param {object} OneSignal
 * @returns {Promise<object>} the new status
 */
export async function resubscribePush(OneSignal) {
  try {
    const registration = await navigator.serviceWorker?.getRegistration?.()
    const subscription = await registration?.pushManager?.getSubscription?.()
    if (subscription) await subscription.unsubscribe()
  } catch (err) {
    console.warn('[OneSignal] could not remove the old push subscription:', err)
  }

  const subscription = OneSignal?.User?.PushSubscription
  if (subscription && typeof subscription.optIn === 'function') {
    await subscription.optIn()
  } else {
    await OneSignal.Notifications.requestPermission()
    await (subscription.optedIn = true)
  }

  return oneSignalStatus(OneSignal)
}

/**
 * Calls back whenever the visitor changes the permission in the browser.
 *
 * @param {object} OneSignal
 * @param {(status: object) => void} handler
 */
export function onPermissionChange(OneSignal, handler) {
  try {
    OneSignal?.Notifications?.addEventListener?.('permissionChange', async () => {
      handler(await oneSignalStatus(OneSignal))
    })
  } catch (err) {
    console.warn('[OneSignal] could not listen for permission changes:', err)
  }
}

