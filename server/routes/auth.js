const express = require('express');
const router = express.Router();
const { getDb, hashPassword, verifyPassword, generateSessionId } = require('../db');

// Session cookie config
const COOKIE_OPTS = {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/'
};

// Middleware: get current user from session
function authMiddleware(req, res, next) {
    const sessionId = req.cookies.session_id;
    if (!sessionId) {
        req.user = null;
        return next();
    }

    const db = getDb();
    const session = db.prepare(`
        SELECT s.*, u.id as user_id, u.name, u.email, u.role, u.avatar, u.department, u.status
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.id = ? AND s.expires_at > datetime('now')
    `).get(sessionId);

    if (!session) {
        res.clearCookie('session_id');
        req.user = null;
    } else {
        req.user = {
            id: session.user_id,
            name: session.name,
            email: session.email,
            role: session.role,
            avatar: session.avatar,
            department: session.department,
            status: session.status
        };
    }
    next();
}

// Require auth
function requireAuth(roles = null) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'No autenticado' });
        }
        if (roles && !roles.includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Sin permisos' });
        }
        next();
    };
}

// POST /api/auth/register
router.post('/register', (req, res) => {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ success: false, message: 'Todos los campos son obligatorios' });
    }

    if (password.length < 6) {
        return res.status(400).json({ success: false, message: 'La contrasena debe tener al menos 6 caracteres' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
        return res.status(400).json({ success: false, message: 'Este correo ya esta registrado' });
    }

    // Only allow client registration from public endpoint
    const userRole = (role === 'employee' && req.user && req.user.role === 'admin') ? 'employee' : 'client';
    const avatar = userRole === 'employee' ? '👨‍💼' : '👤';

    const result = db.prepare(`
        INSERT INTO users (name, email, password, role, avatar, department, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(name, email, hashPassword(password), userRole, avatar, req.body.department || null, userRole === 'employee' ? 'online' : 'offline');

    const user = db.prepare('SELECT id, name, email, role, avatar, department, status, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);

    res.json({ success: true, user });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Correo y contrasena requeridos' });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (!user || !verifyPassword(password, user.password)) {
        return res.status(401).json({ success: false, message: 'Correo o contrasena incorrectos' });
    }

    // Update status to online
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run('online', user.id);

    // Create session
    const sessionId = generateSessionId();
    db.prepare(`
        INSERT INTO sessions (id, user_id, expires_at)
        VALUES (?, ?, datetime('now', '+7 days'))
    `).run(sessionId, user.id);

    res.cookie('session_id', sessionId, COOKIE_OPTS);

    res.json({
        success: true,
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            avatar: user.avatar,
            department: user.department,
            status: 'online'
        }
    });
});

// POST /api/auth/logout
router.post('/logout', authMiddleware, (req, res) => {
    const sessionId = req.cookies.session_id;
    if (sessionId) {
        const db = getDb();
        db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
        if (req.user) {
            db.prepare('UPDATE users SET status = ? WHERE id = ?').run('offline', req.user.id);
        }
    }
    res.clearCookie('session_id');
    res.json({ success: true });
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
    if (!req.user) {
        return res.json({ success: false, user: null });
    }
    res.json({ success: true, user: req.user });
});

module.exports = { router, authMiddleware, requireAuth };
