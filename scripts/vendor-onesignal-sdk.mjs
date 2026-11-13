/**
 * Downloads the OneSignal v16 web SDK and writes it into public/.
 *
 * The SDK is hosted on our own origin because ad blockers (Brave Shields,
 * uBlock, ...) block cdn.onesignal.com. The bundle is patched in one place
 * so the API base URL can be pointed at a first-party proxy - the SDK
 * otherwise hardcodes https://api.onesignal.com/ and cannot be talked into
 * using another host.
 *
 * Usage: node scripts/vendor-onesignal-sdk.mjs
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(here, '..', 'public')

const FILES = [
  {
    url: 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.es6.js',
    name: 'OneSignalSDK.page.es6.js',
  },
  {
    url: 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js',
    name: 'OneSignalSDK.sw.js',
  },
]

// The SDK builds every API URL from this expression.
//   - page bundle: window.__ONESIGNAL_API_BASE__ is set by the frontend when
//     the first-party proxy is available, otherwise the real URLs are used.
//   - service worker: it runs without a window, so it derives the proxy from
//     its own origin (the worker is always served from the app origin).
const PAGE_ORIGINAL = 'U=({action:t,legacy:e=!1}={})=>new URL(e?"https://onesignal.com/api/v1/":"https://api.onesignal.com/")'
const PAGE_PATCHED =
  'U=({action:t,legacy:e=!1}={})=>new URL(window.__ONESIGNAL_API_BASE__?' +
  '(e?window.__ONESIGNAL_API_BASE__+"v1/":window.__ONESIGNAL_API_BASE__):' +
  '(e?"https://onesignal.com/api/v1/":"https://api.onesignal.com/"))'

const WORKER_ORIGINAL =
  '(({action:t,legacy:e=!1}={})=>new URL(e?"https://onesignal.com/api/v1/":"https://api.onesignal.com/"))'
const WORKER_PATCHED =
  '(({action:t,legacy:e=!1}={})=>new URL(self.location.origin+"/onesignal-api/"+(e?"v1/":"")))'

async function download(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`GET ${url} -> HTTP ${response.status}`)
  return response.text()
}

await mkdir(publicDir, { recursive: true })

for (const file of FILES) {
  let body = await download(file.url)

  if (file.name.endsWith('.page.es6.js')) {
    if (!body.includes(PAGE_ORIGINAL)) {
      throw new Error(
        'Could not find the OneSignal API base URL in the SDK bundle. ' +
          'The SDK changed - update the patch in scripts/vendor-onesignal-sdk.mjs.'
      )
    }
    body = body.replace(PAGE_ORIGINAL, PAGE_PATCHED)
    console.log(`patched API base URL in ${file.name}`)
  }

  if (file.name.endsWith('.sw.js')) {
    if (!body.includes(WORKER_ORIGINAL)) {
      throw new Error(
        'Could not find the OneSignal API base URL in the service worker. ' +
          'The SDK changed - update the patch in scripts/vendor-onesignal-sdk.mjs.'
      )
    }
    body = body.replace(WORKER_ORIGINAL, WORKER_PATCHED)
    console.log(`patched API base URL in ${file.name}`)
  }

  await writeFile(resolve(publicDir, file.name), body, 'utf8')
  console.log(`wrote public/${file.name} (${body.length} bytes)`)
}

console.log('Done.')
