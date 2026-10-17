import { formatClock, formatISO, minutesFromClock } from './dates.js'

async function canvasGet(connection, path, params = {}) {
  const url = new URL('/api/canvas', window.location.origin)
  url.searchParams.set('path', path)
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => url.searchParams.append(key, item))
    } else if (value != null) {
      url.searchParams.set(key, value)
    }
  })

  const response = await fetch(url, {
    headers: {
      'X-Canvas-Base': connection.baseUrl,
      Authorization: `Bearer ${connection.token}`,
    },
  })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { error: text }
  }
  if (!response.ok) {
    const message = data?.errors?.[0]?.message || data?.error || data?.message
    if (response.status === 401) {
      throw new Error('Canvas rejected that token. Check the token and the school URL.')
    }
    throw new Error(message || `Canvas returned ${response.status}.`)
  }
  return data
}

function localDate(iso) {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return formatISO(date)
}

function clockRange(start, end) {
  if (!start) return ''
  const startLabel = formatClock(start).toLowerCase()
  if (!end) return startLabel
  return `${startLabel.replace(/\s?(am|pm)/, '')}–${formatClock(end).toLowerCase()}`
}

export function stripHtml(html = '') {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function extractLinks(html = '') {
  const links = []
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match = pattern.exec(html)
  while (match) {
    const href = match[1]
    if (href.startsWith('http')) {
      const title = stripHtml(match[2]) || href
      let detail = href
      try {
        detail = new URL(href).hostname.replace(/^www\./, '')
      } catch {
        detail = href
      }
      links.push({ icon: 'notes', title, detail, href })
    }
    match = pattern.exec(html)
  }
  return links.slice(0, 4)
}

function formatDuration(minutes) {
  const safe = Math.max(0, Math.round(minutes))
  const hours = Math.floor(safe / 60)
  const mins = safe % 60
  return `${hours}:${String(mins).padStart(2, '0')}`
}

export function buildBrief(event, html = '') {
  const text = stripHtml(html || event.description || '')
  const sentences = text.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.length > 30)
  const summary = sentences.slice(0, 2).join(' ')
  const words = text.split(/\s+/).filter(Boolean).length
  const duration = event.end && event.start
    ? Math.round((new Date(event.end) - new Date(event.start)) / 60000)
    : 0
  const minutes = event.kind === 'class' && duration
    ? Math.max(30, Math.round(duration * 0.5))
    : Math.min(8 * 60, Math.max(45, 60 + Math.round((words / 180) * 60)))
  const links = extractLinks(html)
  const resources = links.length
    ? links
    : event.htmlUrl
      ? [{ icon: 'slides', title: event.courseName || 'Canvas', detail: 'Open the course page', href: event.htmlUrl }]
      : []

  return {
    description: text || 'Canvas did not include a description for this item.',
    summary: summary
      ? summary.slice(0, 360)
      : `${event.title} is on your Canvas calendar. Open it for the full prompt.`,
    estimate: formatDuration(minutes),
    estimateNote: event.kind === 'class'
      ? 'hours · prep, from the event length'
      : 'hours · estimated from the description length',
    resources,
    pulledFromCanvas: true,
  }
}

function courseLabel(course) {
  return course?.course_code || course?.name || 'Course'
}

export async function syncCanvas(connection, start, end) {
  const courses = await canvasGet(connection, '/api/v1/courses', {
    enrollment_state: 'active',
    per_page: '50',
  })
  const courseList = Array.isArray(courses) ? courses.filter((course) => course?.id) : []
  const byId = new Map(courseList.map((course) => [course.id, course]))
  const codes = courseList.map((course) => `course_${course.id}`)

  const [planner, calendar] = await Promise.all([
    canvasGet(connection, '/api/v1/planner/items', {
      start_date: start,
      end_date: end,
      per_page: '50',
    }),
    codes.length
      ? canvasGet(connection, '/api/v1/calendar_events', {
          start_date: start,
          end_date: end,
          type: 'event',
          per_page: '50',
          'context_codes[]': codes,
        })
      : Promise.resolve([]),
  ])

  const events = []

  for (const item of Array.isArray(planner) ? planner : []) {
    const type = item.plannable_type
    if (!['assignment', 'quiz', 'discussion_topic'].includes(type)) continue
    const when = item.plannable_date || item.plannable?.due_at
    const date = localDate(when)
    if (!date) continue
    const course = byId.get(item.course_id)
    const code = courseLabel(course)
    const title = item.plannable?.title || 'Canvas item'
    const dueKind = type === 'discussion_topic' ? 'class' : 'due'
    events.push({
      id: `planner-${item.plannable_id || title}-${date}`,
      kind: dueKind,
      courseCode: code,
      courseName: course?.name || item.context_name || code,
      title,
      shortLabel: `${code} ${title}`.trim(),
      date,
      timeLabel: when ? formatClock(when).toLowerCase() : '11:59 pm',
      startMinutes: dueKind === 'due' ? null : minutesFromClock(formatClock(when || '')),
      htmlUrl: item.html_url,
      courseId: item.course_id,
      assignmentId: type === 'assignment' ? item.plannable_id : null,
      description: '',
      summary: '',
      estimate: '',
      estimateNote: '',
      resources: [],
      needsDetail: type === 'assignment' && item.course_id && item.plannable_id,
    })
  }

  for (const item of Array.isArray(calendar) ? calendar : []) {
    const date = localDate(item.start_at)
    if (!date || item.assignment) continue
    const course = byId.get(item.context_code?.startsWith('course_')
      ? Number(item.context_code.replace('course_', ''))
      : null)
    const code = courseLabel(course)
    const timeLabel = clockRange(item.start_at, item.end_at)
    events.push({
      id: `cal-${item.id}`,
      kind: 'class',
      courseCode: code === 'Course' ? '' : code,
      courseName: course?.name || item.context_name || 'Canvas',
      title: item.title || 'Calendar event',
      shortLabel: code === 'Course' ? item.title : `${code} ${item.title}`,
      date,
      timeLabel,
      startMinutes: item.start_at ? new Date(item.start_at).getHours() * 60 + new Date(item.start_at).getMinutes() : null,
      start: item.start_at,
      end: item.end_at,
      htmlUrl: item.html_url,
      description: stripHtml(item.description || ''),
      summary: '',
      estimate: '',
      estimateNote: '',
      resources: [],
    })
  }

  const seen = new Set()
  return events.filter((event) => {
    const key = `${event.date}|${event.shortLabel}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function loadAssignment(connection, event) {
  const assignment = await canvasGet(
    connection,
    `/api/v1/courses/${event.courseId}/assignments/${event.assignmentId}`,
  )
  const brief = buildBrief(event, assignment.description || '')
  return {
    ...event,
    ...brief,
    htmlUrl: assignment.html_url || event.htmlUrl,
    needsDetail: false,
  }
}
