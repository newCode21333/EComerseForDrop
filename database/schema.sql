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

-- Products table
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price REAL NOT NULL,
    source_price REAL,
    markup REAL DEFAULT 1.10,
    old_price REAL,
    image TEXT DEFAULT '📦',
    rating REAL DEFAULT 0,
    reviews INTEGER DEFAULT 0,
    badge TEXT,
    stock INTEGER DEFAULT 0,
    stock_status TEXT DEFAULT 'a_pedido' CHECK(stock_status IN ('en_stock', 'a_pedido', 'agotado')),
    source_url TEXT,
    source_name TEXT,
    sku TEXT UNIQUE,
    description TEXT,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Stock history log
CREATE TABLE IF NOT EXISTS stock_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    previous_stock INTEGER,
    new_stock INTEGER,
    change_type TEXT CHECK(change_type IN ('manual', 'import', 'sale', 'adjustment')),
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);
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
