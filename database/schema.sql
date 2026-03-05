-- DropShop Database Schema
-- SQLite compatible

-- Users table (admin, employee, client)
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

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Chats table
CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    employee_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_client ON chats(client_id);
CREATE INDEX IF NOT EXISTS idx_chats_employee ON chats(employee_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);

-- Default data: Admin account
INSERT OR IGNORE INTO users (name, email, password, role, avatar, department, status)
VALUES ('Admin Principal', 'admin@dropshop.com', '$HASHED_admin123', 'admin', '👑', NULL, 'online');

-- Default employees
INSERT OR IGNORE INTO users (name, email, password, role, avatar, department, status)
VALUES ('Carlos Soporte', 'carlos@dropshop.com', '$HASHED_emp123', 'employee', '👨‍💼', 'Soporte', 'online');

INSERT OR IGNORE INTO users (name, email, password, role, avatar, department, status)
VALUES ('Maria Ventas', 'maria@dropshop.com', '$HASHED_emp123', 'employee', '👩‍💼', 'Ventas', 'online');

INSERT OR IGNORE INTO users (name, email, password, role, avatar, department, status)
VALUES ('Luis Tecnico', 'luis@dropshop.com', '$HASHED_emp123', 'employee', '👨‍🔧', 'Soporte Tecnico', 'away');
