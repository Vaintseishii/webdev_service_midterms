import 'dotenv/config';
import cors from 'cors';
import express, { type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { initializeDatabase, pool, toMicroService, type Microservice } from './db.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'service-local-secret';
const loginSchema = z.object({ email: z.email(), password: z.string().min(6) });
const createMicroServiceSchema = z.object({ name: z.string().min(3), endpointUrl: z.string().min(5), status: z.enum(['HEALTH', 'DEGRADED', 'DOWN']) });
const updateMicroServiceSchema = z.object({ severity: z.enum(['Low', 'Medium', 'High', 'Critical']).optional(), environment: z.enum(['DEVELOPENT', 'STAGING', 'PRODUCTION']).optional() });

// severity is status
// status is environment

declare global { namespace Express { interface Request { userEmail?: string } } }
app.use(cors());
app.use(express.json());

const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'Authentication required' });
  try { req.userEmail = (jwt.verify(token, JWT_SECRET) as { email: string }).email; next(); }
  catch { return res.status(401).json({ message: 'Invalid or expired token' }); }
};

app.post('/api/auth/login', async (req, res) => {
  const result = loginSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ message: 'Enter a valid email and a password of at least 6 characters' });
  try {
    const userResult = await pool.query<{ id: string; email: string; password_hash: string }>('SELECT id, email, password_hash FROM users WHERE email = $1', [result.data.email]);
    const user = userResult.rows[0];
    if (!user || !(await bcrypt.compare(result.data.password, user.password_hash))) return res.status(401).json({ message: 'Incorrect email or password' });
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '8h' });
    return res.json({ token, user: { id: user.id, email: user.email } });
  } catch (error) { console.error(error); return res.status(500).json({ message: 'Database error during login' }); }
});

app.get('/api/incidents', authenticate, async (_req, res) => {
  try {
    const result = await pool.query<Microservice>('SELECT id, title, description, severity, status, created_at, created_by FROM incidents ORDER BY created_at DESC');
    return res.json({ incidents: result.rows.map(toMicroService) });
  } catch (error) { console.error(error); return res.status(500).json({ message: 'Unable to load incidents' }); }
});

app.post('/api/incidents', authenticate, async (req, res) => {
  const result = createIncidentSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ message: 'Title, description, and severity are required' });
  try {
    const id = `INC-${Date.now()}`;
    const inserted = await pool.query<Microservice>(
      `INSERT INTO incidents (id, title, description, severity, status, created_by)
       VALUES ($1, $2, $3, $4, 'Open', $5)
       RETURNING id, title, description, severity, status, created_at, created_by`,
      [id, result.data.title, result.data.description, result.data.severity, req.userEmail],
    );
    return res.status(201).json({ incident: toMicroService(inserted.rows[0]) });
  } catch (error) { console.error(error); return res.status(500).json({ message: 'Unable to create incident' }); }
});

app.patch('/api/incidents/:id', authenticate, async (req, res) => {
  const result = updateIncidentSchema.safeParse(req.body);
  if (!result.success || (!result.data.status && !result.data.severity)) return res.status(400).json({ message: 'Invalid incident update' });
  try {
    const current = await pool.query<Microservice>('SELECT id, title, description, severity, status, created_at, created_by FROM incidents WHERE id = $1', [req.params.id]);
    if (!current.rows[0]) return res.status(404).json({ message: 'Incident not found' });
    const incident = current.rows[0];
    const updated = await pool.query<Microservice>(
      `UPDATE incidents SET severity = $1, status = $2 WHERE id = $3
       RETURNING id, title, description, severity, status, created_at, created_by`,
      [result.data.severity ?? incident.severity, result.data.status ?? incident.status, req.params.id],
    );
    return res.json({ incident: toMicroService(updated.rows[0]) });
  } catch (error) { console.error(error); return res.status(500).json({ message: 'Unable to update incident' }); }
});

app.delete('/api/incidents/:id', authenticate, async (req, res) => {
  try {
    const deleted = await pool.query('DELETE FROM incidents WHERE id = $1', [req.params.id]);
    if (deleted.rowCount === 0) return res.status(404).json({ message: 'Incident not found' });
    return res.status(204).send();
  } catch (error) { console.error(error); return res.status(500).json({ message: 'Unable to delete incident' }); }
});

app.get('/api/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); return res.json({ message: 'PulseDesk backend is running', database: 'connected' }); }
  catch { return res.status(500).json({ message: 'Database connection failed' }); }
});

initializeDatabase()
  .then(() => app.listen(PORT, () => console.log(`PulseDesk backend running on http://localhost:${PORT}`)))
  .catch((error) => { console.error('Unable to initialize PostgreSQL:', error); process.exit(1); });
