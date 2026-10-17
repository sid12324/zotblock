import { useEffect, useMemo, useState } from 'react'
import { SAMPLE_EVENTS } from './sampleData.js'
import { loadAssignment, syncCanvas } from './canvasApi.js'
import {
  dayTitle,
  formatISO,
  minutesFromClock,
  parseISODate,
  monthName,
  monthWeeks,
  sameDay,
  shiftCursor,
  startOfDay,
  visibleRange,
  WEEKDAYS,
  weekDays,
  weekTitle,
  whenLine,
} from './dates.js'
import './styles.css'

const STORAGE_KEY = 'zotblock.canvas'
const CUSTOM_KEY = 'zotblock.events'

function loadCustomEvents() {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function loadConnection() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.baseUrl || !parsed?.token) return null
    return parsed
  } catch {
    return null
  }
}

function Icon({ name }) {
  if (name === 'book') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2.5 3H7.2C7.8 3 8 3.5 8 4.1V13.2C8 12.4 7.3 12.2 6.7 12.2H2.5V3Z" />
        <path d="M13.5 3H8.8C8.2 3 8 3.5 8 4.1V13.2C8 12.4 8.7 12.2 9.3 12.2H13.5V3Z" />
      </svg>
    )
  }
  if (name === 'slides') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2" y="3" width="12" height="8" />
        <path d="M8 11V13.5M5.5 13.5H10.5" />
      </svg>
    )
  }
  if (name === 'clock') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="5.25" />
        <path d="M8 5V8.2L10.2 9.5" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2.5H12V13.5H4V2.5Z" />
      <path d="M6 6H10M6 8.5H10M6 11H8.5" />
    </svg>
  )
}

function Chevron({ direction }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d={direction === 'left' ? 'M10 3L5 8L10 13' : 'M6 3L11 8L6 13'} />
    </svg>
  )
}

export default function App() {
  const today = useMemo(() => startOfDay(new Date()), [])
  const [cursor, setCursor] = useState(today)
  const [view, setView] = useState('month')
  const [selectedId, setSelectedId] = useState('cs161-pset5')
  const [panelOpen, setPanelOpen] = useState(true)
  const [connection, setConnection] = useState(loadConnection)
  const [source, setSource] = useState('sample')
  const [canvasEvents, setCanvasEvents] = useState([])
  const [syncState, setSyncState] = useState('idle')
  const [syncError, setSyncError] = useState('')
  const [syncedAt, setSyncedAt] = useState(null)
  const [connectOpen, setConnectOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [customEvents, setCustomEvents] = useState(loadCustomEvents)

  const range = useMemo(() => visibleRange(cursor, view), [cursor, view])
  const events = useMemo(() => {
    const base = source === 'canvas' ? canvasEvents : SAMPLE_EVENTS
    return [...base, ...customEvents]
  }, [source, canvasEvents, customEvents])
  const selected = events.find((event) => event.id === selectedId) || null

  useEffect(() => {
    if (!connection) return undefined
    let cancel = false
    setSyncState('syncing')
    setSyncError('')
    syncCanvas(connection, range.start, range.end)
      .then((nextEvents) => {
        if (cancel) return
        setCanvasEvents(nextEvents)
        setSource('canvas')
        setSyncState('synced')
        setSyncedAt(new Date())
        setConnectOpen(false)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(connection))
        setSelectedId((current) => {
          if (String(current).startsWith('custom-') || nextEvents.some((event) => event.id === current)) return current
          return nextEvents[0]?.id ?? null
        })
        if (nextEvents.length === 0) setPanelOpen(false)
      })
      .catch((error) => {
        if (cancel) return
        setSyncState('error')
        setSyncError(error.message || 'Could not sync Canvas.')
      })
    return () => {
      cancel = true
    }
  }, [connection, range.start, range.end])

  useEffect(() => {
    if (!selected?.needsDetail || !connection) return undefined
    let cancel = false
    loadAssignment(connection, selected)
      .then((detailed) => {
        if (cancel) return
        setCanvasEvents((current) => current.map((event) => (
          event.id === detailed.id ? detailed : event
        )))
      })
      .catch(() => {
        if (cancel) return
        setCanvasEvents((current) => current.map((event) => (
          event.id === selected.id ? { ...event, needsDetail: false, description: 'The assignment description could not be loaded.' } : event
        )))
      })
    return () => {
      cancel = true
    }
  }, [selected, connection])

  useEffect(() => {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(customEvents))
  }, [customEvents])

  useEffect(() => {
    function onKey(event) {
      if (event.key !== 'Escape') return
      if (addOpen) setAddOpen(false)
      else if (connectOpen) setConnectOpen(false)
      else setPanelOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [addOpen, connectOpen])

  function selectEvent(id) {
    setSelectedId(id)
    setPanelOpen(true)
  }

  function addEvent(event) {
    setCustomEvents((current) => [...current, event])
    setCursor(parseISODate(event.date))
    setSelectedId(event.id)
    setPanelOpen(true)
    setAddOpen(false)
  }

  function disconnect() {
    localStorage.removeItem(STORAGE_KEY)
    setConnection(null)
    setSource('sample')
    setCanvasEvents([])
    setSyncState('idle')
    setSyncError('')
    setSyncedAt(null)
    setSelectedId('cs161-pset5')
    setPanelOpen(true)
    setCursor(today)
    setConnectOpen(false)
  }

  const status = statusLabel(source, syncState, syncedAt)

  return (
    <div className="app">
      <section className="calendar" aria-label="Calendar">
        <header className="topbar">
          <div className="wordmark">
            <span className="mark" />
            <span>ZOTBLOCK</span>
          </div>
          <button className="status" type="button" onClick={() => setConnectOpen(true)}>
            <span className="status-dot" />
            {status}
          </button>
        </header>

        <div className="mast">
          <div className="mast-title">
            {view === 'month' && (
              <>
                <h1>{monthName(cursor)}</h1>
                <p>{cursor.getFullYear()}</p>
              </>
            )}
            {view === 'week' && (
              <>
                <h1>{weekTitle(cursor).primary}</h1>
                <p>{weekTitle(cursor).secondary}</p>
              </>
            )}
            {view === 'day' && (
              <>
                <h1>{dayTitle(cursor).primary}</h1>
                <p>{dayTitle(cursor).secondary}</p>
              </>
            )}
          </div>
          <div className="mast-actions">
            <div className="nav">
              <button type="button" aria-label={stepLabel(view, 'Previous')} onClick={() => setCursor(shiftCursor(cursor, view, -1))}>
                <Chevron direction="left" />
              </button>
              <button type="button" aria-label={stepLabel(view, 'Next')} onClick={() => setCursor(shiftCursor(cursor, view, 1))}>
                <Chevron direction="right" />
              </button>
            </div>
            <div className="switch" role="group" aria-label="Calendar view">
              <button type="button" aria-pressed={view === 'month'} className={view === 'month' ? 'on' : ''} onClick={() => setView('month')}>
                Month
              </button>
              <button type="button" aria-pressed={view === 'week'} className={view === 'week' ? 'on' : ''} onClick={() => setView('week')}>
                Week
              </button>
              <button type="button" aria-pressed={view === 'day'} className={view === 'day' ? 'on' : ''} onClick={() => setView('day')}>
                Day
              </button>
            </div>
            <button className="add-btn" type="button" aria-label="Add event" onClick={() => setAddOpen(true)}>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M8 3V13M3 8H13" />
              </svg>
            </button>
          </div>
        </div>

        {view === 'month' && (
          <MonthView
            cursor={cursor}
            today={today}
            events={events}
            selectedId={panelOpen ? selectedId : null}
            onSelect={selectEvent}
            onShowWeek={(date) => {
              setCursor(date)
              setView('week')
            }}
          />
        )}
        {view === 'week' && (
          <WeekView
            cursor={cursor}
            today={today}
            events={events}
            selectedId={panelOpen ? selectedId : null}
            onSelect={selectEvent}
          />
        )}
        {view === 'day' && (
          <DayView
            cursor={cursor}
            events={events}
            selectedId={panelOpen ? selectedId : null}
            onSelect={selectEvent}
          />
        )}
      </section>

      {panelOpen && selected && (
        <DetailPanel
          event={selected}
          today={today}
          onClose={() => setPanelOpen(false)}
        />
      )}

      {addOpen && (
        <AddDialog
          date={formatISO(cursor)}
          onClose={() => setAddOpen(false)}
          onAdd={addEvent}
        />
      )}

      {connectOpen && (
        <ConnectDialog
          connection={connection}
          source={source}
          syncState={syncState}
          syncError={syncError}
          onClose={() => setConnectOpen(false)}
          onConnect={(next) => {
            setConnection(next)
            setSyncError('')
          }}
          onDisconnect={disconnect}
        />
      )}
    </div>
  )
}

function courseLine(event) {
  const parts = [event.courseCode, event.courseName].filter(Boolean)
  const unique = parts.filter((value, index) => (
    parts.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index
  ))
  return unique.join(' · ').toUpperCase()
}

function stepLabel(view, direction) {
  const unit = view === 'month' ? 'month' : view === 'week' ? 'week' : 'day'
  return `${direction} ${unit}`
}

function statusLabel(source, syncState, syncedAt) {
  if (syncState === 'syncing') return 'Canvas · syncing'
  if (syncState === 'error') return 'Canvas · sync failed'
  if (source === 'canvas' && syncedAt) {
    const mins = Math.max(0, Math.round((Date.now() - syncedAt.getTime()) / 60000))
    return mins < 1 ? 'Canvas · synced just now' : `Canvas · synced ${mins} min ago`
  }
  return 'Canvas · sample term'
}

function MonthView({ cursor, today, events, selectedId, onSelect, onShowWeek }) {
  const weeks = monthWeeks(cursor.getFullYear(), cursor.getMonth())
  return (
    <div className="month">
      <div className="dow">
        {WEEKDAYS.map((label, index) => {
          const date = weeks.find((week) => sameDay(week[index], today))
          return (
            <span key={label} className={date ? 'is-today' : ''}>
              {label}
            </span>
          )
        })}
      </div>
      <div className="month-grid">
        {weeks.flat().map((date) => {
          const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
          const dayEvents = events.filter((event) => event.date === iso)
          const shown = dayEvents.slice(0, 3)
          const extra = dayEvents.length - shown.length
          const outside = date.getMonth() !== cursor.getMonth()
          return (
            <div key={iso} className="day">
              {sameDay(date, today) ? (
                <span className="today-num">{date.getDate()}</span>
              ) : (
                <span className={outside ? 'outside' : ''}>{date.getDate()}</span>
              )}
              {shown.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  className={`chip ${event.kind === 'due' ? 'due' : ''} ${event.id === selectedId ? 'selected' : ''}`}
                  onClick={() => onSelect(event.id)}
                >
                  <span>{event.shortLabel}</span>
                </button>
              ))}
              {extra > 0 && (
                <button type="button" className="more" onClick={() => onShowWeek(date)}>
                  +{extra} more
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function WeekView({ cursor, today, events, selectedId, onSelect }) {
  const days = weekDays(cursor)
  return (
    <div className="week">
      {days.map((date) => {
        const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        const dayEvents = events.filter((event) => event.date === iso)
        const timed = dayEvents.filter((event) => event.startMinutes != null)
        const dues = dayEvents.filter((event) => event.startMinutes == null)
        return (
          <div key={iso} className="week-day">
            <div className="week-head">
              <span className={sameDay(date, today) ? 'is-today' : ''}>
                {WEEKDAYS[(date.getDay() + 6) % 7]}
              </span>
              {sameDay(date, today) ? (
                <strong className="today-block">{date.getDate()}</strong>
              ) : (
                <strong>{date.getDate()}</strong>
              )}
            </div>
            <div className="week-track">
              {timed.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  className={`week-event ${event.id === selectedId ? 'selected' : ''}`}
                  style={{ top: `${eventTop(event.startMinutes)}%` }}
                  onClick={() => onSelect(event.id)}
                >
                  <em>{event.timeLabel}</em>
                  <span>{event.shortLabel}</span>
                </button>
              ))}
              {dues.map((event, index) => (
                <button
                  key={event.id}
                  type="button"
                  className={`week-event due ${event.kind === 'due' ? 'is-due' : ''} ${event.id === selectedId ? 'selected' : ''}`}
                  style={{ bottom: `${index * 72}px` }}
                  onClick={() => onSelect(event.id)}
                >
                  {event.timeLabel && <em>{event.timeLabel}</em>}
                  <span>{event.shortLabel}</span>
                </button>
              ))}
              {dayEvents.length === 0 && <p className="clear">Nothing due.</p>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function eventTop(minutes) {
  const start = 8 * 60
  const end = 21 * 60
  const clamped = Math.min(Math.max(minutes, start), end - 45)
  return ((clamped - start) / (end - start)) * 78
}

function DayView({ cursor, events, selectedId, onSelect }) {
  const iso = formatISO(cursor)
  const dayEvents = events
    .filter((event) => event.date === iso)
    .sort((a, b) => (a.startMinutes ?? 24 * 60) - (b.startMinutes ?? 24 * 60))
  return (
    <div className="day-agenda">
      <p className="day-kicker">{monthName(cursor)}</p>
      {dayEvents.length === 0 && <p className="day-empty">Nothing on this day.</p>}
      {dayEvents.map((event) => (
        <button
          key={event.id}
          type="button"
          className={`agenda-row ${event.kind === 'due' ? 'due' : ''} ${event.id === selectedId ? 'selected' : ''}`}
          onClick={() => onSelect(event.id)}
        >
          <em>{event.timeLabel || 'All day'}</em>
          <span>
            <strong>{event.shortLabel}</strong>
            {event.courseName && event.courseName !== event.courseCode && <small>{event.courseName}</small>}
          </span>
        </button>
      ))}
    </div>
  )
}

function clockLabel(value) {
  if (!value) return ''
  const [hours, minutes] = value.split(':').map(Number)
  const date = new Date()
  date.setHours(hours, minutes, 0, 0)
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()
}

function AddDialog({ date, onClose, onAdd }) {
  const [title, setTitle] = useState('')
  const [eventDate, setEventDate] = useState(date)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [course, setCourse] = useState('')
  const [notes, setNotes] = useState('')
  const [kind, setKind] = useState('class')

  function submit(event) {
    event.preventDefault()
    const trimmed = title.trim()
    if (!trimmed || !eventDate) return
    const startLabel = clockLabel(start)
    const endLabel = clockLabel(end)
    const timeLabel = kind === 'due' && !start
      ? '11:59 pm'
      : startLabel && endLabel
        ? `${startLabel.replace(/\s?(am|pm)$/i, '')}–${endLabel}`
        : startLabel
    const startMinutes = start ? minutesFromClock(startLabel) : null
    const endMinutes = end ? minutesFromClock(endLabel) : null
    const span = startMinutes != null && endMinutes != null && endMinutes > startMinutes
      ? endMinutes - startMinutes
      : kind === 'due' ? 90 : 60
    const hours = Math.floor(span / 60)
    const mins = span % 60
    onAdd({
      id: `custom-${crypto.randomUUID()}`,
      kind,
      courseCode: course.trim(),
      courseName: '',
      title: trimmed,
      shortLabel: course.trim() ? `${course.trim()} ${trimmed}` : trimmed,
      date: eventDate,
      timeLabel,
      startMinutes,
      estimate: `${hours}:${String(mins).padStart(2, '0')}`,
      estimateNote: 'hours · you added this',
      description: notes.trim() || 'You added this event.',
      summary: notes.trim() || 'This stays on the calendar in this browser, alongside anything synced from Canvas.',
      resources: [],
      custom: true,
    })
  }

  return (
    <div className="backdrop" role="presentation" onMouseDown={onClose}>
      <form className="dialog" onMouseDown={(event) => event.stopPropagation()} onSubmit={submit}>
        <p className="label">New event</p>
        <h2>Add to the calendar</h2>
        <label>
          Title
          <input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus required />
        </label>
        <div className="field-row">
          <label>
            Date
            <input type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} required />
          </label>
          <label>
            Starts
            <input type="time" value={start} onChange={(event) => setStart(event.target.value)} />
          </label>
          <label>
            Ends
            <input type="time" value={end} onChange={(event) => setEnd(event.target.value)} />
          </label>
        </div>
        <label>
          Course
          <input value={course} onChange={(event) => setCourse(event.target.value)} placeholder="CS 161" />
        </label>
        <div className="kind-switch" role="group" aria-label="Event type">
          <button type="button" className={kind === 'class' ? 'on' : ''} onClick={() => setKind('class')}>Class</button>
          <button type="button" className={kind === 'due' ? 'on' : ''} onClick={() => setKind('due')}>Due</button>
        </div>
        <label>
          Notes
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
        </label>
        <div className="dialog-actions">
          <button className="canvas-btn" type="submit" disabled={!title.trim()}>
            Add event
          </button>
          <button className="text-btn" type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  )
}

function DetailPanel({ event, today, onClose }) {
  const loading = event.needsDetail && !event.description
  return (
    <aside className="panel" aria-label="Event brief">
      <div className="panel-head">
        <span>AI BRIEF</span>
        <button type="button" aria-label="Close brief" onClick={onClose}>
          <svg viewBox="0 0 14 14" aria-hidden="true">
            <path d="M2 2L12 12M12 2L2 12" />
          </svg>
        </button>
      </div>
      <div className="panel-scroll">
        <p className="course">{courseLine(event)}</p>
        <p className="when">{whenLine(event, today)}</p>
        <h2>{event.title}</h2>
        {event.subtitle && <p className="subtitle">{event.subtitle}</p>}

        <div className="estimate">
          <div className="estimate-bar" />
          <div>
            <p className="label">Estimated time</p>
            <p className="estimate-num">{loading ? '—' : event.estimate || '—'}</p>
            <p className="note">{loading ? 'Reading the Canvas description' : event.estimateNote}</p>
          </div>
        </div>

        <section>
          <p className="label">Description</p>
          <p className="prose">{loading ? 'Loading the assignment from Canvas.' : event.description}</p>
        </section>
        <section>
          <p className="label">AI summary</p>
          <p className="prose italic">
            {loading ? 'The summary appears once the description is in.' : event.summary}
          </p>
          {event.pulledFromCanvas && !loading && (
            <p className="note">Pulled from the Canvas description.</p>
          )}
        </section>
        <section className="resources">
          <p className="label">Resources</p>
          {(event.resources || []).map((resource) => (
            <a
              key={`${resource.title}-${resource.detail}`}
              className="resource"
              href={resource.href || undefined}
              target={resource.href ? '_blank' : undefined}
              rel={resource.href ? 'noreferrer' : undefined}
            >
              <span className="icon"><Icon name={resource.icon} /></span>
              <span>
                <strong>{resource.title}</strong>
                <em>{resource.detail}</em>
              </span>
            </a>
          ))}
          {!loading && (event.resources || []).length === 0 && (
            <p className="note">No linked resources on this item.</p>
          )}
        </section>
      </div>
      <a className="canvas-btn" href={event.htmlUrl || 'https://canvas.eee.uci.edu'} target="_blank" rel="noreferrer">
        Open in Canvas
        <Chevron direction="right" />
      </a>
    </aside>
  )
}

function ConnectDialog({ connection, source, syncState, syncError, onClose, onConnect, onDisconnect }) {
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl || 'https://canvas.eee.uci.edu')
  const [token, setToken] = useState('')

  return (
    <div className="backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="dialog"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          onConnect({ baseUrl: baseUrl.trim().replace(/\/$/, ''), token: token.trim() })
        }}
      >
        <p className="label">Canvas</p>
        <h2>Connect your courses</h2>
        <p className="dialog-copy">
          Paste a personal access token from Canvas account settings. Zotblock sends it only to your Canvas site, through this app, and keeps it in this browser.
        </p>
        <label>
          Canvas URL
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            autoComplete="off"
            spellCheck="false"
          />
        </label>
        <label>
          Access token
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={connection ? 'Token saved — paste a new one to replace it' : 'Paste token'}
            autoComplete="off"
          />
        </label>
        {syncError && <p className="form-error">{syncError}</p>}
        <div className="dialog-actions">
          <button className="canvas-btn" type="submit" disabled={syncState === 'syncing' || !token.trim()}>
            {syncState === 'syncing' ? 'Syncing' : 'Sync Canvas'}
          </button>
          {source === 'canvas' && (
            <button className="text-btn" type="button" onClick={onDisconnect}>
              Use sample term
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
