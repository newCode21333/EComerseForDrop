const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { authMiddleware, requireAuth } = require('./auth');

// Public: GET /api/products - list active products
router.get('/', (req, res) => {
    const db = getDb();
    const { category, search, sort } = req.query;

    let sql = 'SELECT * FROM products WHERE active = 1';
    const params = [];

    if (category && category !== 'todos') {
        sql += ' AND category = ?';
        params.push(category);
    }

    if (search) {
        sql += ' AND (name LIKE ? OR category LIKE ? OR description LIKE ?)';
        const q = `%${search}%`;
        params.push(q, q, q);
    }

    switch (sort) {
        case 'price-asc': sql += ' ORDER BY price ASC'; break;
        case 'price-desc': sql += ' ORDER BY price DESC'; break;
        case 'name': sql += ' ORDER BY name ASC'; break;
        case 'rating': sql += ' ORDER BY rating DESC'; break;
        default: sql += ' ORDER BY created_at DESC';
    }

    const products = db.prepare(sql).all(...params);
    res.json({ success: true, products });
});

// Public: GET /api/products/:id
router.get('/:id', (req, res) => {
    const db = getDb();
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(req.params.id);

    if (!product) {
        return res.status(404).json({ success: false, message: 'Producto no encontrado' });
    }

    res.json({ success: true, product });
});

// Public: GET /api/products/categories/list
router.get('/categories/list', (req, res) => {
    const db = getDb();
    const categories = db.prepare('SELECT DISTINCT category FROM products WHERE active = 1 ORDER BY category').all();
    res.json({ success: true, categories: categories.map(c => c.category) });
});

// === ADMIN ROUTES ===

// POST /api/products - create product (admin only)
router.post('/', authMiddleware, requireAuth(['admin']), (req, res) => {
    const { name, category, source_price, markup, old_price, image, rating, reviews, badge, stock, stock_status, source_url, source_name, sku, description } = req.body;

    if (!name || !category || source_price == null) {
        return res.status(400).json({ success: false, message: 'name, category y source_price son obligatorios' });
    }

    const db = getDb();
    const m = markup || 1.10;
    const finalPrice = Math.round(source_price * m * 100) / 100;
    const status = stock > 0 ? 'en_stock' : (stock_status || 'a_pedido');

    const result = db.prepare(`
        INSERT INTO products (name, category, price, source_price, markup, old_price, image, rating, reviews, badge, stock, stock_status, source_url, source_name, sku, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, category, finalPrice, source_price, m, old_price || null, image || '📦', rating || 0, reviews || 0, badge || null, stock || 0, status, source_url || null, source_name || null, sku || null, description || null);

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);

    // Log stock
    if (stock > 0) {
        db.prepare('INSERT INTO stock_log (product_id, previous_stock, new_stock, change_type, notes) VALUES (?, 0, ?, ?, ?)').run(product.id, stock, 'manual', 'Producto creado');
    }

    res.json({ success: true, product });
});

// PUT /api/products/:id - update product (admin only)
router.put('/:id', authMiddleware, requireAuth(['admin']), (req, res) => {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!existing) {
        return res.status(404).json({ success: false, message: 'Producto no encontrado' });
    }

    const fields = ['name', 'category', 'source_price', 'markup', 'old_price', 'image', 'rating', 'reviews', 'badge', 'stock', 'stock_status', 'source_url', 'source_name', 'sku', 'description', 'active'];
    const updates = [];
    const values = [];

    for (const field of fields) {
        if (req.body[field] !== undefined) {
            updates.push(`${field} = ?`);
            values.push(req.body[field]);
        }
    }

    // Recalculate price if source_price or markup changed
    const newSourcePrice = req.body.source_price !== undefined ? req.body.source_price : existing.source_price;
    const newMarkup = req.body.markup !== undefined ? req.body.markup : existing.markup;
    const newPrice = Math.round(newSourcePrice * newMarkup * 100) / 100;
    updates.push('price = ?');
    values.push(newPrice);

    // Auto stock_status
    if (req.body.stock !== undefined) {
        const stockVal = req.body.stock;
        let status = 'a_pedido';
        if (stockVal > 0) status = 'en_stock';
        else if (req.body.stock_status === 'agotado') status = 'agotado';
        if (!req.body.stock_status) {
            updates.push('stock_status = ?');
            values.push(status);
        }

        // Log stock change
        db.prepare('INSERT INTO stock_log (product_id, previous_stock, new_stock, change_type, notes) VALUES (?, ?, ?, ?, ?)').run(req.params.id, existing.stock, stockVal, 'manual', 'Actualizacion manual');
    }

    updates.push("updated_at = datetime('now')");
    values.push(req.params.id);

    db.prepare(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    res.json({ success: true, product });
});

// DELETE /api/products/:id - soft delete (admin only)
router.delete('/:id', authMiddleware, requireAuth(['admin']), (req, res) => {
    const db = getDb();
    db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// POST /api/products/bulk-stock - bulk update stock (for Python app)
router.post('/bulk-stock', authMiddleware, requireAuth(['admin']), (req, res) => {
    const { updates } = req.body;

    if (!Array.isArray(updates)) {
        return res.status(400).json({ success: false, message: 'Se espera un array de updates' });
    }

    const db = getDb();
    const updateStmt = db.prepare(`
        UPDATE products SET stock = ?, stock_status = ?,
        updated_at = datetime('now') WHERE sku = ?
    `);
    const logStmt = db.prepare(`
        INSERT INTO stock_log (product_id, previous_stock, new_stock, change_type, notes)
        VALUES (?, ?, ?, 'import', ?)
    `);

    const results = { updated: 0, not_found: 0, errors: [] };

    const bulkUpdate = db.transaction(() => {
        for (const item of updates) {
            const product = db.prepare('SELECT id, stock FROM products WHERE sku = ?').get(item.sku);
            if (!product) {
                results.not_found++;
                results.errors.push(`SKU ${item.sku} no encontrado`);
                continue;
            }

            const newStock = item.stock;
            const status = newStock > 0 ? 'en_stock' : (item.stock_status || 'a_pedido');

            updateStmt.run(newStock, status, item.sku);
            logStmt.run(product.id, product.stock, newStock, `Import: ${item.notes || 'bulk update'}`);

            // Update price if source_price provided
            if (item.source_price) {
                const prod = db.prepare('SELECT markup FROM products WHERE sku = ?').get(item.sku);
                const newPrice = Math.round(item.source_price * prod.markup * 100) / 100;
                db.prepare('UPDATE products SET source_price = ?, price = ? WHERE sku = ?').run(item.source_price, newPrice, item.sku);
            }

            results.updated++;
        }
    });

    bulkUpdate();
    res.json({ success: true, results });
});

// POST /api/products/bulk-import - import products (for Python app)
router.post('/bulk-import', authMiddleware, requireAuth(['admin']), (req, res) => {
    const { products } = req.body;

    if (!Array.isArray(products)) {
        return res.status(400).json({ success: false, message: 'Se espera un array de products' });
    }

    const db = getDb();
    const results = { created: 0, updated: 0, errors: [] };

    const bulkImport = db.transaction(() => {
        for (const p of products) {
            if (!p.name || !p.category || p.source_price == null) {
                results.errors.push(`Producto invalido: ${p.name || 'sin nombre'}`);
                continue;
            }

            const markup = p.markup || 1.10;
            const finalPrice = Math.round(p.source_price * markup * 100) / 100;
            const stock = p.stock || 0;
            const status = stock > 0 ? 'en_stock' : (p.stock_status || 'a_pedido');

            // Check if SKU exists
            if (p.sku) {
                const existing = db.prepare('SELECT id, stock FROM products WHERE sku = ?').get(p.sku);
                if (existing) {
                    db.prepare(`
                        UPDATE products SET name=?, category=?, price=?, source_price=?, markup=?, old_price=?,
                        image=?, stock=?, stock_status=?, source_url=?, source_name=?, description=?,
                        badge=?, updated_at=datetime('now') WHERE sku=?
                    `).run(p.name, p.category, finalPrice, p.source_price, markup, p.old_price || null,
                        p.image || '📦', stock, status, p.source_url || null, p.source_name || null,
                        p.description || null, p.badge || null, p.sku);

                    db.prepare('INSERT INTO stock_log (product_id, previous_stock, new_stock, change_type, notes) VALUES (?, ?, ?, ?, ?)').run(existing.id, existing.stock, stock, 'import', 'Bulk import update');

                    results.updated++;
                    continue;
                }
            }

            const result = db.prepare(`
                INSERT INTO products (name, category, price, source_price, markup, old_price, image, rating, reviews, badge, stock, stock_status, source_url, source_name, sku, description)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(p.name, p.category, finalPrice, p.source_price, markup, p.old_price || null,
                p.image || '📦', p.rating || 0, p.reviews || 0, p.badge || null,
                stock, status, p.source_url || null, p.source_name || null,
                p.sku || null, p.description || null);

            if (stock > 0) {
                db.prepare('INSERT INTO stock_log (product_id, previous_stock, new_stock, change_type, notes) VALUES (?, 0, ?, ?, ?)').run(result.lastInsertRowid, stock, 'import', 'Bulk import new');
            }

            results.created++;
        }
    });

    bulkImport();
    res.json({ success: true, results });
});

// GET /api/products/:id/stock-log - stock history (admin)
router.get('/:id/stock-log', authMiddleware, requireAuth(['admin']), (req, res) => {
    const db = getDb();
    const logs = db.prepare('SELECT * FROM stock_log WHERE product_id = ? ORDER BY created_at DESC LIMIT 50').all(req.params.id);
    res.json({ success: true, logs });
});

module.exports = router;
