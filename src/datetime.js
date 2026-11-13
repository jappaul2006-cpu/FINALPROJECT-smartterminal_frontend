/**
 * Local date helpers.
 *
 * The database stores plain local date/time strings (Asia/Manila) and the
 * backend writes them in the same timezone, so the frontend has to read and
 * write them as local time as well.
 *
 * toISOString() always returns UTC, which is 8 hours behind Manila - using
 * it for date inputs would silently show "yesterday" between midnight and
 * 8 AM.
 */

const pad = (n) => String(n).padStart(2, '0')

/**
 * Local calendar date as YYYY-MM-DD.
 *
 * @param {Date} d
 * @returns {string}
 */
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Local date and time as YYYY-MM-DD HH:MM:SS (the format the API stores).
 *
 * @param {Date} d
 * @returns {string}
 */
export function localDateTime(d = new Date()) {
  return `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * Local date and time for <input type="datetime-local"> (YYYY-MM-DDTHH:MM).
 *
 * @param {Date} d
 * @returns {string}
 */
export function localDateTimeInput(d = new Date()) {
  return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
