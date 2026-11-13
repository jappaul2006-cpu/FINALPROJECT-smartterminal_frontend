import { ref, onBeforeUnmount, getCurrentInstance } from 'vue'
import jsQR from 'jsqr'

// The QR decoder (jsQR) is pure JavaScript, so frames are downscaled before
// decoding - a ~720px wide frame is still very readable but far cheaper to
// scan than a full HD frame.
const MAX_DECODE_WIDTH = 720
const DECODE_INTERVAL_MS = 110
// The same ticket stays in front of the camera for a moment after a scan,
// so ignore repeats of the same code for a few seconds.
const DUPLICATE_WINDOW_MS = 4000

/**
 * Turns a getUserMedia error into something a dispatcher can act on.
 */
function describeError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Camera permission denied. Allow camera access for this site (camera icon in the address bar), then press Start camera again.'
    case 'SecurityError':
      return 'Camera blocked by the browser. The app must be served over HTTPS or from localhost.'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera was found on this device. Use manual entry or scan a photo of the QR code instead.'
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera is already in use by another application. Close it and try again.'
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'The selected camera is not available. Pick another camera and try again.'
    case 'AbortError':
      return 'The camera could not be started. Please try again.'
    case 'TypeError':
      return 'Camera access is unavailable here. Use HTTPS or open the app on localhost.'
    default:
      return err?.message
        ? `Camera error: ${err.message}`
        : 'Camera unavailable. Use manual entry or scan a photo of the QR code.'
  }
}

/**
 * A scanned QR payload may be the bare ticket code or a ticket URL that
 * carries the code in a query parameter.
 */
export function normalizeScannedValue(raw) {
  const value = String(raw ?? '').trim()
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      for (const key of ['code', 'qr', 'qr_code', 'ticket', 'ticket_code']) {
        const param = url.searchParams.get(key)
        if (param && param.trim()) return param.trim()
      }
    } catch {
      /* not a parseable URL - fall through */
    }
  }
  return value
}

/**
 * Camera based QR scanner.
 *
 * Uses the native camera through getUserMedia and decodes frames with jsQR,
 * so it works in every browser (the native BarcodeDetector API is missing on
 * most desktop browsers). It also supports scanning a saved image as a
 * fallback when no camera is available.
 */
export function useQrScanner({ onDetected = () => {} } = {}) {
  const videoRef = ref(null)
  const state = ref('idle') // idle | starting | live | error
  const message = ref('Camera not started.')
  const error = ref('')
  const devices = ref([])
  const selectedDeviceId = ref('')
  const torchSupported = ref(false)
  const torchOn = ref(false)
  const flash = ref(false)

  let stream = null
  let timerId = null
  let lastDecodeAt = 0
  let lastValue = ''
  let lastValueAt = 0
  let canvas = null
  let ctx = null

  function getContext() {
    if (!canvas) {
      canvas = document.createElement('canvas')
      ctx = canvas.getContext('2d', { willReadFrequently: true })
    }
    return ctx
  }

  function stopStream() {
    if (timerId) {
      clearTimeout(timerId)
      timerId = null
    }
    if (stream) {
      stream.getTracks().forEach((track) => {
        try {
          track.stop()
        } catch {
          /* ignore */
        }
      })
      stream = null
    }
    if (videoRef.value) videoRef.value.srcObject = null
    torchOn.value = false
  }

  function stop() {
    stopStream()
    state.value = 'idle'
    message.value = 'Camera stopped. Press Start camera to scan again.'
  }

  async function refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      devices.value = list
        .filter((d) => d.kind === 'videoinput')
        .map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }))
    } catch {
      /* device list is optional */
    }
  }

  function decodeFrame() {
    const video = videoRef.value
    if (!video || video.readyState < 2 || !video.videoWidth) return null
    const context = getContext()
    if (!context) return null

    const scale = Math.min(1, MAX_DECODE_WIDTH / video.videoWidth)
    const width = Math.round(video.videoWidth * scale)
    const height = Math.round(video.videoHeight * scale)
    if (!width || !height) return null

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    context.drawImage(video, 0, 0, width, height)

    let image
    try {
      image = context.getImageData(0, 0, width, height)
    } catch {
      return null
    }
    const found = jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' })
    return found?.data ? found.data : null
  }

  function startLoop() {
    if (timerId) clearTimeout(timerId)
    // A timer loop is used instead of requestAnimationFrame because rAF is
    // paused entirely while the tab is hidden, which would silently stop the
    // scanner. setTimeout keeps running (throttled) in the background.
    const tick = () => {
      if (!stream) return
      const now = Date.now()
      if (now - lastDecodeAt >= DECODE_INTERVAL_MS) {
        lastDecodeAt = now
        const raw = decodeFrame()
        if (raw) handleDetected(raw)
      }
      timerId = setTimeout(tick, DECODE_INTERVAL_MS)
    }
    timerId = setTimeout(tick, DECODE_INTERVAL_MS)
  }

  function handleDetected(raw) {
    const value = normalizeScannedValue(raw)
    if (!value) return
    const now = Date.now()
    if (value === lastValue && now - lastValueAt < DUPLICATE_WINDOW_MS) return
    lastValue = value
    lastValueAt = now
    flash.value = true
    window.setTimeout(() => {
      flash.value = false
    }, 700)
    onDetected(value)
  }

  async function start() {
    error.value = ''
    state.value = 'starting'
    message.value = 'Requesting camera access…'

    if (typeof window !== 'undefined' && !window.isSecureContext) {
      state.value = 'error'
      message.value = 'Camera blocked: open the app over HTTPS or on localhost.'
      error.value = describeError({ name: 'SecurityError' })
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      state.value = 'error'
      message.value = 'This browser does not expose camera access.'
      error.value = describeError({ name: 'NotFoundError' })
      return
    }

    // Try the picked camera first, then the rear camera, then any camera.
    const attempts = []
    if (selectedDeviceId.value) {
      attempts.push({ video: { deviceId: { exact: selectedDeviceId.value } }, audio: false })
    }
    attempts.push({ video: { facingMode: { ideal: 'environment' } }, audio: false })
    attempts.push({ video: true, audio: false })

    let failure = null
    for (const constraints of attempts) {
      try {
        stopStream()
        stream = await navigator.mediaDevices.getUserMedia(constraints)
        failure = null
        break
      } catch (err) {
        failure = err
        // A denied permission will not be re-prompted, so do not keep trying.
        if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') break
      }
    }

    if (failure || !stream) {
      stopStream()
      state.value = 'error'
      error.value = describeError(failure)
      message.value = 'Camera unavailable. Use manual entry or scan a photo of the QR code.'
      return
    }

    const video = videoRef.value
    if (video) {
      video.srcObject = stream
      // Not awaited: play() can stay pending (e.g. in a background tab) and
      // the decode loop starts decoding as soon as frames arrive anyway.
      const played = video.play()
      if (played && typeof played.catch === 'function') played.catch(() => {})
    }

    const track = stream.getVideoTracks()[0]
    const settings = track?.getSettings?.() || {}
    if (settings.deviceId) selectedDeviceId.value = settings.deviceId
    torchSupported.value = !!track?.getCapabilities?.().torch
    await refreshDevices()

    state.value = 'live'
    message.value = 'Camera live — point it at the passenger’s QR code.'
    startLoop()
  }

  async function toggleTorch() {
    const track = stream?.getVideoTracks?.()[0]
    if (!track) return
    try {
      torchOn.value = !torchOn.value
      await track.applyConstraints({ advanced: [{ torch: torchOn.value }] })
    } catch {
      torchOn.value = false
      error.value = 'This camera does not support the flashlight.'
    }
  }

  async function selectDevice(deviceId) {
    selectedDeviceId.value = deviceId || ''
    if (state.value === 'live') await start()
  }

  /**
   * Fallback path: decode a saved photo of the ticket instead of the camera.
   */
  function decodeFile(file) {
    return new Promise((resolve) => {
      if (!file) return resolve('')
      const reader = new FileReader()
      reader.onerror = () => resolve('')
      reader.onload = () => {
        const image = new Image()
        image.onerror = () => resolve('')
        image.onload = () => {
          const context = getContext()
          if (!context) return resolve('')
          const max = 1200
          const scale = Math.min(1, max / Math.max(image.width || 1, image.height || 1))
          const width = Math.max(1, Math.round((image.width || 1) * scale))
          const height = Math.max(1, Math.round((image.height || 1) * scale))
          canvas.width = width
          canvas.height = height
          context.drawImage(image, 0, 0, width, height)
          let data
          try {
            data = context.getImageData(0, 0, width, height)
          } catch {
            return resolve('')
          }
          const found = jsQR(data.data, width, height, { inversionAttempts: 'attemptBoth' })
          resolve(found?.data || '')
        }
        image.src = reader.result
      }
      reader.readAsDataURL(file)
    })
  }

  // Only register the teardown hook when used inside a component.
  if (getCurrentInstance()) onBeforeUnmount(stopStream)

  return {
    videoRef,
    state,
    message,
    error,
    devices,
    selectedDeviceId,
    torchSupported,
    torchOn,
    flash,
    start,
    stop,
    toggleTorch,
    selectDevice,
    decodeFile,
    clearError: () => {
      error.value = ''
    },
  }
}
