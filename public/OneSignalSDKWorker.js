// OneSignal service worker (v16) for the passenger display board.
//
// This is the file OneSignal ships in the "OneSignalSDK-v16-ServiceWorker"
// download. The local copy in /OneSignalSDK.sw.js is used as a fallback
// because Brave Shields and most ad blockers block cdn.onesignal.com - a
// blocked importScripts stops this worker from installing, which in turn
// stops OneSignal.init() and the subscription registration.
try {
  importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
} catch (e) {
  importScripts("/OneSignalSDK.sw.js");
}
