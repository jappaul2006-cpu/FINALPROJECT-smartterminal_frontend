// Simple, dependency-free PDF generator for the Reports page.
// Builds a real .pdf file client-side (PDF 1.4, built-in Helvetica,
// no font embedding) so "Save PDF" works offline without libraries.

function esc(s) {
  return String(s ?? '')
    .replace(/[^\x20-\x7E]/g, (c) => {
      if (c === '₱') return 'P'
      if (c === '→') return '->'
      if (c === '—' || c === '–') return '-'
      return ''
    })
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
}

export function generateReportPdf({ fromDate, toDate, summary, destData, dailyVolume, tripRows }) {
  const W = 612 // Letter width pt
  const H = 792 // Letter height pt
  const M = 48 // margin

  const pages = [] // array of content-stream strings
  let cur = []
  let y = H - M
  const newPage = () => { if (cur.length) pages.push(cur.join('\n')); cur = []; y = H - M }
  const ensure = (need) => { if (y - need < M) newPage() }
  const text = (x, yy, size, bold, s) => {
    cur.push(`BT /F${bold ? 2 : 1} ${size} Tf ${x.toFixed(1)} ${yy.toFixed(1)} Td (${esc(s)}) Tj ET`)
  }
  // Truncate a cell so long text can never spill into the next column.
  const fit = (s, maxWidth, size) => {
    s = String(s ?? '')
    const maxChars = Math.max(1, Math.floor((maxWidth - 4) / (size * 0.52)))
    return s.length > maxChars ? s.slice(0, maxChars - 3) + '...' : s
  }
  const line = (size, bold, s) => { ensure(size + 6); y -= size + 4; text(M, y, size, bold, s) }
  const spacer = (h) => { y -= h; if (y < M) newPage() }

  line(16, true, 'SmartTerminal - Reports')
  line(10, false, `Range: ${fromDate} to ${toDate}`)
  spacer(6)

  line(12, true, 'Summary')
  line(10, false, `Trips in range: ${summary.trips}`)
  line(10, false, `Passengers carried: ${summary.passengers}`)
  line(10, false, `On-time departures: ${summary.onTimePct}%`)
  line(10, false, `Average delay: ${summary.avgDelay} min`)
  line(10, false, `Manual overrides: ${summary.manual}`)
  spacer(8)

  line(12, true, 'Passengers by destination')
  if (!destData.length) line(10, false, 'No ticket data in range.')
  else {
    destData.forEach((d) => line(10, false, `${d.label}: ${d.val} (${Math.round(d.pct * 100)}%)`))
  }
  spacer(8)

  line(12, true, 'Daily passenger volume')
  if (!dailyVolume.length) line(10, false, 'No passenger data in range.')
  else {
    dailyVolume.forEach((d) => line(10, false, `${d.date}: boarded ${d.boarded || 0}, waiting ${d.waiting || 0}`))
  }
  spacer(8)

  line(12, true, 'Trip history')
  if (!tripRows.length) line(10, false, 'No trip history in range.')
  else {
    const cols = [46, 78, 150, 70, 90, 70] // #, Status, Route, Plate, Driver, Delay
    const headers = ['Trip', 'Status', 'Route', 'Plate', 'Driver', 'Delay']
    ensure(30)
    y -= 14
    let hx = M
    headers.forEach((h, i) => { text(hx, y, 9, true, h); hx += cols[i] })
    y -= 12
    tripRows.forEach((t) => {
      ensure(14)
      const row = [
        `#${t.trip_id}`,
        String(t.status || ''),
        `${t.origin || ''} -> ${t.destination || ''}`,
        String(t.plate_number || '-'),
        String(t.driver_name || '-'),
        t.delay_minutes != null ? `${t.delay_minutes} min` : '-',
      ]
      let cx = M
      row.forEach((c, i) => { text(cx, y, 9, false, fit(c, cols[i], 9)); cx += cols[i] })
      y -= 12
    })
  }
  pages.push(cur.join('\n'))

  // Assemble objects.
  const objects = []
  // 1: Catalog, 2: Pages, 3: Font, 4: Font-Bold, then per page: Page, Content
  const kids = []
  for (let i = 0; i < pages.length; i++) kids.push(5 + i * 2, 6 + i * 2)
  const push = (s) => objects.push(s)
  push(`<< /Type /Catalog /Pages 2 0 R >>`)
  push(`<< /Type /Pages /Count ${pages.length} /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] >>`)
  push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`)
  push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`)
  for (let i = 0; i < pages.length; i++) {
    const pageObj = 5 + i * 2
    const contentObj = pageObj + 1
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObj} 0 R >>`)
    const stream = pages[i]
    push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  }

  // Serialize with byte-accurate xref (all content is ASCII).
  const header = '%PDF-1.4\n'
  const parts = [header]
  const offsets = []
  let pos = header.length
  objects.forEach((body, i) => {
    offsets.push(pos)
    const block = `${i + 1} 0 obj\n${body}\nendobj\n`
    parts.push(block)
    pos += block.length
  })
  const n = objects.length + 1
  const xref =
    `xref\n0 ${n}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF`
  return new Blob([parts.join(''), xref], { type: 'application/pdf' })
}

export function downloadReportPdf(data) {
  const blob = generateReportPdf(data)
  const name = `SmartTerminal-Reports-${data.fromDate}-${data.toDate}.pdf`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}
