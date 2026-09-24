# PulseDesk Full-Stack Midterm Study Guide

This manual dissects the supplied PulseDesk mock-exam repository as an executable system. It is organized around the actual code paths: browser bootstrap, typed domain model, React state and API boundary, rendered UI, database initialization, Express middleware and routes, and build/runtime configuration.

## System Map

PulseDesk is an authenticated incident-management application.

```text
Browser
  -> main.tsx creates the React root
  -> IncidentProvider supplies global state and commands
  -> App chooses Login or Dashboard from state.user
  -> Dashboard event handler calls context command
  -> fetch sends HTTP request with JSON and Bearer token
  -> Express middleware parses JSON, enables CORS, authenticates JWT
  -> Zod validates request body
  -> pg Pool executes parameterized SQL
  -> PostgreSQL returns rows
  -> toIncident converts snake_case database data to camelCase API data
  -> JSON response returns to the browser
  -> context dispatches a reducer action
  -> React re-renders the affected view
  -> the browser DOM reflects new state
```

The major contracts are:

| Boundary | Input | Output |
| --- | --- | --- |
| Form | DOM events and strings | Typed command call |
| Context request helper | path, `RequestInit`, token | Parsed response data or thrown `Error` |
| Express route | HTTP request | HTTP status plus JSON |
| Zod schema | `unknown` request body | validated typed data or issues |
| PostgreSQL | parameterized SQL and values | rows / row count |
| `toIncident` | database row | frontend-shaped object |
| Reducer | current state plus discriminated action | new immutable state |
| React | state and props | virtual DOM / browser DOM |

---

# Frontend

## 1. Frontend Bootstrap: `main.tsx`

### 1. Context & Execution Flow

This is the browser entry point. Vite bundles the TypeScript module, the browser loads it, and `createRoot` attaches React to the existing `<div id="root">` in `index.html`. The provider is placed above `App`, so every descendant can call `useIncidents`.

The data lifecycle is initially simple:

```text
HTML root element -> createRoot -> StrictMode -> IncidentProvider -> App
```

`StrictMode` does not represent a second production application. In development it intentionally performs extra checks and may invoke render/effect paths more than once to expose unsafe side effects.

### 2. Full Code Snippet

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { IncidentProvider } from './context/IncidentContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <IncidentProvider>
      <App />
    </IncidentProvider>
  </StrictMode>,
)
```

### 3. Line-by-Line Syntax & Mechanism Breakdown

- `import { StrictMode } from 'react'`: named import. Braces select an exported binding rather than the module's default export.
- `import { createRoot } from 'react-dom/client'`: imports React 18/19's concurrent root API. `createRoot` replaces the older `ReactDOM.render` API.
- `import './index.css'`: side-effect import. No JavaScript value is imported; Vite includes the stylesheet in the bundle.
- `import App from './App.tsx'`: default import of the root application component. The `.tsx` extension permits JSX and TypeScript.
- `IncidentProvider` is imported as a named export and later used as a JSX component.
- `document.getElementById('root')`: DOM lookup returns `HTMLElement | null`. The `!` is the TypeScript non-null assertion; it tells the compiler the element exists. It changes no runtime behavior. If the element were absent, `createRoot` would still fail at runtime.
- `.render(...)`: tells React what tree to mount. React owns the descendants of the root element after this point.
- `<StrictMode>`, `<IncidentProvider>`, and `<App />` are nested JSX elements. JSX compiles into React element creation calls.
- The trailing comma after `</StrictMode>,` is legal in a function argument list and makes later edits cleaner.

### 4. Quick-Recall Cheat Sheet & Rules of Thumb

- Entry pattern: `createRoot(document.getElementById('root')!).render(<App />)`.
- Providers must wrap consumers.
- CSS imports are module side effects.
- `!` is compile-time only; it is not a runtime null check.
- Use `StrictMode` to find development-time side effects; do not rely on dev-only behavior in application logic.

---

## 2. Domain Types: `types.ts`

### 1. Context & Execution Flow

This file defines compile-time contracts shared by UI and context code. It does not execute in the browser as business logic: interfaces and type aliases are erased from emitted JavaScript. The types prevent invalid status/severity values and force reducer actions to carry the correct payload shape.

The backend returns `Incident`-shaped JSON after converting database naming conventions. The UI reads those properties, builds `Action` values, and the reducer returns a `State`.

### 2. Full Code Snippet

```ts
export type Severity = 'Low' | 'Medium' | 'High' | 'Critical'
export type IncidentStatus = 'Open' | 'In Progress' | 'Resolved'

export interface Incident {
  id: string
  title: string
  description: string
  severity: Severity
  status: IncidentStatus
  createdAt: string
  createdBy: string
}

export interface User { id: string; email: string }

export interface State {
  user: User | null
  token: string | null
  incidents: Incident[]
  loading: boolean
  error: string | null
}

export type Action =
  | { type: 'SET_AUTH'; payload: { user: User; token: string } }
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; payload: Incident[] }
  | { type: 'CREATE_SUCCESS'; payload: Incident }
  | { type: 'UPDATE_SUCCESS'; payload: Incident }
  | { type: 'DELETE_SUCCESS'; payload: string }
  | { type: 'SET_ERROR'; payload: string }
  | { type: 'LOGOUT' }
```

### 3. Line-by-Line Syntax & Mechanism Breakdown

- A string-literal union such as `Severity` permits exactly four strings. It is narrower than `string`, so typos fail at compile time.
- `IncidentStatus` has a multi-word literal. The value includes the space and must be compared exactly.
- `interface Incident` describes object structure. Required properties have no `?`; callers must provide them.
- `createdAt: string` is intentionally a transport representation. JSON has no `Date` type, so the backend serializes a date to ISO text.
- `User | null` is a union. Before authentication there is no user, so `null` models that state explicitly.
- `Incident[]` means an array whose elements must be valid incidents. `Incident[]` and `Array<Incident>` are equivalent here.
- `Action` is a union of object types discriminated by the common `type` property. A `switch (action.type)` narrows each case and exposes only the correct `payload`.
- `Pick<Incident, 'severity' | 'status'>` later derives a smaller update object without duplicating property types.
- Types do not validate network data at runtime. `fetch` can still receive malformed JSON; Zod on the server and careful response handling address runtime boundaries.

### 4. Quick-Recall Cheat Sheet & Rules of Thumb

- Use literal unions for finite domain values.
- Use `T | null` for an intentionally empty value.
- Use discriminated unions for reducer actions.
- `interface` describes object shape; `type` is convenient for unions and aliases.
- TypeScript catches developer mistakes, not hostile or malformed HTTP input at runtime.

---

## 3. Global State, Reducer, Context, and API Client: `IncidentContext.tsx`

### 1. Context & Execution Flow

This is the frontend's application service layer. It performs four jobs:

1. Stores global authentication, incident, loading, and error state.
2. Defines pure state transitions in `reducer`.
3. Wraps the API with `request`, which adds JSON and authorization headers and turns non-2xx responses into exceptions.
4. Exposes commands (`login`, `createIncident`, `updateIncident`, `deleteIncident`, `logout`) through React Context.

Login flow:

```text
Login form -> login(email, password)
-> POST /api/auth/login
-> server returns token and user
-> localStorage token
-> SET_AUTH
-> loadIncidents(token)
-> FETCH_START -> GET /api/incidents -> FETCH_SUCCESS
-> Dashboard renders
```

Mutation flow:

```text
Dashboard control -> context command -> fetch with Bearer token
-> route returns incident / 204
-> reducer action -> new array/object state
-> React re-render
```

### 2. Full Code Snippet

```tsx
import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react'
import type { Action, Incident, State, User } from '../types'

const API_URL = 'http://localhost:3000/api'
const initialState: State = {
  user: null,
  token: localStorage.getItem('token'),
  incidents: [],
  loading: false,
  error: null,
}

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'SET_AUTH': return { ...state, user: action.payload.user, token: action.payload.token, error: null }
    case 'FETCH_START': return { ...state, loading: true, error: null }
    case 'FETCH_SUCCESS': return { ...state, incidents: action.payload, loading: false }
    case 'CREATE_SUCCESS': return { ...state, incidents: [action.payload, ...state.incidents], loading: false }
    case 'UPDATE_SUCCESS': return { ...state, incidents: state.incidents.map((incident) => incident.id === action.payload.id ? action.payload : incident), loading: false }
    case 'DELETE_SUCCESS': return { ...state, incidents: state.incidents.filter((incident) => incident.id !== action.payload), loading: false }
    case 'SET_ERROR': return { ...state, loading: false, error: action.payload }
    case 'LOGOUT': return { ...initialState, token: null }
  }
}

interface IncidentContextValue {
  state: State
  dispatch: Dispatch<Action>
  login: (email: string, password: string) => Promise<void>
  createIncident: (incident: Pick<Incident, 'title' | 'description' | 'severity'>) => Promise<void>
  updateIncident: (id: string, changes: Pick<Incident, 'severity' | 'status'>) => Promise<void>
  deleteIncident: (id: string) => Promise<void>
  logout: () => void
}

const IncidentContext = createContext<IncidentContextValue | null>(null)

const request = async (path: string, options: RequestInit = {}, token?: string | null) => {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  const data = await response.json().catch(() => ({})) as {
    message?: string
    user?: User
    token?: string
    incident?: Incident
    incidents?: Incident[]
  }
  if (!response.ok) throw new Error(data.message ?? 'Something went wrong')
  return data
}

export function IncidentProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const loadIncidents = async (token = state.token) => {
    if (!token) return
    dispatch({ type: 'FETCH_START' })
    try {
      const data = await request('/incidents', {}, token)
      dispatch({ type: 'FETCH_SUCCESS', payload: data.incidents ?? [] })
    } catch (error) {
      dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Unable to load incidents' })
    }
  }

  const login = async (email: string, password: string) => {
    try {
      const data = await request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
      if (!data.user || !data.token) throw new Error('Invalid login response')
      localStorage.setItem('token', data.token)
      dispatch({ type: 'SET_AUTH', payload: { user: data.user, token: data.token } })
      await loadIncidents(data.token)
    } catch (error) {
      dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Unable to sign in' })
      throw error
    }
  }

  const createIncident = async (incident: Pick<Incident, 'title' | 'description' | 'severity'>) => {
    try {
      const data = await request('/incidents', { method: 'POST', body: JSON.stringify(incident) }, state.token)
      if (data.incident) dispatch({ type: 'CREATE_SUCCESS', payload: data.incident })
    } catch (error) {
      dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Unable to create incident' })
    }
  }

  const updateIncident = async (id: string, changes: Pick<Incident, 'severity' | 'status'>) => {
    try {
      const data = await request(`/incidents/${id}`, { method: 'PATCH', body: JSON.stringify(changes) }, state.token)
      if (data.incident) dispatch({ type: 'UPDATE_SUCCESS', payload: data.incident })
    } catch (error) {
      dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Unable to update incident' })
    }
  }

  const deleteIncident = async (id: string) => {
    try {
      await request(`/incidents/${id}`, { method: 'DELETE' }, state.token)
      dispatch({ type: 'DELETE_SUCCESS', payload: id })
    } catch (error) {
      dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Unable to delete incident' })
    }
  }

  const logout = () => {
    localStorage.removeItem('token')
    dispatch({ type: 'LOGOUT' })
  }

  return <IncidentContext.Provider value={{ state, dispatch, login, createIncident, updateIncident, deleteIncident, logout }}>{children}</IncidentContext.Provider>
}

export const useIncidents = () => {
  const context = useContext(IncidentContext)
  if (!context) throw new Error('useIncidents must be used inside IncidentProvider')
  return context
}
```

### 3. Line-by-Line Syntax & Mechanism Breakdown

#### Imports and initial state

- `createContext`, `useContext`, and `useReducer` are React APIs. `type Dispatch` and `type ReactNode` are type-only imports; `verbatimModuleSyntax` keeps type/value imports distinct.
- `API_URL` is a module constant. Centralizing the base URL avoids repeating it in every command, although production code normally uses an environment variable.
- `localStorage.getItem('token')` runs during module initialization. It returns `string | null`. A browser refresh retains the token, but this code does not reconstruct `state.user`, so a persisted token alone does not make `App` show `Dashboard`.
- `initialState` is a typed object. The `State` annotation checks every required property.

#### Reducer and immutable updates

- `reducer` is a function from `(state, action)` to a new `State`. It should be pure: no fetch, localStorage write, DOM mutation, or random value generation belongs inside it.
- `switch (action.type)` uses the discriminant to narrow the union. Each case returns immediately.
- `{ ...state }` is object spread. It copies top-level properties and then overwrites selected ones. It is shallow, which is enough because each changed array is also recreated.
- `CREATE_SUCCESS` uses `[action.payload, ...state.incidents]` to prepend the server-created incident without mutating the existing array.
- `UPDATE_SUCCESS` uses `map`, a higher-order function. Every element is visited; the matching element is replaced, and others retain their references.
- `DELETE_SUCCESS` uses `filter`, producing a new array containing every nonmatching incident.
- `SET_ERROR` sets `loading: false` and stores a message. Notice that success actions do not clear `error`; an old error can remain visible after later successful operations. That is a behavioral detail worth recognizing in an exam review.
- `LOGOUT` spreads `initialState` and explicitly sets `token: null`. Because `initialState.token` may be a persisted token, the explicit override is important.
- There is no `default` case. TypeScript can verify the known union cases in this configuration, but a runtime caller could still pass an invalid object. A production reducer may add an exhaustive `never` check.

#### Context contract and API helper

- `IncidentContextValue` is the public service contract exposed to components. The function signatures document accepted arguments and `Promise<void>` completion.
- `Dispatch<Action>` is React's dispatch function specialized to accept only the `Action` union.
- `createContext<IncidentContextValue | null>(null)` starts with no provider value. `null` makes misuse detectable rather than hiding it behind an unsafe default object.
- `request` is an async arrow function. It returns a promise that resolves to parsed data or rejects when a network/HTTP problem occurs.
- `RequestInit = {}` supplies a default options object. Callers can omit options for a GET.
- `` `${API_URL}${path}` `` is a template literal. It interpolates expressions without manual concatenation.
- `{ ...options, headers: ... }` preserves method/body/options while replacing the headers property with a merged object.
- `...(token ? { Authorization: ... } : {})` is conditional object spread. With a token it creates an authorization header; without one it spreads an empty object.
- `...options.headers` is last, so caller-supplied headers override defaults. This is flexible but means a caller could override `Authorization`.
- `response.json()` returns a promise. `.catch(() => ({}))` handles an empty/non-JSON response, especially the `204 No Content` delete response.
- `as { ... }` is a type assertion. It tells TypeScript how the value is treated; it does not validate the JSON at runtime.
- `response.ok` is true for status 200 through 299. `fetch` itself does not reject for HTTP 400/500, so the explicit `!response.ok` check is necessary.
- `??` is nullish coalescing. It uses the fallback only when `data.message` is `null` or `undefined`, not when it is an empty string.

#### Provider commands and closures

- `IncidentProvider({ children }: { children: ReactNode })` destructures props and annotates the parameter inline. `ReactNode` includes JSX, strings, fragments, and other renderable values.
- `useReducer(reducer, initialState)` returns `[state, dispatch]`. Dispatching schedules a re-render; it does not directly mutate `state`.
- `loadIncidents = async (token = state.token)` uses a default parameter. Login passes a fresh token explicitly, avoiding reliance on stale state during the same function call.
- The command functions close over `state` and `dispatch`. A closure retains access to variables from the provider render that created it.
- `await` pauses the async function until the request settles, while allowing the browser event loop to continue.
- `instanceof Error` narrows an unknown caught value. In JavaScript anything can be thrown, not only `Error` objects.
- `throw error` in `login` re-rejects the promise after context state is updated. `Login` catches it so an expected authentication failure does not become an unhandled rejection.
- `JSON.stringify` serializes the object into an HTTP JSON request body. The server's `express.json()` parses it back into an object.
- The create/update/delete methods swallow errors after dispatching `SET_ERROR`; callers do not receive the rejection. Consequently, `submitIncident` resets/closes its form even when creation fails. This is an exam-worthy error-handling design limitation.
- `IncidentContext.Provider value={{ ... }}` supplies one object to all descendants. Any state update causes consumers to re-render; this implementation does not memoize the value.
- `useIncidents` calls `useContext`. The guard throws a useful error when the hook is used outside its provider.

### 4. Quick-Recall Cheat Sheet & Rules of Thumb

- Reducer formula: `newState = reducer(oldState, action)`.
- Never mutate reducer state; use spread, `map`, and `filter`.
- `fetch` rejects network failures, not HTTP error statuses; check `response.ok`.
- `response.json()` is asynchronous and can fail on `204`.
- Put auth headers in one request helper.
- Pass a newly received token explicitly when immediately making a follow-up request.
- Type assertions (`as`) do not runtime-validate JSON.
- Context gives access; reducer gives predictable transitions; command functions coordinate side effects.

---

## 4. React UI Components: `App.tsx`

### 1. Context & Execution Flow

`App` is the presentation and interaction layer. It reads context state, chooses authentication versus dashboard, controls local form/filter state, and delegates persistence to context commands.

There are three component paths:

```text
App -> state.user ? Dashboard : Login
Login form -> login -> context -> server
Dashboard -> IncidentRow controls -> update/delete -> context -> server
Dashboard new-incident form -> create -> context -> server
```

The server response is the source of truth for created and updated records. The dashboard then renders from `state.incidents`, not directly from a form result.

### 2. Full Code Snippet

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useIncidents } from './context/IncidentContext'
import type { Incident, IncidentStatus, Severity } from './types'
import './App.css'

const severities: Severity[] = ['Low', 'Medium', 'High', 'Critical']
const statuses: IncidentStatus[] = ['Open', 'In Progress', 'Resolved']

function Login() {
  const { state, login } = useIncidents()
  const [email, setEmail] = useState('admin@pulsedesk.com')
  const [password, setPassword] = useState('password')
  const [submitting, setSubmitting] = useState(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    try { await login(email, password) }
    catch { /* error is rendered from context */ }
    finally { setSubmitting(false) }
  }
  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand-mark">P</div>
        <p className="eyebrow">IT OPERATIONS</p>
        <h1>Welcome to PulseDesk</h1>
        <p className="muted">Keep every incident moving toward resolution.</p>
        <form onSubmit={submit}>
          <label>Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label>Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} />
          </label>
          {state.error && <p className="error">{state.error}</p>}
          <button className="primary-button" disabled={submitting}>
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <p className="demo-hint">Demo access is prefilled.</p>
      </section>
    </main>
  )
}

function IncidentRow({ incident, onUpdate, onDelete }: {
  incident: Incident
  onUpdate: (id: string, changes: Pick<Incident, 'severity' | 'status'>) => void
  onDelete: (id: string) => void
}) {
  return (
    <article className="incident-row">
      <div className="incident-main">
        <span className={`severity-dot ${incident.severity.toLowerCase()}`} />
        <div>
          <div className="incident-title">
            <strong>{incident.title}</strong>
            <span className="incident-id">{incident.id}</span>
          </div>
          <p>{incident.description}</p>
          <small>{new Date(incident.createdAt).toLocaleDateString()} · {incident.createdBy}</small>
        </div>
      </div>
      <div className="incident-controls">
        <select aria-label={`${incident.id} status`} value={incident.status}
          onChange={(event) => onUpdate(incident.id, {
            status: event.target.value as IncidentStatus,
            severity: incident.severity,
          })}>
          {statuses.map((status) => <option key={status}>{status}</option>)}
        </select>
        <select aria-label={`${incident.id} severity`} value={incident.severity}
          onChange={(event) => onUpdate(incident.id, {
            status: incident.status,
            severity: event.target.value as Severity,
          })}>
          {severities.map((severity) => <option key={severity}>{severity}</option>)}
        </select>
        <button className="icon-button" title="Delete incident" onClick={() => onDelete(incident.id)}>x</button>
      </div>
    </article>
  )
}

function Dashboard() {
  const { state, createIncident, updateIncident, deleteIncident, logout } = useIncidents()
  const [showForm, setShowForm] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'All' | IncidentStatus>('All')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState<Severity>('Medium')

  useEffect(() => { if (!state.token) return }, [state.token])

  const filteredIncidents = useMemo(
    () => state.incidents.filter((incident) =>
      (filter === 'All' || incident.status === filter) &&
      `${incident.title} ${incident.description} ${incident.id}`.toLowerCase().includes(query.toLowerCase()),
    ),
    [filter, query, state.incidents],
  )

  const counts = {
    total: state.incidents.length,
    open: state.incidents.filter((incident) => incident.status === 'Open').length,
    progress: state.incidents.filter((incident) => incident.status === 'In Progress').length,
    resolved: state.incidents.filter((incident) => incident.status === 'Resolved').length,
  }

  const submitIncident = async (event: React.FormEvent) => {
    event.preventDefault()
    await createIncident({ title, description, severity })
    setTitle('')
    setDescription('')
    setSeverity('Medium')
    setShowForm(false)
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="wordmark"><span className="brand-mark small">P</span><span>PulseDesk</span></div>
        <div className="user-menu"><span>{state.user?.email}</span><button onClick={logout}>Sign out</button></div>
      </header>
      <div className="content">
        <div className="page-heading">
          <div><p className="eyebrow">OPERATIONS CENTER</p><h1>Incident overview</h1><p className="muted">Track, prioritize, and resolve your team's technical issues.</p></div>
          <button className="primary-button" onClick={() => setShowForm(!showForm)}>+ New incident</button>
        </div>
        {state.error && <div className="error-banner">{state.error}</div>}
        <section className="stat-grid">
          <div><span>Total incidents</span><strong>{counts.total}</strong></div>
          <div><span>Open</span><strong>{counts.open}</strong></div>
          <div><span>In progress</span><strong>{counts.progress}</strong></div>
          <div><span>Resolved</span><strong>{counts.resolved}</strong></div>
        </section>
        {showForm && <form className="new-incident" onSubmit={submitIncident}>
          <div className="section-heading"><div><p className="eyebrow">CREATE INCIDENT</p><h2>What needs attention?</h2></div><button type="button" className="close-button" onClick={() => setShowForm(false)}>x</button></div>
          <label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Short summary" required minLength={3} /></label>
          <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Add useful context for the team" required minLength={5} /></label>
          <label>Severity<select value={severity} onChange={(event) => setSeverity(event.target.value as Severity)}>{severities.map((item) => <option key={item}>{item}</option>)}</select></label>
          <button className="primary-button">Create incident</button>
        </form>}
        <section className="incident-section">
          <div className="toolbar"><div><p className="eyebrow">ALL ACTIVITY</p><h2>Incidents</h2></div><div className="filters">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search incidents" aria-label="Search incidents" />
            <select value={filter} onChange={(event) => setFilter(event.target.value as 'All' | IncidentStatus)} aria-label="Filter incidents"><option>All</option>{statuses.map((status) => <option key={status}>{status}</option>)}</select>
          </div></div>
          <div className="incident-list">
            {state.loading ? <p className="empty-state">Loading incidents...</p> : filteredIncidents.length ? filteredIncidents.map((incident) => <IncidentRow key={incident.id} incident={incident} onUpdate={updateIncident} onDelete={deleteIncident} />) : <p className="empty-state">No incidents match your filters.</p>}
          </div>
        </section>
      </div>
    </main>
  )
}

export default function App() {
  const { state } = useIncidents()
  return state.user ? <Dashboard /> : <Login />
}
```

> The source uses the Unicode characters `×`, `＋`, and `·` for visual text. The snippet uses ASCII `x`, `+`, and `·` in a few places to keep this guide portable; the runtime patterns are identical.

### 3. Line-by-Line Syntax & Mechanism Breakdown

#### Shared constants and Login

- `useState` returns a value and setter. Calling `setEmail` schedules a render with the new value; it does not mutate `email` synchronously inside the current callback.
- `const [email, setEmail]` is array destructuring. The hook's first tuple element is the state value; the second is the updater.
- Controlled inputs use `value={email}` plus `onChange`. React is the source of truth, not the DOM's internal value.
- `event: React.FormEvent` types the form event. `event.preventDefault()` stops the browser's native page reload/navigation.
- `try/catch/finally` guarantees `setSubmitting(false)` after either success or failure. The button's `disabled` prop prevents repeated submissions while the promise is pending.
- `onSubmit={submit}` passes a function reference. `onSubmit={submit()}` would incorrectly call it during render.
- `required` and `minLength` activate browser constraint validation. They improve UX but do not replace server validation.
- `{state.error && <p ...>}` is conditional rendering. If the string is truthy, JSX is returned; if `null`, nothing is rendered.
- A ternary inside button children chooses a loading label. React escapes interpolated strings, helping prevent HTML injection.

#### IncidentRow and props

- The parameter destructures props and gives the destructured object an inline type. This makes the component's contract visible at its boundary.
- `Pick<Incident, 'severity' | 'status'>` requires both fields. The row sends the unchanged other field during a one-control update because the backend patch accepts optional properties but the frontend command type models a complete pair.
- `` `severity-dot ${incident.severity.toLowerCase()}` `` creates a dynamic CSS class. `High` becomes `severity-dot high`, which matches CSS selectors.
- `new Date(incident.createdAt)` converts ISO text to a date object. `toLocaleDateString()` formats it according to the user's locale.
- `map` creates one `<option>` per allowed value. `key={status}` gives React a stable identity for reconciliation.
- `event.target.value` is always a string in the DOM event API. `as IncidentStatus` narrows it for TypeScript but does not check the string at runtime; the select's options constrain normal UI input.
- `aria-label` supplies accessible names for controls whose visual context may not be enough to assistive technology.
- `onClick={() => onDelete(incident.id)}` is an arrow closure. It delays the call until the click and captures the current ID.

#### Dashboard state and derived data

- `showForm`, `query`, `filter`, `title`, `description`, and `severity` are local UI state. The incident list and auth state remain global because multiple views/commands need them.
- The union state `useState<'All' | IncidentStatus>('All')` lets the filter contain the special all-value or a valid incident status.
- `useEffect(() => { if (!state.token) return }, [state.token])` runs after render when the token changes. Its body currently has no side effect, so it is effectively a no-op. The dependency array is still important syntax: React compares dependencies using `Object.is` and reruns when one changes.
- `useMemo` caches the filtered array until `filter`, `query`, or `state.incidents` changes. This is derived data, not authoritative state.
- `.filter` applies the status condition and search condition. `&&` short-circuits: if the status test fails, the search expression is skipped.
- The template literal combines searchable fields; `.toLowerCase()` on both sides makes matching case-insensitive. `.includes` tests substring presence.
- `counts` is recomputed on every render with three filters. It is readable and correct; memoization is not necessary for this small collection.
- `submitIncident` prevents native form submission, awaits the context command, then resets local form state. Because the context command catches its own errors, the form closes even if the server rejected creation.

#### JSX rendering and conditional branches

- JSX attributes use camelCase React names: `className`, `onClick`, `onChange`, `minLength`.
- `state.user?.email` uses optional chaining. If `user` is null, the expression evaluates to `undefined` instead of throwing.
- `{showForm && <form ...>}` mounts/unmounts the form. Closing it removes the subtree from the DOM but state values remain in the Dashboard component until reset or unmount.
- The loading expression is a nested conditional: loading message first; otherwise a nonempty filtered list is mapped; otherwise an empty state is shown.
- `key={incident.id}` is for React reconciliation and is not passed as a normal prop to `IncidentRow`.
- `App` uses a ternary as a route-like view switch. There is no router: authentication state decides which component tree exists.

### 4. Quick-Recall Cheat Sheet & Rules of Thumb

- Controlled input: `value={state}` + `onChange={event => setState(event.target.value)}`.
- Submit pattern: `preventDefault`, set pending, `await`, `finally` clear pending.
- Use `map` to render repeated elements and provide a stable `key`.
- Use `filter` for search/status selection; use `useMemo` only for derived work worth caching.
- `&&` conditionally renders; `condition ? A : B` selects exactly one branch.
- DOM values are strings; type assertions do not validate them.
- Keep server-backed records in shared state and transient form fields local.

---

## 5. Styling and CSS Cascade: `index.css` and `App.css`

### 1. Context & Execution Flow

`index.css` is imported by `main.tsx`; `App.css` is imported by `App.tsx`. Vite bundles both into the page. CSS selectors then style the DOM produced by React. The stylesheet has two layers:

1. PulseDesk's actual design tokens and layout rules.
2. Leftover Vite starter selectors (`.counter`, `.hero`, `#next-steps`, and related variables) that are mostly unused by the current JSX.

The browser resolves competing rules using origin, importance, specificity, and source order. For example, later `h1` rules in `index.css` can override earlier values from the same stylesheet, while `.page-heading h1` would be more specific than a bare `h1`.

### 2. Full Code Snippet

```css
/* Global baseline from index.css */
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap');
:root { font-family: 'DM Sans', sans-serif; color: #17212b; background: #f4f6f7; font-synthesis: none; text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased; }
* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; }
button, input, textarea, select { font: inherit; }

/* Application tokens and layout from App.css */
:root { --ink: #17212b; --muted: #72808b; --line: #dfe5e8; --blue: #1e6a8c; --pale-blue: #e8f2f5; --red: #ce5f54; }
.app-shell { min-height: 100vh; background: #f4f6f7; }
.topbar { height: 76px; padding: 0 6vw; display: flex; align-items: center; justify-content: space-between; background: #fff; border-bottom: 1px solid var(--line); }
.content { width: min(1120px, calc(100% - 48px)); margin: 0 auto; padding: 58px 0 80px; }
.stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); margin: 50px 0 36px; border: 1px solid var(--line); background: #fff; }
.incident-row { display: flex; justify-content: space-between; gap: 24px; padding: 23px 20px; border-bottom: 1px solid var(--line); }
@media (max-width: 700px) {
  .content { width: min(100% - 32px, 560px); padding-top: 35px; }
  .page-heading, .toolbar { align-items: stretch; flex-direction: column; }
  .stat-grid { grid-template-columns: repeat(2, 1fr); margin-top: 35px; }
  .incident-row { flex-direction: column; }
}
```

### 3. Line-by-Line Syntax & Mechanism Breakdown

- `@import` loads external fonts. It can delay font rendering and depends on network access; production apps often self-host or preload fonts.
- `:root` is the document root and a conventional place for CSS custom properties. `var(--blue)` reads the custom property.
- `box-sizing: border-box` makes declared width include padding and border, simplifying responsive sizing.
- `min-height: 100vh` fills at least the viewport height. `min-width: 320px` prevents layouts from collapsing below a chosen minimum.
- `display: flex` creates a one-dimensional flex layout. `justify-content: space-between` distributes horizontal free space; `align-items` controls the cross axis.
- `display: grid` creates a two-dimensional layout. `repeat(4, 1fr)` makes four equal tracks; the media query reduces this to two.
- `calc(100% - 48px)` reserves side space. `min(1120px, ...)` chooses the smaller constraint, producing a capped but fluid content column.
- `border`, `padding`, `margin`, and `gap` affect box geometry. Because `box-sizing` is global, inputs and cards remain more predictable.
- `@media (max-width: 700px)` conditionally applies mobile rules based on viewport width.
- CSS custom properties centralize color values and make a theme easier to revise.
- The full repository also contains nested CSS syntax such as `.hero { .base { ... } }` and nested `@media` blocks from the Vite starter. This is modern CSS nesting syntax and may depend on the configured browser/toolchain; it is unrelated to the PulseDesk JSX.
- The starter `index.css` later defines another `:root`, `h1`, `h2`, and `body`, and a `prefers-color-scheme: dark` block. Later declarations and specificity can alter the earlier baseline. Always inspect the final cascade in browser devtools rather than assuming the first declaration wins.

### 4. Quick-Recall Cheat Sheet & Rules of Thumb

- Tokens: define `--name` on `:root`, consume with `var(--name)`.
- Responsive pattern: fluid width plus `max/min` and a breakpoint.
- Flex is ideal for rows/toolbars; grid is ideal for repeated columns.
- `box-sizing: border-box` makes width calculations intuitive.
- Later rules can override earlier rules; specificity and source order both matter.
- CSS is presentation only: server validation and React state remain independent of styling.

---

# Backend

## 6. PostgreSQL Pool, Schema, Seed Data, and Mapping: `db.ts`

### 1. Context & Execution Flow

This module owns database connectivity and startup preparation. It creates a reusable `pg.Pool`, defines the database-row shape, maps snake_case PostgreSQL fields into the frontend API shape, creates tables idempotently, and inserts demo records if needed.

Startup flow:

```text
server imports db.ts
-> dotenv loads environment variables
-> Pool is constructed
-> initializeDatabase()
-> CREATE TABLE IF NOT EXISTS users/incidents
-> ensure demo user exists
-> ensure demo incidents exist
-> server starts listening
```

Request flow through the mapper:

```text
SQL row { created_at, created_by }
-> toIncident(row)
-> JSON { createdAt, createdBy }
-> frontend Incident interface
```

### 2. Full Code Snippet

```ts
import { Pool } from 'pg'
import dotenv from 'dotenv'
import bcrypt from 'bcryptjs'

dotenv.config()

export const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: Number(process.env.PGPORT) || 5432,
})

export interface IncidentRow {
  id: string
  title: string
  description: string
  severity: 'Low' | 'Medium' | 'High' | 'Critical'
  status: 'Open' | 'In Progress' | 'Resolved'
  created_at: Date
  created_by: string
}

export const toIncident = (row: IncidentRow) => ({
  id: row.id,
  title: row.title,
  description: row.description,
  severity: row.severity,
  status: row.status,
  createdAt: row.created_at.toISOString(),
  createdBy: row.created_by,
})

export async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('Low', 'Medium', 'High', 'Critical')),
      status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'In Progress', 'Resolved')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT NOT NULL REFERENCES users(email)
    );
  `)

  const user = await pool.query('SELECT id FROM users WHERE email = $1', ['admin@pulsedesk.com'])
  if (user.rowCount === 0) {
    const passwordHash = await bcrypt.hash('password', 10)
    await pool.query('INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)', ['usr-1', 'admin@pulsedesk.com', passwordHash])
  }

  const incidentCount = await pool.query('SELECT COUNT(*)::int AS count FROM incidents')
  if (incidentCount.rows[0].count === 0) {
    await pool.query(
      `INSERT INTO incidents (id, title, description, severity, status, created_at, created_by)
       VALUES ($1, $2, $3, $4, $5, NOW() - INTERVAL '1 hour', $6),
              ($7, $8, $9, $10, $11, NOW() - INTERVAL '1 day', $6)`,
      ['INC-1042', 'VPN access unavailable', 'Remote staff cannot connect to the corporate VPN.', 'High', 'In Progress', 'admin@pulsedesk.com', 'INC-1041', 'Printer queue stalled', 'Finance printer is holding jobs in the queue.', 'Medium', 'Open'],
    )
  }
}
```

### 3. Line-by-Line Syntax & Mechanism Breakdown

- `Pool` manages multiple reusable database connections. A pool avoids opening a brand-new TCP/database connection for every request.
- `dotenv.config()` reads `.env` values into `process.env`. It must happen before the pool reads connection settings.
- `Number(process.env.PGPORT) || 5432` converts text environment configuration to a number and supplies a fallback when conversion yields a falsy value. A malformed nonempty string produces `NaN`, which also falls back because `NaN` is falsy.
- The `IncidentRow` interface uses database column names (`created_at`). This separates storage shape from API shape.
- `Date` describes the value returned by the PostgreSQL driver for a timestamp. `toISOString()` serializes it into a timezone-aware JSON-friendly string.
- `toIncident` is a pure adapter. It creates a new object and deliberately changes `snake_case` to `camelCase`, matching frontend conventions.
- `async function initializeDatabase()` returns a promise. Startup can await it before accepting traffic.
- A template literal contains multiple SQL statements. `IF NOT EXISTS` makes repeated startup safe for existing tables.
- `PRIMARY KEY` enforces unique non-null IDs. `UNIQUE` protects duplicate emails. `NOT NULL` makes required fields mandatory.
- `TIMESTAMPTZ` stores a timezone-aware timestamp. `DEFAULT NOW()` lets PostgreSQL create timestamps when inserts omit them.
- `CHECK (severity IN (...))` and the status check are database-level invariants. Validation is duplicated intentionally at multiple trust boundaries.
- `REFERENCES users(email)` is a foreign key. The incident creator must correspond to an existing user email.
- `$1`, `$2`, and so on are positional parameters. The values array is sent separately, preventing SQL injection and avoiding manual quoting.
- `rowCount === 0` checks whether the seed lookup found no user. Seed logic is conditional and idempotent across restarts.
- `bcrypt.hash('password', 10)` uses a one-way adaptive password hash. `10` is the cost factor, commonly called salt rounds.
- `COUNT(*)::int` is PostgreSQL cast syntax. PostgreSQL aggregate counts can otherwise be returned as a wider numeric type/string depending on driver behavior.
- `NOW() - INTERVAL '1 hour'` creates realistic demo timestamps in SQL.

### 4. Quick-Recall Cheat Sheet & Rules of Thumb

- Pool once, reuse connections.
- Load environment variables before constructing the pool.
- Hash passwords; never store plaintext passwords.
- Use parameterized SQL: query text plus a values array.
- Enforce invariants in both Zod/application code and the database.
- Adapt database naming to API naming at one explicit boundary.
- `CREATE IF NOT EXISTS` and conditional seed checks make startup repeatable.

---

## 7. Express Bootstrap, Middleware, JWT Authentication, and Validation: `server.ts`

### 1. Context & Execution Flow

The server module constructs the HTTP application and registers all middleware/routes. Its control pipeline is:

```text
Request
-> cors middleware
-> express.json middleware
-> route matching
-> authenticate for protected routes
-> Zod body validation where needed
-> database operation
-> response or error response
```

Startup is deliberately gated on the database:

```text
initializeDatabase()
-> success: app.listen(PORT)
-> failure: log and process.exit(1)
```

### 2. Full Code Snippet

```ts
import 'dotenv/config'
import cors from 'cors'
import express, { type Request, type Response, type NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { initializeDatabase, pool, toIncident, type IncidentRow } from './db.js'

const app = express()
const PORT = Number(process.env.PORT) || 3000
const JWT_SECRET = process.env.JWT_SECRET || 'pulsedesk-local-secret'
const loginSchema = z.object({ email: z.email(), password: z.string().min(6) })
const createIncidentSchema = z.object({ title: z.string().min(3), description: z.string().min(5), severity: z.enum(['Low', 'Medium', 'High', 'Critical']) })
const updateIncidentSchema = z.object({ severity: z.enum(['Low', 'Medium', 'High', 'Critical']).optional(), status: z.enum(['Open', 'In Progress', 'Resolved']).optional() })

declare global { namespace Express { interface Request { userEmail?: string } } }
app.use(cors())
app.use(express.json())

const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const token = req.header('Authorization')?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ message: 'Authentication required' })
  try {
    req.userEmail = (jwt.verify(token, JWT_SECRET) as { email: string }).email
    next()
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' })
  }
}
```

### 3. Line-by-Line Syntax & Mechanism Breakdown

- `import 'dotenv/config'` is a side-effect import that configures environment variables immediately.
- `cors()` adds CORS response headers so a frontend on another origin can call the API. CORS is a browser policy mechanism, not authentication.
- `express()` creates an application object. `app.use` registers middleware in order.
- `type Request` imports only TypeScript names. The `.js` suffix on the local `db` import is required by NodeNext-style ESM resolution even though the source is TypeScript.
- `PORT` and `JWT_SECRET` read configuration and provide local-development defaults. A real production secret should be required and kept outside source control; a fallback secret makes local startup convenient but predictable.
- `z.object` describes an object schema. `z.email()` validates the email format; `z.string().min(6)` requires a string with at least six characters.
- `z.enum([...])` restricts values to the listed literals at runtime and produces corresponding TypeScript inference.
- `.optional()` means the property may be absent. The update schema permits partial updates, but the route separately rejects an empty patch.
- `declare global` augments Express's `Request` interface. It tells TypeScript that middleware may attach `userEmail`; it does not create a runtime property.
- Middleware order matters: JSON parsing must happen before routes read `req.body`.
- `authenticate` has the Express middleware signature `(req, res, next)`. Calling `next()` passes control to the route; returning a response terminates the path.
- `req.header('Authorization')` reads a request header. Optional chaining permits an absent header.
- `.replace('Bearer ', '')` removes the expected scheme prefix. This implementation does not explicitly verify the header starts with the scheme; JWT verification still rejects malformed tokens, but strict parsing could be improved.
- `jwt.verify` checks signature and expiration and returns decoded claims or throws. The `as { email: string }` assertion trusts the claim shape at compile time; runtime schema validation of claims would be stronger.
- Authentication stores only `email` on the request. The route later uses it as the `created_by` foreign-key value.

### 4. Quick-Recall Cheat Sheet & Rules of Thumb

- Register global middleware before routes.
- `express.json()` turns JSON bytes into `req.body`.
- Middleware either sends a response or calls `next()`.
- `jwt.sign` creates; `jwt.verify` checks and decodes.
- CORS allows browser cross-origin access; it does not prove identity.
- Validate untrusted body data at runtime with Zod.
- Type augmentation changes compiler knowledge, not runtime behavior.

---

## 8. Authentication Route: Login, bcrypt, JWT, and HTTP Statuses

### 1. Context & Execution Flow

The login route is public because a user needs it before possessing a token.

```text
POST /api/auth/login { email, password }
-> safeParse body
-> 400 if malformed
-> SELECT user by email
-> bcrypt.compare submitted password with stored hash
-> 401 if no user or mismatch
-> jwt.sign claims for 8 hours
-> 200 JSON token and safe user fields
```

The route intentionally does not return `password_hash` to the browser.

### 2. Full Code Snippet

```ts
app.post('/api/auth/login', async (req, res) => {
  const result = loginSchema.safeParse(req.body)
  if (!result.success) return res.status(400).json({ message: 'Enter a valid email and a password of at least 6 characters' })
  try {
    const userResult = await pool.query<{ id: string; email: string; password_hash: string }>(
      'SELECT id, email, password_hash FROM users WHERE email = $1',
      [result.data.email],
    )
    const user = userResult.rows[0]
    if (!user || !(await bcrypt.compare(result.data.password, user.password_hash))) return res.status(401).json({ message: 'Incorrect email or password' })
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '8h' })
    return res.json({ token, user: { id: user.id, email: user.email } })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ message: 'Database error during login' })
  }
})
```

### 3. Line-by-Line Syntax & Mechanism Breakdown

- `app.post(path, handler)` registers a handler for the POST method and exact path.
- `async (req, res) =>` allows `await` for database and bcrypt promises. Express catches async behavior according to its version/configuration, but explicit error handling here keeps response behavior clear.
- `safeParse` returns a result object rather than throwing. This is useful for expected user-input failure: inspect `success`, then use `result.data` only in the success branch.
- `pool.query<T>` supplies a TypeScript row type parameter. It documents the selected columns; it does not validate returned database data.
- `rows[0]` retrieves the first matching user. It may be `undefined`, which is why `!user` appears in the condition.
- `||` short-circuits: if no user exists, bcrypt is not called. This avoids dereferencing `password_hash` on undefined.
- `bcrypt.compare` hashes/checks the submitted plaintext against the stored salted hash. The plaintext is not stored.
- The combined failure message avoids revealing whether the email or password was wrong, reducing account enumeration clues.
- `jwt.sign` creates a signed, encoded token. JWT payload data is readable by clients; the signature protects integrity, not secrecy. `expiresIn: '8h'` creates an expiry claim.
- `return res.json(...)` ends the handler and sends HTTP 200 by default. Returning helps prevent later code from executing.
- `try/catch` converts database/cryptographic exceptions into a 500 response. The server logs the actual error but exposes a generic message.

### 4. Quick-Recall Cheat Sheet & Rules of Thumb

- Validate before querying.
- `safeParse`: branch on `success`; use `.data` after success.
- Compare passwords with `bcrypt.compare`, never direct equality.
- JWTs are signed, not encrypted.
- Return only safe user fields.
- Common statuses: `400` bad input, `401` unauthenticated/invalid credentials, `500` server failure.

---

## 9. Incident CRUD Routes

### 1. Context & Execution Flow

These four routes implement protected read/create/update/delete operations. Every route first authenticates. Each then validates or performs the database operation and serializes the result into the frontend contract.

```text
GET    /api/incidents       -> list rows newest first
POST   /api/incidents       -> validate, insert Open incident, return 201
PATCH  /api/incidents/:id   -> validate partial change, read current, update, return row
DELETE /api/incidents/:id   -> delete by ID, return 204 or 404
```

### 2. Full Code Snippet

```ts
app.get('/api/incidents', authenticate, async (_req, res) => {
  try {
    const result = await pool.query<IncidentRow>(
      'SELECT id, title, description, severity, status, created_at, created_by FROM incidents ORDER BY created_at DESC',
    )
    return res.json({ incidents: result.rows.map(toIncident) })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ message: 'Unable to load incidents' })
  }
})

app.post('/api/incidents', authenticate, async (req, res) => {
  const result = createIncidentSchema.safeParse(req.body)
  if (!result.success) return res.status(400).json({ message: 'Title, description, and severity are required' })
  try {
    const id = `INC-${Date.now()}`
    const inserted = await pool.query<IncidentRow>(
      `INSERT INTO incidents (id, title, description, severity, status, created_by)
       VALUES ($1, $2, $3, $4, 'Open', $5)
       RETURNING id, title, description, severity, status, created_at, created_by`,
      [id, result.data.title, result.data.description, result.data.severity, req.userEmail],
    )
    return res.status(201).json({ incident: toIncident(inserted.rows[0]) })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ message: 'Unable to create incident' })
  }
})

app.patch('/api/incidents/:id', authenticate, async (req, res) => {
  const result = updateIncidentSchema.safeParse(req.body)
  if (!result.success || (!result.data.status && !result.data.severity)) return res.status(400).json({ message: 'Invalid incident update' })
  try {
    const current = await pool.query<IncidentRow>(
      'SELECT id, title, description, severity, status, created_at, created_by FROM incidents WHERE id = $1',
      [req.params.id],
    )
    if (!current.rows[0]) return res.status(404).json({ message: 'Incident not found' })
    const incident = current.rows[0]
    const updated = await pool.query<IncidentRow>(
      `UPDATE incidents SET severity = $1, status = $2 WHERE id = $3
       RETURNING id, title, description, severity, status, created_at, created_by`,
      [result.data.severity ?? incident.severity, result.data.status ?? incident.status, req.params.id],
    )
    return res.json({ incident: toIncident(updated.rows[0]) })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ message: 'Unable to update incident' })
  }
})

app.delete('/api/incidents/:id', authenticate, async (req, res) => {
  try {
    const deleted = await pool.query('DELETE FROM incidents WHERE id = $1', [req.params.id])
    if (deleted.rowCount === 0) return res.status(404).json({ message: 'Incident not found' })
    return res.status(204).send()
  } catch (error) {
    console.error(error)
    return res.status(500).json({ message: 'Unable to delete incident' })
  }
})
```

### 3. Line-by-Line Syntax & Mechanism Breakdown

#### GET

- `_req` names the unused request parameter conventionally. With `noUnusedParameters`, the underscore communicates intentional non-use.
- `authenticate` runs before the async handler. A request without a valid token never reaches the SQL query.
- `ORDER BY created_at DESC` sorts newest first in SQL, so the client receives the desired order without sorting in JavaScript.
- `.map(toIncident)` passes the adapter as a callback. It receives each row and returns the API object.
- The response wrapper `{ incidents: ... }` makes the payload extensible and matches the context helper's response type.

#### POST

- The route validates `req.body` before any insert. `result.data` is runtime-validated data in the success branch.
- `` `INC-${Date.now()}` `` creates a time-based ID. It is simple for a demo but can collide under sufficiently concurrent requests and is not a replacement for a database-generated UUID.
- The SQL sets `status` to `'Open'` server-side. The client cannot create an incident with an arbitrary initial status.
- `RETURNING` makes PostgreSQL return the inserted row, including its database-generated timestamp.
- `req.userEmail` came from JWT middleware. It is optional in the TypeScript augmentation, so the database foreign key is the final runtime guard if middleware were incorrectly bypassed.
- `status(201)` communicates resource creation. `json` sends the mapped representation.

#### PATCH

- PATCH conventionally represents a partial modification. The schema makes each property optional.
- `(!result.data.status && !result.data.severity)` rejects an empty object. This prevents a successful no-op update.
- The preliminary SELECT distinguishes a missing record with a clean 404 and supplies current values for omitted fields.
- `??` preserves a current value only when the new value is absent/nullish. It is preferable to `||` for values where an empty string or zero could be meaningful, although these enums are nonempty.
- The SQL updates both columns every time, using either a new value or the existing one. `RETURNING` returns the complete updated record.

#### DELETE

- `DELETE ... WHERE id = $1` is parameterized.
- `rowCount === 0` identifies an ID that matched no row, producing `404`.
- `204 No Content` communicates successful deletion with no response body. `send()` completes the response.
- The frontend's `response.json().catch(() => ({}))` is specifically important here because parsing an empty 204 body would otherwise reject.

### 4. Quick-Recall Cheat Sheet & Rules of Thumb

- Protect routes by placing `authenticate` before the handler.
- `GET` reads; `POST` creates; `PATCH` partially updates; `DELETE` removes.
- Use `201` for creation, `204` for successful empty deletion, `404` for absent resources.
- Use `RETURNING` when the client needs the canonical inserted/updated row.
- Use parameter placeholders for every user-derived SQL value.
- Map DB rows before returning API JSON.
- Validate PATCH content and reject an empty patch.

---

## 10. Health Check and Startup Lifecycle

### 1. Context & Execution Flow

The health endpoint tests database reachability with the cheapest meaningful query. The startup promise ensures tables and seed data are ready before the server advertises its port.

```text
GET /api/health
-> SELECT 1
-> 200 connected or 500 failed

process start
-> initializeDatabase
-> app.listen only on success
-> process.exit(1) on initialization failure
```

### 2. Full Code Snippet

```ts
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    return res.json({ message: 'PulseDesk backend is running', database: 'connected' })
  } catch {
    return res.status(500).json({ message: 'Database connection failed' })
  }
})

initializeDatabase()
  .then(() => app.listen(PORT, () => console.log(`PulseDesk backend running on http://localhost:${PORT}`)))
  .catch((error) => {
    console.error('Unable to initialize PostgreSQL:', error)
    process.exit(1)
  })
```

### 3. Line-by-Line Syntax & Mechanism Breakdown

- `SELECT 1` does not depend on application tables; it verifies that a query can reach PostgreSQL.
- The health route returns 200 only after the query resolves. The catch returns 500 on connection failure.
- `initializeDatabase()` returns a promise because it awaits several queries and hashing work.
- `.then(...)` registers the success continuation. `app.listen` starts accepting connections only after initialization.
- The callback passed to `app.listen` runs when the server is listening, not merely when the call is made.
- `.catch(...)` handles startup failure. `process.exit(1)` terminates with a nonzero code, which process managers interpret as failure.
- This is a promise chain rather than an outer async IIFE. Both styles can express the same sequencing; the chain makes the success/failure boundary explicit.

### 4. Quick-Recall Cheat Sheet & Rules of Thumb

- A health check should test a real dependency.
- Initialize required infrastructure before listening.
- `.then` handles fulfillment; `.catch` handles rejection.
- Exit nonzero when startup cannot establish required prerequisites.

---

# Configuration and Architecture

## 11. Package Scripts, TypeScript, and Vite

### 1. Context & Execution Flow

The backend and frontend are separate TypeScript projects.

- Backend `npm run dev` uses `tsx watch src/server.ts`, transpiling/rerunning the Node server during development.
- Backend `npm run build` runs `tsc`, emitting `dist` JavaScript according to `rootDir`/`outDir`.
- Frontend `npm run dev` starts Vite's development server with HMR.
- Frontend `npm run build` runs `tsc -b` for project references/build checking and then `vite build` for a production bundle.

### 2. Full Code Snippet

```json
// backend/package.json (relevant fields)
{
  "type": "commonjs",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js"
  }
}

// frontend/package.json (relevant fields)
{
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "oxlint",
    "preview": "vite preview"
  }
}
```

```ts
// vite.config.ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({ plugins: [react()] })
```

### 3. Line-by-Line Syntax & Mechanism Breakdown

- `type: commonjs` and `type: module` describe different Node/package module defaults. The backend's TypeScript `NodeNext` settings and `.js` import suffixes must be considered together; package/module settings should be kept consistent in a real project.
- A JSON `scripts` entry maps a short command to an executable shell command run by npm.
- `tsx` executes TypeScript directly and watches for changes; it is a development convenience, not the production artifact.
- `tsc -b` invokes build mode and follows referenced configs. `&&` runs Vite only if TypeScript succeeds.
- `vite` provides fast dev serving, bundling, and HMR. `vite build` emits optimized static assets.
- `oxlint` is the frontend lint command.
- `defineConfig` gives Vite configuration typing and supports editor tooling.
- `@vitejs/plugin-react` enables React JSX transforms and React-specific Vite integration.
- Backend `strict: true` raises type-safety standards. `skipLibCheck` skips checking declaration files, which speeds builds but can hide library declaration issues.
- Frontend `moduleResolution: bundler`, `jsx: react-jsx`, `noEmit: true`, `noUnusedLocals`, `noUnusedParameters`, and `verbatimModuleSyntax` describe a browser bundler-oriented TypeScript setup.

### 4. Quick-Recall Cheat Sheet & Rules of Thumb

- Development runner and production runtime are different paths.
- Build pipeline: type-check first, bundle second.
- `tsx watch` is not a database/server deployment strategy.
- Read `package.json`, tsconfig, and module type together when debugging imports.
- `noEmit` means frontend TypeScript checks without writing JS; Vite emits the bundle.

---

# Cross-Cutting Exam Review

## End-to-End Create Incident Trace

1. The user opens the Dashboard and clicks `+ New incident`; `setShowForm(true)` schedules a render.
2. Controlled inputs update `title`, `description`, and `severity` with each change event.
3. Form submission calls `preventDefault`, then `createIncident`.
4. The context serializes the object with `JSON.stringify` and adds `Content-Type` plus `Authorization: Bearer <token>`.
5. CORS and JSON middleware process the request. `authenticate` verifies the JWT and attaches `userEmail`.
6. `createIncidentSchema.safeParse` checks title length, description length, and severity membership.
7. PostgreSQL receives parameterized SQL; the server forces status to `Open` and uses the authenticated email.
8. `RETURNING` produces the inserted row. `toIncident` converts timestamp/name conventions.
9. The server returns `201` and `{ incident }`.
10. The request helper parses JSON, sees `response.ok`, and returns data.
11. `CREATE_SUCCESS` creates a new incident array with the returned record at index zero.
12. React re-renders `Dashboard`; count, filtered list, and DOM output reflect the new state.

## End-to-End Update Trace

1. A row select changes. The browser event value is a string, narrowed with `as IncidentStatus` or `as Severity`.
2. `IncidentRow` calls `onUpdate(id, changes)` with both status and severity.
3. The context sends `PATCH /api/incidents/:id`.
4. The server validates the partial object, reads the current row, fills omitted fields with `??`, and executes an update.
5. `UPDATE_SUCCESS` maps through the old list and replaces only the matching ID.
6. React reconciliation reuses unaffected rows because their keys and object references remain stable.

## Security and Correctness Checklist

- [ ] Passwords are hashed with bcrypt and never returned.
- [ ] SQL values use placeholders, not string interpolation.
- [ ] Protected routes run JWT middleware.
- [ ] Request bodies are runtime-validated with Zod.
- [ ] Database constraints backstop application validation.
- [ ] `response.ok` is checked after `fetch`.
- [ ] Empty `204` responses do not require JSON.
- [ ] Reducers return new objects/arrays and do not mutate state.
- [ ] API naming conversion is explicit.
- [ ] HTTP statuses describe outcome accurately.
- [ ] Secrets and production API URLs should come from secure environment configuration.

## Common Midterm Traps

- `fetch` resolving does not mean the HTTP request succeeded; inspect `response.ok`.
- A TypeScript `as` assertion does not validate runtime data.
- A JWT payload is readable; signing is not encryption.
- `localStorage` persistence of a token does not automatically restore the `user` object in this implementation.
- `PATCH` optional fields require a deliberate empty-object check.
- React state setters schedule updates; they do not mutate the current render's variable.
- `useEffect` runs after render, and its dependency array controls reruns; the current token effect has no actual side effect.
- `204` responses have no body; unconditional JSON parsing is unsafe without a catch/guard.
- `key` is consumed by React and is not available as a child component prop.
- CORS is not authorization.
- Database row types and Zod validation solve different problems: one is compile-time documentation for query results, the other is runtime validation of input.

## Minimal Reconstruction Templates

### React controlled input

```tsx
const [value, setValue] = useState('')
<input value={value} onChange={(event) => setValue(event.target.value)} />
```

### Reducer update

```ts
const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'SUCCESS':
      return { ...state, items: action.payload, loading: false }
  }
}
```

### Protected Express route

```ts
app.get('/resource', authenticate, async (_req, res) => {
  const result = await pool.query('SELECT ... WHERE id = $1', [id])
  return res.json({ item: result.rows[0] })
})
```

### Zod boundary

```ts
const result = schema.safeParse(req.body)
if (!result.success) return res.status(400).json({ message: 'Invalid input' })
// result.data is the validated branch
```

### Fetch boundary

```ts
const response = await fetch(url, options)
const data = await response.json().catch(() => ({}))
if (!response.ok) throw new Error(data.message ?? 'Request failed')
return data
```

### Parameterized SQL

```ts
await pool.query(
  'UPDATE incidents SET status = $1 WHERE id = $2',
  [status, id],
)
```

## Final Mental Model

Remember the application as four typed transformations:

```text
DOM event strings
  -> typed frontend command
  -> JSON HTTP request
  -> validated server data
  -> parameterized SQL
  -> mapped JSON response
  -> reducer action
  -> immutable React state
  -> JSX and DOM
```

The strongest exam answer names both sides of every boundary: the syntax used, the runtime mechanism behind it, the failure status or branch, and the shape of the data before and after the transformation.
