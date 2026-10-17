# ZotBlock

ZotBlock connects Gmail, Canvas, and Google Calendar to create personalized study blocks. Meher’s six-question onboarding collects the study profile, LangChain extracts coursework with those answers as context, and Sid’s calendar displays the resulting blocks alongside calendar events and assignment deadlines.

Routes: `/` opens the appropriate next screen; `/onboarding` collects and edits preferences; `/integrations` connects accounts and generates a plan; `/calendar` has Month, Week, and Day views with event details, a shared timeline for existing events and study blocks, and a live current-time indicator in Week and Day; `/focus` offers a study timer and streaks; `/output` displays the complete JSON with copy and download controls.

Live mode uses LangChain to combine academic email, Canvas coursework, and calendar availability. The response includes source data, proposed `studyBlocks`, unscheduled work, and warnings. Generating a plan does not insert events into Google Calendar.

## Run locally

Use Node.js 22 or newer and npm.

```sh
npm install
npm run dev
```

Open [localhost:3000](http://localhost:3000). Complete onboarding, then choose **Try sample data** on Integrations to generate a sample calendar and JSON. Demo mode requires no OAuth credentials, model key, or session secret. It does not access connected accounts.

For live mode, create `.env.local` at the project root:

```dotenv
APP_URL=http://localhost:3000
SESSION_SECRET=replace-with-a-random-secret-of-at-least-32-characters

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Personal local Canvas connection; use your own token.
CANVAS_BASE_URL=https://canvas.eee.uci.edu
CANVAS_ACCESS_TOKEN=

# Optional alternative: institutional Canvas OAuth for multiple users.
CANVAS_CLIENT_ID=
CANVAS_CLIENT_SECRET=

OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
```

Generate a session secret with `openssl rand -base64 32`. Restart the development server after changing environment variables. `OPENAI_MODEL` defaults to `gpt-4.1-mini` when omitted. `.env.local` is ignored by Git. All of these variables are server-side values; do not prefix secrets with `NEXT_PUBLIC_`.

Live generation requires an OpenAI API key, a connected Google Calendar, and at least one academic source: Gmail or Canvas. Gmail plus Calendar works without Canvas credentials. Provider setup and live account access must be tested with your own credentials; the included demo does not verify OAuth configuration.

## Connect Google

1. Create a Google Cloud project and enable the Gmail API and Google Calendar API.
2. Configure Google Auth Platform's consent screen. For an external app in testing, add the Google accounts that will test it as test users.
3. Create an OAuth client with application type **Web application**. Add `http://localhost:3000/api/auth/google/callback` to its authorized redirect URIs. For deployment, also register `${APP_URL}/api/auth/google/callback` using the actual public origin.
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_URL`, and `SESSION_SECRET`, then connect Gmail and Google Calendar from `/integrations`.

The Gmail connector requests `https://www.googleapis.com/auth/gmail.readonly`; Calendar initially requests `https://www.googleapis.com/auth/calendar.events.readonly`. Calendar export separately requests `https://www.googleapis.com/auth/calendar.events.owned` to add events to the connected account's primary calendar. Connections use offline access and incremental authorization. Google account email access identifies the connected account.

The integrations page also checks Calendar API availability using a response containing only the resource type, with no event contents. An authorized account can still need Cloud setup: if the page reports `API_DISABLED`, enable **Google Calendar API** in the OAuth client's Google Cloud project, then choose **Check again**. Permission errors offer reconnection; quota errors ask you to retry later.

This prototype checks upcoming events on the **primary Google Calendar**. Events stored only on secondary or subscribed calendars do not reserve time in its plan. Gmail searches the last 14 days for academic terms such as assignment, homework, exam, quiz, and deadline, excluding promotions and social categories. It paginates through up to 500 matching messages and reads full text bodies within a 750,000-character import budget. Large imports are split into smaller model requests. Busy mailboxes continue planning with explicit coverage warnings when limits are reached or individual messages cannot be read; no mailbox cleanup is required. Older messages and messages outside the search filters are not included.

The callback's scheme, hostname, port, and path must match Google's registered redirect URI exactly. See the official [web server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), and [Calendar event listing reference](https://developers.google.com/workspace/calendar/api/v3/reference/events/list).

## Connect Canvas

### Personal local prototype

Set `CANVAS_BASE_URL=https://canvas.eee.uci.edu` and `CANVAS_ACCESS_TOKEN` to your own Canvas personal access token in `.env.local`. Set `SESSION_SECRET`, restart the server, and click **Connect** for Canvas. The server validates the token against your Canvas profile and saves the connection in an encrypted, `HttpOnly` cookie. There is no browser field for pasting the token. Using your own token for this local prototype does not require an administrator-issued OAuth developer key; token availability and expiry depend on your institution.

This is a single-person server configuration: anyone using that running app could connect the configured account. Keep it local. Use the OAuth setup below for an app shared with other users.

### OAuth for multiple users

Leave `CANVAS_ACCESS_TOKEN` empty. Obtain an OAuth developer key issued or enabled by the institution's Canvas administrator. A key belongs to its Canvas institution, so credentials for one school will not automatically work at another school.

1. Obtain a Canvas OAuth client ID and secret for your institution. Register `http://localhost:3000/api/auth/canvas/callback` as a redirect URI. For deployment, register `${APP_URL}/api/auth/canvas/callback` using the actual public origin.
2. Allow these read scopes used by the connector: `url:GET|/api/v1/planner/items`, `url:GET|/api/v1/users/:user_id/profile`, `url:GET|/api/v1/courses/:course_id/assignments/:id`, `url:GET|/api/v1/courses/:course_id/quizzes/:id`, and `url:GET|/api/v1/courses/:course_id/discussion_topics/:topic_id`. Existing OAuth connections must reconnect after these detail scopes are enabled. Personal access tokens do not need a new setup step.
3. Set `CANVAS_CLIENT_ID` and `CANVAS_CLIENT_SECRET`. Optionally set `CANVAS_BASE_URL` to pin the app to the school's HTTPS origin.
4. Enter the school's Canvas URL in the connector and complete Canvas authorization.

Without a configured `CANVAS_BASE_URL`, school hosts must be subdomains of `instructure.com`. A configured base URL permits that exact institution origin, including a school's custom Canvas hostname. Canvas tokens and OAuth requests stay on the authorized school origin.

Canvas permits manual tokens for a developer's own testing and requires OAuth for applications used by multiple users. See [Canvas OAuth](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth).

Both connection methods read upcoming incomplete coursework using paginated `GET /api/v1/planner/items` requests with `start_date`, `end_date`, and `filter=incomplete_items`. The app includes assignments, quizzes, discussions, and peer-review work within the planning window. Personal planner notes and pages are excluded. Assignment, quiz, and discussion detail endpoints enrich planner items with full plain-text instructions, points, submission types, file restrictions, safe resource links, availability dates, and quiz requirements when Canvas permits access. The personalized planner deadline remains authoritative. Unavailable descriptions retain the basic planner item and produce a coverage warning. This is the student's dated planner view, rather than every assignment in every course; concluded courses are excluded by Canvas by default. See [planner items](https://developerdocs.instructure.com/services/canvas/resources/planner) and [API pagination](https://developerdocs.instructure.com/services/canvas/basics/file.pagination).

## JSON API

`POST /api/study-plan` accepts:

```json
{
  "mode": "live",
  "preferences": {
    "timeZone": "America/Los_Angeles",
    "days": 7,
    "dayStart": 9,
    "dayEnd": 21,
    "blockMinutes": 50
  }
}
```

Use `"mode": "demo"` for sample data. The browser sends requests from the same origin as `APP_URL`. Hours are interpreted in the supplied IANA time zone. The planner fits study blocks around existing events within the requested study hours, retains links to their academic sources, and reports work that does not fit before its deadline.

Live orchestration uses `@langchain/core` and `@langchain/openai` with a validated structured response. See the official [LangChain ChatOpenAI integration](https://docs.langchain.com/oss/javascript/integrations/chat/openai) and [structured output documentation](https://docs.langchain.com/oss/javascript/langchain/structured-output).

## Live progress and streamed results

The UI requests `POST /api/study-plan` with `Accept: application/x-ndjson`. A persistent HTTP response emits newline-delimited JSON frames as real work finishes:

- `progress`: provider/course messages, actual completed/total counts when known, AI batch outcomes, and scheduling progress.
- `sources`: partial source snapshots, so existing Google Calendar events can appear before slower coursework or email imports finish.
- `block`: each final study block with its actual `completed` and `total` block counts.
- `complete`: the final plan, including all sources, preferences, warnings, and unscheduled work.
- `error`: a safe error if collection or planning fails after streaming starts.

The UI stays on Integrations while generating. A single text area shows concurrent provider states, course messages, and real counts, then offers **View calendar** when ready. The calendar has no progress panel; if opened during generation, its events still update as source and block frames arrive. Scheduling is deterministic and may finish in one burst; progress is never slowed down or fabricated for animation. Empty heartbeat lines keep the response active during longer provider/model requests. The original JSON response is still supported when the NDJSON Accept header is absent.

Incomplete previews stay in memory. Only a complete, successfully read stream replaces the saved plan. A network failure preserves the previous completed plan. Disconnecting a viewer ends delivery; already-started read/model requests remain bounded by their existing timeouts.

## Correct assignment details

Open a Canvas assignment or its study block on the calendar to edit the full instructions and text fields for points, attempts, grading, submission/file requirements, availability, access, and quiz requirements. **Save** stores corrections in this browser; **Cancel** discards the current draft, and **Reset to Canvas** restores imported values. Corrections are kept by school and assignment, with sample and live plans separated. Browser storage failures show a notice while keeping edits available for the current visit.

The JSON preserves original Canvas data alongside `assignment.userEdits`. Saved corrections are sent as optional `assignmentEdits` with the next generation request and supplied to LangChain when estimating the work. Canvas identifiers, titles, and personalized due dates remain canonical; editing an availability text field does not move deadlines or existing blocks. Generate again to update study placements after correcting requirements. This edits the app's local copy; Canvas is still accessed with read permissions only.

## Export to Google Calendar

On `/calendar`, **Export to Google Calendar** defaults to the **whole plan**: every generated study block and academic deadline, including dates outside the currently visible week. The control appears below **Open in Canvas** and in the calendar header, with the Google Calendar logo. Choose **Only this event** in the detail panel to export one study block or deadline instead. Imported Google events are already in the destination and are excluded.

The first export offers **Allow Calendar export**. Approve the additional [Calendar event write permission](https://developers.google.com/workspace/calendar/api/auth), return to the calendar, and export again. Only an explicit export button click calls Google's [event insertion API](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert); connecting accounts and generating plans do not write events. Exports go to the connected account's **primary Google Calendar**.

Study blocks retain their full interval, including blocks displayed across midnight. Deadlines become 15-minute events marked available so they do not reserve study time. Saved instructions and assignment corrections are included; unusually long descriptions are shortened with a source link to full instructions. Export reports created, existing, failed, and pending counts. Stable event IDs prevent duplicates when exporting again, exporting an individual item after the whole plan, or retrying after a partial failure. Export is a snapshot: later edits or a newly generated schedule do not update or remove previously exported events.

## Focus timer and streaks

Choose **Start timer** in the calendar toolbar or in a study block's details to open focus mode. A block starts with its full scheduled duration, including blocks displayed across midnight. The standalone `/focus` page offers 25-minute, 50-minute, and custom sessions from 1 to 240 minutes, without requiring a generated plan or connected account.

Focus mode shows the countdown, selected coursework, pause/resume, reset, and end controls. Returning to the calendar keeps the session running. The countdown uses an absolute end time, so background tabs and refreshes do not slow it down. Pausing preserves the remaining time; resetting starts a fresh paused session. Starting another timer returns to an existing active session instead of replacing it.

Only a completed countdown earns a session and streak credit. Resetting or ending early does not add credit. Multiple sessions on one date count as one streak day; a streak remains active through today when the latest completed day was yesterday. Calendar dates, the seven-day activity view, and today's totals use the selected study time zone. A timer completed while the page was closed is credited to its actual end time when restored.

The current timer and completed-session history are saved locally in this browser and synchronized between its tabs. Storage failures keep the timer usable for the current visit and display a notice. Timer progress does not modify the study plan, Canvas, or Google Calendar.

## How onboarding affects the plan

All eleven answer fields from Meher’s six questions are saved and sent in `preferences.onboardingAnswers`: `name`, `major`, `wake`, `sleep`, `studyHours`, `breakMinutes`, `breakFrequency`, `focusPeriod`, `focusTime`, and `deadlineDays`. The API validates these values and derives scheduling rules from the answers. The final JSON includes the preferences used to generate it.

The scheduler enforces minute-level awake hours (including overnight routines), a daily study limit, the selected study interval and break length, existing busy events, and actual assignment deadlines. Peak focus time and assignment lead time guide placement when capacity allows. Work that cannot fit is reported in `unscheduledTasks`; it is never silently dropped. Name and major provide context for the model without changing source deadlines. Change preferences, then generate again to update a plan.

The calendar adapts this same JSON rather than maintaining a second scheduling system. It shows generated study blocks, primary Google Calendar busy events, and coursework deadlines, with source links and factual details. Account tokens remain in the existing server integration; Sid’s browser token/proxy flow is not used.

### Integrated UI sources

- [Meher’s onboarding](https://github.com/meherd1-alt/ZotBlock), commit `a23abca` on `main`.
- [Sid’s calendar](https://github.com/sid12324/zotblock), commit `b13a31a` on `cursor/zotblock-calendar`.

Both React interfaces are ported into the existing Next.js app with styles scoped to their routes. Their separate build systems and sample account/token flows are not required.

## Storage and deployment

Provider access and refresh tokens are stored in encrypted, `HttpOnly`, same-site cookies. `SESSION_SECRET` must contain at least 32 characters and remain stable across app instances and restarts. Changing it invalidates existing connections. Cookies are marked secure in production, so deploy behind HTTPS.

Completed onboarding answers are stored in this browser’s `localStorage` and survive OAuth navigation and reloads. The generated plan is stored in the current browser tab's `sessionStorage` so `/calendar` and `/output` display the same result. It contains source email and coursework data. Output is local to that browser tab and is not a durable server history; closing the tab removes it.

Deploy with a Node.js server runtime, such as a standard Next.js hosting service. Set `APP_URL` to the public HTTPS origin, configure server environment variables on the host, and register that origin's exact Google and Canvas OAuth callback URLs. For a shared deployment, use Canvas OAuth and leave `CANVAS_ACCESS_TOKEN` unset. Localhost OAuth registrations do not cover the deployed URL. This app needs server route handlers and secrets; a static export is insufficient. No database is required for this prototype.

```sh
npm run build
npm start
```

## Development checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

These commands check the application and local planner behavior. Testing a real Google or Canvas connection also requires valid provider credentials and an authorized account.
