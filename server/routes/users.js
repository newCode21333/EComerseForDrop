const express = require('express');
const router = express.Router();
const { getDb, hashPassword } = require('../db');
const { authMiddleware, requireAuth } = require('./auth');

router.use(authMiddleware);

// GET /api/users - list all users (admin only)
router.get('/', requireAuth(['admin']), (req, res) => {
    const db = getDb();
    const users = db.prepare(`
        SELECT id, name, email, role, avatar, department, status, created_at
        FROM users ORDER BY created_at DESC
    `).all();
    res.json({ success: true, users });
});

// GET /api/users/employees - list employees
router.get('/employees', requireAuth(), (req, res) => {
    const db = getDb();
    const employees = db.prepare(`
        SELECT id, name, email, role, avatar, department, status, created_at
        FROM users WHERE role = 'employee' ORDER BY name
    `).all();
    res.json({ success: true, employees });
});

// GET /api/users/clients - list clients (admin only)
router.get('/clients', requireAuth(['admin']), (req, res) => {
    const db = getDb();
    const clients = db.prepare(`
        SELECT id, name, email, role, avatar, department, status, created_at
        FROM users WHERE role = 'client' ORDER BY created_at DESC
    `).all();
    res.json({ success: true, clients });
});

// GET /api/users/stats - dashboard stats (admin only)
router.get('/stats', requireAuth(['admin']), (req, res) => {
    const db = getDb();
    const total = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    const employees = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'employee'").get().c;
    const clients = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'client'").get().c;
    const activeChats = db.prepare("SELECT COUNT(*) as c FROM chats WHERE status = 'open'").get().c;

    res.json({ success: true, stats: { total, employees, clients, activeChats } });
});

// POST /api/users/employee - create employee (admin only)
router.post('/employee', requireAuth(['admin']), (req, res) => {
    const { name, email, password, department } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ success: false, message: 'Todos los campos son obligatorios' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
        return res.status(400).json({ success: false, message: 'Este correo ya esta registrado' });
    }

    const result = db.prepare(`
        INSERT INTO users (name, email, password, role, avatar, department, status)
        VALUES (?, ?, ?, 'employee', '👨‍💼', ?, 'online')
    `).run(name, email, hashPassword(password), department || 'General');

    const user = db.prepare('SELECT id, name, email, role, avatar, department, status, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);

    res.json({ success: true, user });
});

// PUT /api/users/:id - update user (admin only)
router.put('/:id', requireAuth(['admin']), (req, res) => {
    const { name, department, status } = req.body;
    const db = getDb();

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!user) {
        return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    const updates = [];
    const values = [];
    if (name) { updates.push('name = ?'); values.push(name); }
    if (department) { updates.push('department = ?'); values.push(department); }
    if (status) { updates.push('status = ?'); values.push(status); }

    if (updates.length > 0) {
        values.push(req.params.id);
        db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    const updated = db.prepare('SELECT id, name, email, role, avatar, department, status, created_at FROM users WHERE id = ?').get(req.params.id);
    res.json({ success: true, user: updated });
});

// DELETE /api/users/:id - delete user (admin only)
router.delete('/:id', requireAuth(['admin']), (req, res) => {
    const db = getDb();
    const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id);

    if (!user) {
        return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    // Prevent deleting self
    if (user.id === req.user.id) {
        return res.status(400).json({ success: false, message: 'No puedes eliminarte a ti mismo' });
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

module.exports = router;
