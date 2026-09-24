"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const zod_1 = require("zod");
const db_js_1 = require("./db.js");
const app = (0, express_1.default)();
const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'pulsedesk-local-secret';
const loginSchema = zod_1.z.object({ email: zod_1.z.email(), password: zod_1.z.string().min(6) });
const createIncidentSchema = zod_1.z.object({ title: zod_1.z.string().min(3), description: zod_1.z.string().min(5), severity: zod_1.z.enum(['Low', 'Medium', 'High', 'Critical']) });
const updateIncidentSchema = zod_1.z.object({ severity: zod_1.z.enum(['Low', 'Medium', 'High', 'Critical']).optional(), status: zod_1.z.enum(['Open', 'In Progress', 'Resolved']).optional() });
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const authenticate = (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token)
        return res.status(401).json({ message: 'Authentication required' });
    try {
        req.userEmail = jsonwebtoken_1.default.verify(token, JWT_SECRET).email;
        next();
    }
    catch {
        return res.status(401).json({ message: 'Invalid or expired token' });
    }
};
app.post('/api/auth/login', async (req, res) => {
    const result = loginSchema.safeParse(req.body);
    if (!result.success)
        return res.status(400).json({ message: 'Enter a valid email and a password of at least 6 characters' });
    try {
        const userResult = await db_js_1.pool.query('SELECT id, email, password_hash FROM users WHERE email = $1', [result.data.email]);
        const user = userResult.rows[0];
        if (!user || !(await bcryptjs_1.default.compare(result.data.password, user.password_hash)))
            return res.status(401).json({ message: 'Incorrect email or password' });
        const token = jsonwebtoken_1.default.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '8h' });
        return res.json({ token, user: { id: user.id, email: user.email } });
    }
    catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Database error during login' });
    }
});
app.get('/api/incidents', authenticate, async (_req, res) => {
    try {
        const result = await db_js_1.pool.query('SELECT id, title, description, severity, status, created_at, created_by FROM incidents ORDER BY created_at DESC');
        return res.json({ incidents: result.rows.map(db_js_1.toIncident) });
    }
    catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Unable to load incidents' });
    }
});
app.post('/api/incidents', authenticate, async (req, res) => {
    const result = createIncidentSchema.safeParse(req.body);
    if (!result.success)
        return res.status(400).json({ message: 'Title, description, and severity are required' });
    try {
        const id = `INC-${Date.now()}`;
        const inserted = await db_js_1.pool.query(`INSERT INTO incidents (id, title, description, severity, status, created_by)
       VALUES ($1, $2, $3, $4, 'Open', $5)
       RETURNING id, title, description, severity, status, created_at, created_by`, [id, result.data.title, result.data.description, result.data.severity, req.userEmail]);
        return res.status(201).json({ incident: (0, db_js_1.toIncident)(inserted.rows[0]) });
    }
    catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Unable to create incident' });
    }
});
app.patch('/api/incidents/:id', authenticate, async (req, res) => {
    const result = updateIncidentSchema.safeParse(req.body);
    if (!result.success || (!result.data.status && !result.data.severity))
        return res.status(400).json({ message: 'Invalid incident update' });
    try {
        const current = await db_js_1.pool.query('SELECT id, title, description, severity, status, created_at, created_by FROM incidents WHERE id = $1', [req.params.id]);
        if (!current.rows[0])
            return res.status(404).json({ message: 'Incident not found' });
        const incident = current.rows[0];
        const updated = await db_js_1.pool.query(`UPDATE incidents SET severity = $1, status = $2 WHERE id = $3
       RETURNING id, title, description, severity, status, created_at, created_by`, [result.data.severity ?? incident.severity, result.data.status ?? incident.status, req.params.id]);
        return res.json({ incident: (0, db_js_1.toIncident)(updated.rows[0]) });
    }
    catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Unable to update incident' });
    }
});
app.delete('/api/incidents/:id', authenticate, async (req, res) => {
    try {
        const deleted = await db_js_1.pool.query('DELETE FROM incidents WHERE id = $1', [req.params.id]);
        if (deleted.rowCount === 0)
            return res.status(404).json({ message: 'Incident not found' });
        return res.status(204).send();
    }
    catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Unable to delete incident' });
    }
});
app.get('/api/health', async (_req, res) => {
    try {
        await db_js_1.pool.query('SELECT 1');
        return res.json({ message: 'PulseDesk backend is running', database: 'connected' });
    }
    catch {
        return res.status(500).json({ message: 'Database connection failed' });
    }
});
(0, db_js_1.initializeDatabase)()
    .then(() => app.listen(PORT, () => console.log(`PulseDesk backend running on http://localhost:${PORT}`)))
    .catch((error) => { console.error('Unable to initialize PostgreSQL:', error); process.exit(1); });
