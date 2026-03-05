const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { authMiddleware, requireAuth } = require('./auth');

router.use(authMiddleware);
router.use(requireAuth());

// GET /api/chats - get user's chats
router.get('/', (req, res) => {
    const db = getDb();
    let chats;

    if (req.user.role === 'admin') {
        // Admin sees all chats
        chats = db.prepare(`
            SELECT c.*,
                   cl.name as client_name, cl.avatar as client_avatar,
                   emp.name as employee_name, emp.avatar as employee_avatar,
                   (SELECT COUNT(*) FROM messages WHERE chat_id = c.id) as message_count
            FROM chats c
            JOIN users cl ON c.client_id = cl.id
            JOIN users emp ON c.employee_id = emp.id
            ORDER BY c.created_at DESC
        `).all();
    } else {
        // Employees/clients see their own chats
        chats = db.prepare(`
            SELECT c.*,
                   cl.name as client_name, cl.avatar as client_avatar,
                   emp.name as employee_name, emp.avatar as employee_avatar, emp.department,
                   emp.status as employee_status,
                   (SELECT COUNT(*) FROM messages WHERE chat_id = c.id) as message_count
            FROM chats c
            JOIN users cl ON c.client_id = cl.id
            JOIN users emp ON c.employee_id = emp.id
            WHERE c.client_id = ? OR c.employee_id = ?
            ORDER BY c.created_at DESC
        `).all(req.user.id, req.user.id);
    }

    // Get last message for each chat
    chats = chats.map(chat => {
        const lastMsg = db.prepare(`
            SELECT text, created_at FROM messages WHERE chat_id = ? ORDER BY created_at DESC LIMIT 1
        `).get(chat.id);
        return { ...chat, last_message: lastMsg ? lastMsg.text : null };
    });

    res.json({ success: true, chats });
});

// POST /api/chats - start a new chat (client -> employee)
router.post('/', (req, res) => {
    const { employee_id } = req.body;

    if (!employee_id) {
        return res.status(400).json({ success: false, message: 'employee_id requerido' });
    }

    const db = getDb();

    // Check employee exists
    const employee = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'employee'").get(employee_id);
    if (!employee) {
        return res.status(404).json({ success: false, message: 'Empleado no encontrado' });
    }

    // Check for existing open chat
    const existing = db.prepare(`
        SELECT * FROM chats WHERE client_id = ? AND employee_id = ? AND status = 'open'
    `).get(req.user.id, employee_id);

    if (existing) {
        return res.json({ success: true, chat: existing, existing: true });
    }

    const result = db.prepare(`
        INSERT INTO chats (client_id, employee_id, status) VALUES (?, ?, 'open')
    `).run(req.user.id, employee_id);

    const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(result.lastInsertRowid);
    res.json({ success: true, chat, existing: false });
});

// GET /api/chats/:id/messages - get messages for a chat
router.get('/:id/messages', (req, res) => {
    const db = getDb();
    const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id);

    if (!chat) {
        return res.status(404).json({ success: false, message: 'Chat no encontrado' });
    }

    // Verify user is part of this chat or admin
    if (req.user.role !== 'admin' && chat.client_id !== req.user.id && chat.employee_id !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Sin acceso a este chat' });
    }

    const messages = db.prepare(`
        SELECT m.*, u.name as sender_name, u.avatar as sender_avatar
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.chat_id = ?
        ORDER BY m.created_at ASC
    `).all(req.params.id);

    res.json({ success: true, messages, chat });
});

// POST /api/chats/:id/messages - send a message
router.post('/:id/messages', (req, res) => {
    const { text } = req.body;

    if (!text || !text.trim()) {
        return res.status(400).json({ success: false, message: 'Mensaje vacio' });
    }

    const db = getDb();
    const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id);

    if (!chat) {
        return res.status(404).json({ success: false, message: 'Chat no encontrado' });
    }

    if (chat.status === 'closed') {
        return res.status(400).json({ success: false, message: 'Este chat esta cerrado' });
    }

    // Verify user is part of this chat
    if (req.user.role !== 'admin' && chat.client_id !== req.user.id && chat.employee_id !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Sin acceso a este chat' });
    }

    const result = db.prepare(`
        INSERT INTO messages (chat_id, sender_id, text) VALUES (?, ?, ?)
    `).run(req.params.id, req.user.id, text.trim());

    const message = db.prepare(`
        SELECT m.*, u.name as sender_name, u.avatar as sender_avatar
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.id = ?
    `).get(result.lastInsertRowid);

    res.json({ success: true, message });
});

// PUT /api/chats/:id/close - close a chat
router.put('/:id/close', (req, res) => {
    const db = getDb();
    const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(req.params.id);

    if (!chat) {
        return res.status(404).json({ success: false, message: 'Chat no encontrado' });
    }

    // Only employee, admin, or chat owner can close
    if (req.user.role !== 'admin' && chat.client_id !== req.user.id && chat.employee_id !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Sin permisos' });
    }

    db.prepare("UPDATE chats SET status = 'closed' WHERE id = ?").run(req.params.id);
    res.json({ success: true });
});

module.exports = router;
