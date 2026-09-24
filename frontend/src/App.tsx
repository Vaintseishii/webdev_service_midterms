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
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setSubmitting(true); try { await login(email, password) } catch { /* error is rendered from context */ } finally { setSubmitting(false) } }

    return <main className="login-shell">
        <section className="login-card">
            <div className="brand-mark">P</div>
            <p className="eyebrow">IT OPERATIONS</p>
            <h1>Welcome to PulseDesk</h1><p className="muted">
                Keep every incident moving toward resolution.
            </p>
            <form onSubmit={submit}>
                <label>
                    Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
                </label>
                <label>
                    Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} />
                </label>
                {state.error && <p className="error">{state.error}</p>}
                <button className="primary-button" disabled={submitting}>
                    {submitting ? 'Signing in...' : 'Sign in'}
                </button>
            </form>
            <p className="demo-hint">
                Demo access is prefilled.
            </p>
        </section>
    </main>
}

function IncidentRow({ incident, onUpdate, onDelete }:
                     { incident: Incident; onUpdate:
                                 (id: string, changes: Pick<Incident, 'severity' | 'status'>) => void;
                         onDelete: (id: string) => void }) {
    return <article className="incident-row">
        <div className="incident-main">
            <span className={`severity-dot ${incident.severity.toLowerCase()}`} />
            <div>
                <div className="incident-title">
                    <strong>{incident.title}</strong>
                    <span className="incident-id">
                        {incident.id}
                    </span>
                </div>
                <p>
                    {incident.description}
                </p>
                <small>
                    {new Date(incident.createdAt).toLocaleDateString()} · {incident.createdBy}
                </small>
            </div>
        </div>
        <div className="incident-controls">
            <select
                aria-label={`${incident.id} status`}
                value={incident.status}
                onChange={(event) =>
                    onUpdate(incident.id,
                             { status: event.target.value as IncidentStatus,
                               severity: incident.severity })}>
                {statuses.map((status) =>
                    <option key={status}>
                        {status}
                    </option>)}
            </select>
            <select
                aria-label={`${incident.id} severity`}
                value={incident.severity}
                onChange={(event) =>
                    onUpdate(incident.id,
                             { status: incident.status,
                               severity: event.target.value as Severity })}>
                {severities.map((severity) =>
                    <option key={severity}>
                        {severity}
                    </option>)}
            </select>
            <button
                className="icon-button"
                title="Delete incident"
                onClick={() => onDelete(incident.id)}>
                ×
            </button>
        </div>
    </article>
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

  const filteredIncidents = 
        useMemo(() => state.incidents.filter((incident) => 
                                          (filter === 'All' || incident.status === filter) 
                                          && `${incident.title} ${incident.description} ${incident.id}`.toLowerCase().includes(query.toLowerCase())), 
                                          [filter, query, state.incidents])

  const counts = { total: state.incidents.length, 
                   open: state.incidents.filter((incident) => incident.status === 'Open').length, 
                   progress: state.incidents.filter((incident) => incident.status === 'In Progress').length, 
                   resolved: state.incidents.filter((incident) => incident.status === 'Resolved').length }

  const submitIncident = async (event: React.FormEvent) => 
                        { event.preventDefault(); 
                            await createIncident({ title, description, severity }); 
                            setTitle(''); setDescription(''); 
                            setSeverity('Medium'); 
                            setShowForm(false) }

  return <main className="app-shell">
    <header className="topbar">
        <div className="wordmark">
            <span className="brand-mark small">
                P
            </span>
            <span>
                PulseDesk
            </span>
        </div>
        <div className="user-menu">
            <span>
                {state.user?.email}
            </span>
            <button onClick={logout}>
                Sign out
            </button>
            </div>
                </header>
                    <div className="content">
                        <div className="page-heading">
                            <div>
                                <p className="eyebrow">
                                    OPERATIONS CENTER
                                </p>
                                <h1>
                                    Incident overview
                                </h1>
                                <p className="muted">
                                    Track, prioritize, and resolve your team&apos;s technical issues.
                                </p>
                            </div>
                            <button className="primary-button" onClick={() => setShowForm(!showForm)}>
                                ＋ New incident
                            </button>
                        </div>
                        {state.error && <div className="error-banner">{state.error}
                    </div>}
                    <section className="stat-grid">
                        <div>
                            <span>
                                Total incidents
                            </span>
                            <strong>
                                    {counts.total}
                            </strong>
                        </div>
                        <div>
                            <span>
                                    Open
                            </span>
                            <strong>
                                    {counts.open}
                            </strong>
                        </div>
                        <div>
                            <span>
                                In progress
                             </span>
                             <strong>
                                {counts.progress}
                            </strong>
                        </div>
                        <div>
                            <span>
                                Resolved
                            </span>
                            <strong>
                                {counts.resolved}
                            </strong>
                         </div>
                    </section>
                            {showForm && <form className="new-incident" onSubmit={submitIncident}>
                                <div className="section-heading">
                                    <div>
                                        <p className="eyebrow">CREATE INCIDENT</p>
                                        <h2>What needs attention?</h2>
                                        </div>
                                            <button type="button" className="close-button" onClick={() => setShowForm(false)}>
                                                ×
                                            </button>
                                        </div>
                                        <label>
                                            Title
                                            <input 
                                                value={title} 
                                                onChange={(event) => setTitle(event.target.value)} 
                                                placeholder="Short summary" 
                                                required minLength={3} />
                                        </label>
                                        <label>
                                            Description
                                            <textarea 
                                                value={description} 
                                                onChange={(event) => setDescription(event.target.value)} 
                                                placeholder="Add useful context for the team" 
                                                required minLength={5} />
                                        </label>
                                        <label>
                                            Severity
                                            <select 
                                                value={severity} 
                                                onChange={(event) => setSeverity(event.target.value as Severity)}>
                                                    {severities.map((item) => <option key={item}>{item}</option>)}
                                            </select>
                                        </label>
                                        <button className="primary-button">
                                            Create incident
                                        </button>
                                        </form>}
                                        <section className="incident-section">
                                            <div className="toolbar">
                                                <div>
                                                    <p className="eyebrow">
                                                        ALL ACTIVITY
                                                    </p>
                                                    <h2>
                                                        Incidents
                                                    </h2>
                                                </div>
                                                <div className="filters">
                                                    <input 
                                                        value={query} 
                                                        onChange={(event) => setQuery(event.target.value)} 
                                                        placeholder="Search incidents" 
                                                        aria-label="Search incidents" />
                                                    <select 
                                                        value={filter} 
                                                        onChange={(event) => setFilter(event.target.value as 'All' | IncidentStatus)} 
                                                        aria-label="Filter incidents">
                                                        <option>
                                                            All
                                                        </option>
                                                        {statuses.map((status) => 
                                                        <option key={status}>
                                                            {status}
                                                        </option>)}
                                                    </select>
                                                </div>
                                            </div>
                                            <div className="incident-list">
                                                {state.loading ? <p className="empty-state">
                                                    Loading incidents...
                                                    </p> : filteredIncidents.length ? filteredIncidents.map((incident) => <IncidentRow key={incident.id} 
                                                    incident={incident} 
                                                    onUpdate={updateIncident} 
                                                    onDelete={deleteIncident} />) : <p className="empty-state">
                                                        No incidents match your filters.
                                                        </p>}
                                            </div>
                                        </section>
                                    </div>
                                </main>
}

export default function App() { const { state } = useIncidents(); return state.user ? <Dashboard /> : <Login /> }
