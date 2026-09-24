"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.toIncident = exports.pool = void 0;
exports.initializeDatabase = initializeDatabase;
const pg_1 = require("pg");
const dotenv_1 = __importDefault(require("dotenv"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
dotenv_1.default.config();
exports.pool = new pg_1.Pool({
    user: process.env.PGUSER,
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    password: process.env.PGPASSWORD,
    port: Number(process.env.PGPORT) || 5432,
});
const toIncident = (row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    severity: row.severity,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by,
});
exports.toIncident = toIncident;
async function initializeDatabase() {
    await exports.pool.query(`
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
  `);
    const user = await exports.pool.query('SELECT id FROM users WHERE email = $1', ['admin@pulsedesk.com']);
    if (user.rowCount === 0) {
        const passwordHash = await bcryptjs_1.default.hash('password', 10);
        await exports.pool.query('INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)', ['usr-1', 'admin@pulsedesk.com', passwordHash]);
    }
    const incidentCount = await exports.pool.query('SELECT COUNT(*)::int AS count FROM incidents');
    if (incidentCount.rows[0].count === 0) {
        await exports.pool.query(`INSERT INTO incidents (id, title, description, severity, status, created_at, created_by)
       VALUES ($1, $2, $3, $4, $5, NOW() - INTERVAL '1 hour', $6),
              ($7, $8, $9, $10, $11, NOW() - INTERVAL '1 day', $6)`, ['INC-1042', 'VPN access unavailable', 'Remote staff cannot connect to the corporate VPN.', 'High', 'In Progress', 'admin@pulsedesk.com', 'INC-1041', 'Printer queue stalled', 'Finance printer is holding jobs in the queue.', 'Medium', 'Open']);
    }
}
