export type Environment = 'DEVELOPMENT' | 'STAGING' | 'PRODUCTION';
export type ServiceStatus = 'HEALTHY' | 'DEGRADED' | 'DOWN';

export interface Microservice {
 id: string;
 name: string;
 endpointUrl: string;
 environment: Environment;
 status: ServiceStatus;
 version: string;
 created_at: Date;
 created_by: string;
}

export interface User { id: string; email: string }

export interface State {
  user: User | null
  token: string | null
  microservices: Microservice[]
  loading: boolean
  error: string | null
}

export type Action =
  | { type: 'SET_AUTH'; payload: { user: User; token: string } }
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; payload: Microservice[] }
  | { type: 'CREATE_SUCCESS'; payload: Microservice }
  | { type: 'UPDATE_SUCCESS'; payload: Microservice }
  | { type: 'DELETE_SUCCESS'; payload: string }
  | { type: 'SET_ERROR'; payload: string }
  | { type: 'LOGOUT' }