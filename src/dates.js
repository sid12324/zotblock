export function startOfDay(date) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

export function addDays(date, count) {
  const next = new Date(date)
  next.setDate(next.getDate() + count)
  return next
}

export function parseISODate(iso) {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function formatISO(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function sameDay(a, b) {
  return formatISO(a) === formatISO(b)
}

export function startOfWeek(date) {
  const next = startOfDay(date)
  const weekday = next.getDay()
  const diff = weekday === 0 ? -6 : 1 - weekday
  next.setDate(next.getDate() + diff)
  return next
}

export function monthWeeks(year, month) {
  const start = startOfWeek(new Date(year, month, 1))
  const last = startOfDay(new Date(year, month + 1, 0))
  const weeks = []
  const cursor = new Date(start)
  while (weeks.length < 6) {
    const week = []
    for (let i = 0; i < 7; i += 1) {
      week.push(new Date(cursor))
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
    if (week[6] >= last) break
  }
  return weeks
}

export function weekDays(date) {
  const start = startOfWeek(date)
  return Array.from({ length: 7 }, (_, index) => addDays(start, index))
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function monthName(date) {
  return date.toLocaleDateString('en-US', { month: 'long' })
}

export function shortMonth(date) {
  return date.toLocaleDateString('en-US', { month: 'short' })
}

export function weekTitle(date) {
  const start = startOfWeek(date)
  const end = addDays(start, 6)
  if (start.getMonth() === end.getMonth()) {
    return {
      primary: `${start.getDate()}–${end.getDate()}`,
      secondary: monthName(start),
    }
  }
  return {
    primary: `${shortMonth(start)} ${start.getDate()}`,
    secondary: `${shortMonth(end)} ${end.getDate()}`,
  }
}

export function dayTitle(date) {
  return {
    primary: String(date.getDate()),
    secondary: date.toLocaleDateString('en-US', { weekday: 'long' }),
  }
}

export function shiftCursor(date, view, direction) {
  const next = new Date(date)
  if (view === 'day') {
    next.setDate(next.getDate() + direction)
    return next
  }
  if (view === 'week') {
    next.setDate(next.getDate() + direction * 7)
    return next
  }
  next.setMonth(next.getMonth() + direction, 1)
  return next
}

export function visibleRange(date, view) {
  if (view === 'day') {
    const iso = formatISO(date)
    return { start: iso, end: iso }
  }
  if (view === 'week') {
    const start = startOfWeek(date)
    const end = addDays(start, 6)
    return { start: formatISO(start), end: formatISO(end) }
  }
  const weeks = monthWeeks(date.getFullYear(), date.getMonth())
  return {
    start: formatISO(weeks[0][0]),
    end: formatISO(weeks[weeks.length - 1][6]),
  }
}

export function formatClock(iso) {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function whenLine(event, today) {
  const date = parseISODate(event.date)
  const diff = Math.round((startOfDay(date) - startOfDay(today)) / 86400000)
  const when = date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  if (event.kind === 'due') {
    const time = event.timeLabel || '11:59 pm'
    if (diff === 0) return `Due today · ${when}, ${time}`
    if (diff === 1) return `Due tomorrow · ${when}, ${time}`
    if (diff === -1) return `Due yesterday · ${when}, ${time}`
    return `Due ${when} · ${time}`
  }
  return event.timeLabel ? `${when} · ${event.timeLabel}` : when
}

export function minutesFromClock(label) {
  const match = String(label || '').match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i)
  if (!match) return null
  let hours = Number(match[1])
  const minutes = Number(match[2])
  const meridiem = match[3]?.toLowerCase()
  if (meridiem === 'pm' && hours < 12) hours += 12
  if (meridiem === 'am' && hours === 12) hours = 0
  if (!meridiem && hours < 8) hours += 12
  return hours * 60 + minutes
}
