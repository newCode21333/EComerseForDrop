const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, '..', 'database', 'dropshop.db');

let db;

function getDb() {
    if (!db) {
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        initDb();
    }
    return db;
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
    const [salt, hash] = stored.split(':');
    const verify = crypto.scryptSync(password, salt, 64).toString('hex');
    return hash === verify;
}

function generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
}

function initDb() {
    // Create tables
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('admin', 'employee', 'client')),
            avatar TEXT DEFAULT '👤',
            department TEXT,
            status TEXT DEFAULT 'offline' CHECK(status IN ('online', 'away', 'offline')),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS chats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id INTEGER NOT NULL,
            employee_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed')),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id INTEGER NOT NULL,
            sender_id INTEGER NOT NULL,
            text TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
            FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_chats_client ON chats(client_id);
        CREATE INDEX IF NOT EXISTS idx_chats_employee ON chats(employee_id);
        CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
    `);

    // Seed default users if empty
    const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    if (count === 0) {
        const insert = db.prepare(`
            INSERT INTO users (name, email, password, role, avatar, department, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        const seed = db.transaction(() => {
            insert.run('Admin Principal', 'admin@dropshop.com', hashPassword('admin123'), 'admin', '👑', null, 'online');
            insert.run('Carlos Soporte', 'carlos@dropshop.com', hashPassword('emp123'), 'employee', '👨‍💼', 'Soporte', 'online');
            insert.run('Maria Ventas', 'maria@dropshop.com', hashPassword('emp123'), 'employee', '👩‍💼', 'Ventas', 'online');
            insert.run('Luis Tecnico', 'luis@dropshop.com', hashPassword('emp123'), 'employee', '👨‍🔧', 'Soporte Tecnico', 'away');
        });

        seed();
        console.log('Base de datos inicializada con usuarios por defecto');
    }
}

module.exports = { getDb, hashPassword, verifyPassword, generateSessionId };
