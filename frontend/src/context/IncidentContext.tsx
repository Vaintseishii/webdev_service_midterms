import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react'
import type { Action, Microservice, State, User } from '../types'

const API_URL = 'http://localhost:3000/api'
const initialState: State = { user: null, token: localStorage.getItem('token'), microservices: [], loading: false, error: null }

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'SET_AUTH': return { ...state, user: action.payload.user, token: action.payload.token, error: null }
    case 'FETCH_START': return { ...state, loading: true, error: null }
    case 'FETCH_SUCCESS': return { ...state, microservices: action.payload, loading: false }
    case 'CREATE_SUCCESS': return { ...state, microservices: [action.payload, ...state.microservices], loading: false }
    case 'UPDATE_SUCCESS': return { ...state, microservices: state.microservices.map((microservice) => microservice.id === action.payload.id ? action.payload : microservice), loading: false }
    case 'DELETE_SUCCESS': return { ...state, microservices: state.microservices.filter((microservice) => microservice.id !== action.payload), loading: false }
    case 'SET_ERROR': return { ...state, loading: false, error: action.payload }
    case 'LOGOUT': return { ...initialState, token: null }
  }
}

interface MicroserviceContextValue {
  state: State
  dispatch: Dispatch<Action>
  login: (email: string, password: string) => Promise<void>
  createMicroservice: (microservice: Pick<Microservice, 'name' | 'endpointUrl' | 'status'>) => Promise<void>
  updateMicroservice: (id: string, changes: Pick<Microservice, 'status' | 'environment'>) => Promise<void>
  deleteMicroservice: (id: string) => Promise<void>
  logout: () => void
}

const MicroserviceContext = createContext<MicroserviceContextValue | null>(null)
const request = async (path: string, options: RequestInit = {}, token?: string | null) => {
  const response = await fetch(`${API_URL}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } })
  const data = await response.json().catch(() => ({})) as { message?: string; user?: User; token?: string; microservice?: Microservice; microservices?: Microservice[] }
  if (!response.ok) throw new Error(data.message ?? 'Something went wrong')
  return data
}

export function MicroserviceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const loadMicroservices = async (token = state.token) => {
    if (!token) return
    dispatch({ type: 'FETCH_START' })
    try { const data = await request('/Micrservices', {}, token); dispatch({ type: 'FETCH_SUCCESS', payload: data.microservices ?? [] }) }
    catch (error) { dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Unable to load microservices' }) }
  }
  const login = async (email: string, password: string) => {
    try {
      const data = await request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
      if (!data.user || !data.token) throw new Error('Invalid login response')
      localStorage.setItem('token', data.token)
      dispatch({ type: 'SET_AUTH', payload: { user: data.user, token: data.token } })
      await loadMicroservices(data.token)
    } catch (error) { dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Unable to sign in' }); throw error }
  }
  const createMicroservice = async (microservice: Pick<Microservice, 'name' | 'endpointUrl' | 'status'>) => {
    try { const data = await request('/microservices', { method: 'POST', body: JSON.stringify(microservice) }, state.token); if (data.microservice) dispatch({ type: 'CREATE_SUCCESS', payload: data.microservice }) }
    catch (error) { dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Unable to create microservice' }) }
  }
  const updateMicroservice = async (id: string, changes: Pick<Microservice, 'status' | 'environment'>) => {
    try { const data = await request(`/microservices/${id}`, { method: 'PATCH', body: JSON.stringify(changes) }, state.token); if (data.microservice) dispatch({ type: 'UPDATE_SUCCESS', payload: data.microservice }) }
    catch (error) { dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Unable to update microservice' }) }
  }
  const deleteMicroservice = async (id: string) => {
    try { await request(`/microservices/${id}`, { method: 'DELETE' }, state.token); dispatch({ type: 'DELETE_SUCCESS', payload: id }) }
    catch (error) { dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Unable to delete microservice' }) }
  }
  const logout = () => { localStorage.removeItem('token'); dispatch({ type: 'LOGOUT' }) }
  return <MicroserviceContext.Provider value={{ state, dispatch, login, createMicroservice, updateMicroservice, deleteMicroservice, logout }}>{children}</MicroserviceContext.Provider>
}

export const useMicroservices = () => {
  const context = useContext(MicroserviceContext)
  if (!context) throw new Error('useMicroservices must be used inside MicroserviceProvider')
  return context
}