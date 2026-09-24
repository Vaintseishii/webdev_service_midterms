import { Pool } from 'pg';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';


dotenv.config();

export const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: Number(process.env.PGPORT) || 5432,
});

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

export const toMicroService = (row: Microservice) => ({
  id: row.id,
  name: row.name,
  endpointUrl: row.endpointUrl,
  environment: row.environment,
  status: row.status,
  createdAt: row.created_at.toISOString(),
  createdBy: row.created_by,
});


export async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS microservices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      endpointUrl TEXT NOT NULL,
      environment TEXT NOT NULL CHECK (environment IN ('DEVELOPMENT', 'STAGING', 'PRODUCTION')),
      status TEXT NOT NULL CHECK (status IN ('HEALTHY', 'DEGRADED', 'DOWN')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT NOT NULL REFERENCES users(email)
    );
  `);




  const user = await pool.query('SELECT id FROM users WHERE email = $1', ['admin@servicehub.com']);
  if (user.rowCount === 0) {
    const passwordHash = await bcrypt.hash('password', 10);
    await pool.query('INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)', ['usr-1', 'admin@servicehub.com', passwordHash]);
  }
}