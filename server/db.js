const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, '..', 'database', 'dropshop.db');
const DB_DIR = path.dirname(DB_PATH);

let db;
let rawDb; // the actual sql.js database instance

// Save database to disk
function saveDb() {
    const data = rawDb.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
}

// Auto-save periodically and on changes
let saveTimeout = null;
function scheduleSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        try { saveDb(); } catch (e) { console.error('Error saving DB:', e); }
    }, 500);
}

// Wrapper: mimic better-sqlite3 Statement API
class StatementWrapper {
    constructor(database, sql) {
        this._db = database;
        this._sql = sql;
    }

    _bindParams(params) {
        if (!params || params.length === 0) return [];
        // sql.js uses arrays for positional params
        return params.map(p => p === undefined ? null : p);
    }

    get(...params) {
        try {
            const stmt = this._db.prepare(this._sql);
            const bound = this._bindParams(params);
            stmt.bind(bound);
            if (stmt.step()) {
                const cols = stmt.getColumnNames();
                const vals = stmt.get();
                const row = {};
                for (let i = 0; i < cols.length; i++) {
                    row[cols[i]] = vals[i];
                }
                stmt.free();
                return row;
            }
            stmt.free();
            return undefined;
        } catch (e) {
            throw e;
        }
    }

    all(...params) {
        try {
            const stmt = this._db.prepare(this._sql);
            const bound = this._bindParams(params);
            stmt.bind(bound);
            const rows = [];
            while (stmt.step()) {
                const cols = stmt.getColumnNames();
                const vals = stmt.get();
                const row = {};
                for (let i = 0; i < cols.length; i++) {
                    row[cols[i]] = vals[i];
                }
                rows.push(row);
            }
            stmt.free();
            return rows;
        } catch (e) {
            throw e;
        }
    }

    run(...params) {
        try {
            const bound = this._bindParams(params);
            this._db.run(this._sql, bound);
            const lastId = this._db.exec("SELECT last_insert_rowid() as id")[0];
            const changesResult = this._db.exec("SELECT changes() as c")[0];
            scheduleSave();
            return {
                lastInsertRowid: lastId ? lastId.values[0][0] : 0,
                changes: changesResult ? changesResult.values[0][0] : 0
            };
        } catch (e) {
            throw e;
        }
    }
}

// Wrapper: mimic better-sqlite3 Database API
class DatabaseWrapper {
    constructor(sqlJsDb) {
        this._db = sqlJsDb;
    }

    prepare(sql) {
        return new StatementWrapper(this._db, sql);
    }

    exec(sql) {
        this._db.run(sql);
        scheduleSave();
    }

    pragma(pragmaStr) {
        try {
            this._db.run(`PRAGMA ${pragmaStr}`);
        } catch (e) {
            // Some pragmas may not be supported in sql.js
        }
    }

    transaction(fn) {
        return (...args) => {
            this._db.run('BEGIN TRANSACTION');
            try {
                const result = fn(...args);
                this._db.run('COMMIT');
                scheduleSave();
                return result;
            } catch (e) {
                this._db.run('ROLLBACK');
                throw e;
            }
        };
    }

    close() {
        saveDb();
        this._db.close();
    }
}

let initPromise = null;

async function initDatabase() {
    const SQL = await initSqlJs();

    // Ensure database directory exists
    if (!fs.existsSync(DB_DIR)) {
        fs.mkdirSync(DB_DIR, { recursive: true });
    }

    // Load existing database or create new
    if (fs.existsSync(DB_PATH)) {
        const buffer = fs.readFileSync(DB_PATH);
        rawDb = new SQL.Database(buffer);
    } else {
        rawDb = new SQL.Database();
    }

    db = new DatabaseWrapper(rawDb);
    db.pragma('foreign_keys = ON');
    initDb();
    return db;
}

function getDb() {
    if (!db) {
        throw new Error('Database not initialized. Call initDatabase() first.');
    }
    return db;
}

// Async init that server/index.js will await
async function ensureDb() {
    if (db) return db;
    if (!initPromise) {
        initPromise = initDatabase();
    }
    return initPromise;
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

        CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
        CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
        CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);

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

    // Seed default products if empty
    const productCount = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
    if (productCount === 0) {
        const insertProduct = db.prepare(`
            INSERT INTO products (name, category, price, source_price, old_price, image, rating, reviews, badge, stock, stock_status, sku, description)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const seedProducts = db.transaction(() => {
            insertProduct.run('Audifonos Inalambricos Pro', 'electronica', 79.99, 72.72, 129.99, '🎧', 4.8, 234, '-38%', 25, 'en_stock', 'ELEC-001', 'Audifonos bluetooth con cancelacion de ruido activa');
            insertProduct.run('Smartwatch Deportivo', 'electronica', 149.99, 136.35, 199.99, '⌚', 4.6, 189, '-25%', 12, 'en_stock', 'ELEC-002', 'Reloj inteligente resistente al agua con GPS');
            insertProduct.run('Camiseta Premium Algodon', 'ropa', 29.99, 27.26, null, '👕', 4.5, 156, 'new', 50, 'en_stock', 'ROPA-001', 'Camiseta 100% algodon organico');
            insertProduct.run('Lampara LED Moderna', 'hogar', 45.99, 41.81, 69.99, '💡', 4.7, 98, '-34%', 8, 'en_stock', 'HOGR-001', 'Lampara regulable con control remoto');
            insertProduct.run('Zapatillas Running Ultra', 'deportes', 89.99, 81.81, 119.99, '👟', 4.9, 312, '-25%', 0, 'a_pedido', 'DEPO-001', 'Zapatillas ultra ligeras para correr');
            insertProduct.run('Mochila Urban Style', 'accesorios', 39.99, 36.35, null, '🎒', 4.4, 87, 'new', 30, 'en_stock', 'ACCE-001', 'Mochila resistente al agua con puerto USB');
            insertProduct.run('Parlante Bluetooth Mini', 'electronica', 34.99, 31.81, 54.99, '🔊', 4.3, 145, '-36%', 18, 'en_stock', 'ELEC-003', 'Parlante portatil 10W con 12h de bateria');
            insertProduct.run('Chaqueta Impermeable', 'ropa', 69.99, 63.63, 99.99, '🧥', 4.6, 203, '-30%', 0, 'a_pedido', 'ROPA-002', 'Chaqueta impermeable y cortavientos');
            insertProduct.run('Set de Yoga Completo', 'deportes', 55.99, 50.90, null, '🧘', 4.7, 76, 'new', 15, 'en_stock', 'DEPO-002', 'Mat + bloques + correa + bolsa de transporte');
            insertProduct.run('Organizador de Escritorio', 'hogar', 24.99, 22.72, 34.99, '📦', 4.2, 64, '-29%', 40, 'en_stock', 'HOGR-002', 'Organizador de bambu con 5 compartimentos');
            insertProduct.run('Gafas de Sol Polarizadas', 'accesorios', 49.99, 45.45, 79.99, '🕶️', 4.5, 178, '-37%', 0, 'agotado', 'ACCE-002', 'Proteccion UV400 con montura de titanio');
            insertProduct.run('Teclado Mecanico RGB', 'electronica', 64.99, 59.08, 89.99, '⌨️', 4.8, 267, '-28%', 7, 'en_stock', 'ELEC-004', 'Teclado mecanico switches Cherry MX');
        });

        seedProducts();
        console.log('Productos por defecto insertados');
    }

    // Save initial state
    saveDb();
}

// Graceful shutdown
process.on('exit', () => {
    if (rawDb) {
        try { saveDb(); rawDb.close(); } catch (e) {}
    }
});
process.on('SIGINT', () => { process.exit(); });
process.on('SIGTERM', () => { process.exit(); });

module.exports = { getDb, ensureDb, hashPassword, verifyPassword, generateSessionId };
