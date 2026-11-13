import { fileURLToPath, URL } from 'node:url'
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { defineConfig, type Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

const PROXY_LOG = resolve(process.cwd(), '.onesignal-proxy.log')

/** Appends one line to the proxy log so the traffic can be inspected. */
function logProxy(line: string) {
  try {
    appendFileSync(PROXY_LOG, `${new Date().toISOString()} ${line}\n`, 'utf8')
  } catch (_) {
    /* logging must never break the proxy */
  }
}

/**
 * Flags every push subscription in a OneSignal payload as enabled.
 *
 * The web SDK creates the subscription without the "enabled" flag, so
 * OneSignal keeps the player out of every segment and broadcasts to
 * "Subscribed Users" never reach it. Adding the flag on the way through
 * the proxy fixes it for every browser, without touching the SDK itself.
 */
function enableSubscriptions(body: Buffer): Buffer {
  if (!body.length) return body
  let payload: any
  try {
    payload = JSON.parse(body.toString('utf8'))
  } catch {
    return body
  }

  let changed = false
  const fix = (subscription: any) => {
    if (!subscription || typeof subscription !== 'object') return
    if (!subscription.token) return
    if (subscription.enabled === undefined) { subscription.enabled = true; changed = true }
    if (subscription.notification_types === undefined) { subscription.notification_types = 1; changed = true }
    if (subscription.opted_in === undefined) { subscription.opted_in = true; changed = true }
  }

  const walk = (node: any) => {
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (!node || typeof node !== 'object') return
    if (node.token && node.type) fix(node)
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') walk(value)
    }
  }
  walk(payload)

  if (!changed) return body
  logProxy(`   (proxy) flagged the subscription as enabled/subscribed`)
  return Buffer.from(JSON.stringify(payload), 'utf8') as Buffer
}

/**
 * First-party proxy for the OneSignal API.
 *
 * The OneSignal SDK hardcodes https://api.onesignal.com/ and loads the app
 * configuration with a JSONP script request. Brave Shields, uBlock and
 * friends block that domain, which makes OneSignal.init() sit there until
 * it times out - so push notifications never work in those browsers.
 *
 * This middleware forwards /onesignal-api/* to the real OneSignal API from
 * the server, so the browser only ever talks to our own origin and no
 * blocker can get in the way.
 *
 *   /onesignal-api/sync/<appId>/web -> https://api.onesignal.com/sync/...
 *   /onesignal-api/v1/*             -> https://onesignal.com/api/v1/...
 */
function onesignalApiProxy(): Plugin {
  return {
    name: 'smartterminal-onesignal-api-proxy',
    configureServer(server) {
      server.middlewares.use(
        '/onesignal-api',
        async (req: IncomingMessage, res: ServerResponse) => {
        const path = req.url || '/'

        // Health check used by the frontend to find out whether the proxy
        // is available before pointing the SDK at it.
        if (path.startsWith('/__health')) {
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true }))
          return
        }

        const target = path.startsWith('/v1/')
          ? `https://onesignal.com/api/v1${path.slice(3)}`
          : `https://api.onesignal.com${path}`

        try {
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          const rawBody = Buffer.concat(chunks)

          // The OneSignal web SDK registers the browser subscription without
          // flagging it as enabled. OneSignal then keeps the player out of
          // every segment ("Subscribed Users"), so broadcasts never reach it.
          // Mark every subscription as enabled/subscribed on the way through.
          const body = enableSubscriptions(rawBody)

          const headers: Record<string, string> = {}
          const contentTypeHeader = req.headers['content-type']
          const authorizationHeader = req.headers['authorization']
          const subscriptionHeader = req.headers['onesignal-subscription-id']
          if (contentTypeHeader) headers['content-type'] = String(contentTypeHeader)
          if (authorizationHeader) headers['authorization'] = String(authorizationHeader)
          if (subscriptionHeader) headers['onesignal-subscription-id'] = String(subscriptionHeader)

          const upstream = await fetch(target, {
            method: req.method,
            headers,
            body:
              req.method === 'GET' || req.method === 'HEAD' || !body.length
                ? undefined
                : body.toString('utf8'),
          })

          const responseBody = Buffer.from(await upstream.arrayBuffer())
          logProxy(
            `${req.method} ${path} -> ${target} : HTTP ${upstream.status} ` +
              `${String(responseBody.toString('utf8')).slice(0, 400).replace(/\s+/g, ' ')}`
          )
          if (body.length) {
            logProxy(`   REQUEST BODY: ${body.toString('utf8').slice(0, 1200).replace(/\s+/g, ' ')}`)
          }

          res.statusCode = upstream.status
          const contentType = upstream.headers.get('content-type')
          if (contentType) res.setHeader('Content-Type', contentType)
          res.end(responseBody)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          logProxy(`${req.method} ${path} -> ${target} : FAILED ${message}`)
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: `OneSignal proxy failed: ${message}` }))
        }
        }
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    onesignalApiProxy(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/vue') || id.includes('node_modules/pinia') || id.includes('node_modules/axios')) {
            return 'vendor'
          }
        },
      },
    },
  },
  server: {
    // Listen on all interfaces (not just IPv6 ::1) so the dev server is
    // reachable through http://127.0.0.1:5173 and through an ngrok tunnel.
    host: true,
    // KeepAlive helps repeated API calls to the PHP backend reuse the
    // TCP/TLS connection instead of reopening it per request.
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
