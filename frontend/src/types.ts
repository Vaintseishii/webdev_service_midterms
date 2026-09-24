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