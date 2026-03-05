const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');

const { router: authRouter } = require('./routes/auth');
const usersRouter = require('./routes/users');
const chatsRouter = require('./routes/chats');
const productsRouter = require('./routes/products');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/chats', chatsRouter);
app.use('/api/products', productsRouter);

// Serve static files from /main
app.use(express.static(path.join(__dirname, '..', 'main')));

// SPA fallback - serve index.html for non-API routes
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, '..', 'main', 'index.html'));
    }
});

app.listen(PORT, () => {
    console.log(`
  ╔══════════════════════════════════════════╗
  ║          DropShop Server v1.0            ║
  ╠══════════════════════════════════════════╣
  ║  Servidor:  http://localhost:${PORT}        ║
  ║  Tienda:    http://localhost:${PORT}        ║
  ║  Login:     http://localhost:${PORT}/login.html   ║
  ║  Admin:     http://localhost:${PORT}/admin.html   ║
  ║  Soporte:   http://localhost:${PORT}/support.html ║
  ╠══════════════════════════════════════════╣
  ║  Cuentas por defecto:                    ║
  ║  Admin:    admin@dropshop.com / admin123 ║
  ║  Empleado: carlos@dropshop.com / emp123  ║
  ╚══════════════════════════════════════════╝
    `);
});
