Project Specification: PulseDesk (Full-Stack IT Incident Desk)
Target Architecture: Node.js (ExpressJS + TypeScript + DB) Backend & React (TypeScript) Frontend
Core Assessment Criteria: Zod Validation, JWT Authentication, Express Middlewares, Full CRUD Operations, React Context + useReducer, and Global Dispatching.

System Overview
PulseDesk is an IT Incident Desk application where authenticated users submit support tickets, view existing issues, update ticket severity/status, and delete resolved tickets.
Technology Matrix
Backend: Node.js, ExpressJS, TypeScript, jsonwebtoken, bcryptjs, zod, cors
Frontend: React, TypeScript, Context API + useReducer

API Endpoints (check image)

Frontend Architecture (React + TS)
State & Actions (src/types/index.ts)

export interface State {
  user: { id: string; email: string } | null;
  token: string | null;
  incidents: Incident[];
  loading: boolean;
  error: string | null;
}

export type Action =
  | { type: 'SET_AUTH'; payload: { user: any; token: string } }
  | { type: 'FETCH_SUCCESS'; payload: Incident[] }
  | { type: 'CREATE_SUCCESS'; payload: Incident }
  | { type: 'UPDATE_SUCCESS'; payload: Incident }
  | { type: 'DELETE_SUCCESS'; payload: string }
  | { type: 'SET_ERROR'; payload: string };


State (src/context/IncidentContext.tsx)

...
const initialState: State = {
  user: null,
  token: localStorage.getItem('token'),
  incidents: [],
  loading: false,
  error: null,
};
...