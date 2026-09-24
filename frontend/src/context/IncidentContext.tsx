import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react'
import type { Action, Incident, State, User } from '../types'

const API_URL = 'http://localhost:3000/api'
const initialState: State = { user: null, token: localStorage.getItem('token'), incidents: [], loading: false, error: null }

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
  const response = await fetch(`${API_URL}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } })
  const data = await response.json().catch(() => ({})) as { message?: string; user?: User; token?: string; incident?: Incident; incidents?: Incident[] }
  if (!response.ok) throw new Error(data.message ?? 'Something went wrong')
  return data
}

export function IncidentProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const loadIncidents = async (token = state.token) => {
    if (!token) return
    dispatch({ type: 'FETCH_START' })
    try { const data = await request('/incidents', {}, token); dispatch({ type: 'FETCH_SUCCESS', payload: data.incidents ?? [] }) }
    catch (error) { dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Unable to load incidents' }) }
  }
  const login = async (email: string, password: string) => {
    try {
      const data = await request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
      if (!data.user || !data.token) throw new Error('Invalid login response')
      localStorage.setItem('token', data.token)
      dispatch({ type: 'SET_AUTH', payload: { user: data.user, token: data.token } })
      await loadIncidents(data.token)
    } catch (error) { dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Unable to sign in' }); throw error }
  }
  const createIncident = async (incident: Pick<Incident, 'title' | 'description' | 'severity'>) => {
    try { const data = await request('/incidents', { method: 'POST', body: JSON.stringify(incident) }, state.token); if (data.incident) dispatch({ type: 'CREATE_SUCCESS', payload: data.incident }) }
    catch (error) { dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Unable to create incident' }) }
  }
  const updateIncident = async (id: string, changes: Pick<Incident, 'severity' | 'status'>) => {
    try { const data = await request(`/incidents/${id}`, { method: 'PATCH', body: JSON.stringify(changes) }, state.token); if (data.incident) dispatch({ type: 'UPDATE_SUCCESS', payload: data.incident }) }
    catch (error) { dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Unable to update incident' }) }
  }
  const deleteIncident = async (id: string) => {
    try { await request(`/incidents/${id}`, { method: 'DELETE' }, state.token); dispatch({ type: 'DELETE_SUCCESS', payload: id }) }
    catch (error) { dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Unable to delete incident' }) }
  }
  const logout = () => { localStorage.removeItem('token'); dispatch({ type: 'LOGOUT' }) }
  return <IncidentContext.Provider value={{ state, dispatch, login, createIncident, updateIncident, deleteIncident, logout }}>{children}</IncidentContext.Provider>
}

export const useIncidents = () => {
  const context = useContext(IncidentContext)
  if (!context) throw new Error('useIncidents must be used inside IncidentProvider')
  return context
}