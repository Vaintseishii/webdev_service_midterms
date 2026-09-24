import { useEffect, useMemo, useState } from 'react'
import { useMicroservices } from './context/IncidentContext'
import type { Microservice, ServiceStatus, Environment, } from './types'
import './App.css'


const environments: Environment[] = ['DEVELOPMENT' , 'STAGING' , 'PRODUCTION']
const statuses: ServiceStatus[] = ['HEALTHY' , 'DEGRADED' , 'DOWN'
]
function Login() {
  const { state, login } = useMicroservices()
  const [email, setEmail] = useState('admin@servicehub.com')
  const [password, setPassword] = useState('password')
  const [submitting, setSubmitting] = useState(false)
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setSubmitting(true); try { await login(email, password) } catch { /* error is rendered from context */ } finally { setSubmitting(false) } }

    return <main className="login-shell">
        <section className="login-card">
            <h1>Welcome to servicehub</h1>
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
                Palmes & Azarraga
            </p>
        </section>
    </main>
}

function MicroserviceRow({ microservice, onUpdate, onDelete }:
                     { microservice: Microservice; onUpdate:
                                 (id: string, changes: Pick<Microservice, 'status' | 'environment'>) => void;
                         onDelete: (id: string) => void }) {
    return <article className="incident-row">
        <div className="incident-main">
            <span className={`status-dot ${microservice.status.toLowerCase()}`} />
            <div>
                <div className="incident-title">
                    <strong>{microservice.name}</strong>
                    <span className="incident-id">
                        {microservice.id}
                    </span>
                </div>
                <p>
                    {microservice.endpointUrl}
                </p>
                <small>
                    {new Date(microservice.created_at).toLocaleDateString()} · {microservice.created_by}
                </small>
            </div>
        </div>
        <div className="incident-controls">
            <select
                aria-label={`${microservice.id} environment`}
                value={microservice.environment}
                onChange={(event) =>
                    onUpdate(microservice.id,
                             { status: event.target.value as ServiceStatus,
                               environment: microservice.environment })}>
                {environments.map((environment) =>
                    <option key={environment}>
                        {environment}
                    </option>)}
            </select>
            <select
                aria-label={`${microservice.id} status`}
                value={microservice.status}
                onChange={(event) =>
                    onUpdate(microservice.id,
                             { environment: microservice.environment,
                               status: event.target.value as ServiceStatus})}>
                {statuses.map((ServiceStatus) =>
                    <option key={ServiceStatus}>
                        {ServiceStatus}
                    </option>)}
            </select>
            <button
                className="icon-button"
                title="Delete incident"
                onClick={() => onDelete(microservice.id)}>
                ×
            </button>
        </div>
    </article>
}

function Dashboard() {
  const { state, createMicroservice, updateMicroservice, deleteMicroservice, logout } = useMicroservices()
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [filter, setFilter] = useState<'All' | ServiceStatus>('All')
  const [endpointUrl, setEndpointUrl] = useState('')
  const [status, setStatus] = useState<ServiceStatus>('HEALTHY')
  useEffect(() => { if (!state.token) return }, [state.token])

  const FilteredMicroservices = 
        useMemo(() => state.microservices.filter((microservice) => 
                                          (filter === 'All' || microservice.status === filter) 
                                          && '${incident.title} ${incident.description} ${incident.id}'.toLowerCase()), 
                                          [filter])
  const counts = { total: state.microservices.length, 
                   open: state.microservices.filter((microservice) => microservice.environment === 'DEVELOPMENT').length, 
                   progress: state.microservices.filter((microservice) => microservice.environment === 'STAGING').length, 
                   resolved: state.microservices.filter((microservice) => microservice.environment === 'PRODUCTION').length }

  const submitMicroservice = async (event: React.FormEvent) => 
                        { event.preventDefault(); 
                            await createMicroservice({ name, endpointUrl, status }); 
                            setName(''); setEndpointUrl(''); 
                            setStatus('HEALTHY');
                            setShowForm(false) }

  return <main className="app-shell">
    <header className="topbar">
        <div className="wordmark">
            <span>
                ServiceHub
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
                                <h1>
                                    microservice overview
                                </h1>

                            </div>
                            <button className="primary-button" onClick={() => setShowForm(!showForm)}>
                                ＋ New microservice
                            </button>
                        </div>
                        {state.error && <div className="error-banner">{state.error}
                    </div>}
                    <section className="stat-grid">
                        <div>
                            <span>
                                Total microservices
                            </span>
                            <strong>
                                    {counts.total}
                            </strong>
                        </div>
                        <div>
                            <span>
                                    Development
                            </span>
                            <strong>
                                    {counts.open}
                            </strong>
                        </div>
                        <div>
                            <span>
                                Staging
                             </span>
                             <strong>
                                {counts.progress}
                            </strong>
                        </div>
                        <div>
                            <span>
                                Production
                            </span>
                            <strong>
                                {counts.resolved}
                            </strong>
                         </div>
                    </section>
                            {showForm && <form className="new-incident" onSubmit={submitMicroservice}>
                                <div className="section-heading">
                                    <div>
                                        <p className="eyebrow">CREATE MICROSERVICE</p>
                                        <h2>Microservices?</h2>
                                        </div>
                                            <button type="button" className="close-button" onClick={() => setShowForm(false)}>
                                                ×
                                            </button>
                                        </div>
                                        <label>
                                            Title
                                            <input 
                                                value={name} 
                                                onChange={(event) => setName(event.target.value)} 
                                                placeholder="Short summary" 
                                                required minLength={3} />
                                        </label>
                                        <label>
                                            Description
                                            <textarea 
                                                value={endpointUrl} 
                                                onChange={(event) => setEndpointUrl(event.target.value)} 
                                                placeholder="Add useful context for the team" 
                                                required minLength={5} />
                                        </label>
                                        <label>
                                            Severity
                                            <select 
                                                value={status} 
                                                onChange={(event) => setStatus(event.target.value as ServiceStatus)}>
                                                    {statuses.map((item) => <option key={item}>{item}</option>)}
                                            </select>
                                        </label>
                                        <button className="primary-button">
                                            Create Microservice
                                        </button>
                                        </form>}
                                        <section className="incident-section">
                                            <div className="toolbar">
                                                <div>
                                                    <h2>
                                                        Microservice
                                                    </h2>
                                                </div>
                                                <div className="filters">
                                                    <input 
                                                        placeholder="Search Microservices" 
                                                        aria-label="Search Microservices" />
                                                    <select 
                                                        value={filter} 
                                                        onChange={(event) => setFilter(event.target.value as 'All' | ServiceStatus)} 
                                                         aria-label="Filter Microservices">
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
                                                    Loading microservices...
                                                    </p> : FilteredMicroservices.length ? FilteredMicroservices.map((microservice) => <MicroserviceRow key={microservice.id} 
                                                    microservice={microservice} 
                                                    onUpdate={updateMicroservice} 
                                                    onDelete={deleteMicroservice} />) : <p className="empty-state">
                                                        No microservices match your filters.
                                                        </p>}
                                            </div>
                                        </section>
                                    </div>
                                </main>
}

export default function App() { const { state } = useMicroservices(); return state.user ? <Dashboard /> : <Login /> }
