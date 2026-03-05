// ===== API Client =====
// Replaces localStorage auth with server API calls

const API = {
    baseUrl: '/api',

    async request(method, path, body = null) {
        const opts = {
            method,
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
        };
        if (body) opts.body = JSON.stringify(body);

        const res = await fetch(this.baseUrl + path, opts);
        const data = await res.json();

        if (!res.ok && !data.success) {
            throw { status: res.status, message: data.message || 'Error del servidor' };
        }
        return data;
    },

    get(path) { return this.request('GET', path); },
    post(path, body) { return this.request('POST', path, body); },
    put(path, body) { return this.request('PUT', path, body); },
    del(path) { return this.request('DELETE', path); }
};

// ===== AUTH API =====
const AUTH_API = {
    async register(name, email, password) {
        return API.post('/auth/register', { name, email, password });
    },

    async registerEmployee(name, email, password, department) {
        return API.post('/users/employee', { name, email, password, department });
    },

    async login(email, password) {
        const data = await API.post('/auth/login', { email, password });
        if (data.success) {
            // Cache user in sessionStorage for quick access
            sessionStorage.setItem('ds_user', JSON.stringify(data.user));
        }
        return data;
    },

    async logout() {
        try { await API.post('/auth/logout'); } catch (e) { /* ignore */ }
        sessionStorage.removeItem('ds_user');
        window.location.href = 'login.html';
    },

    async getSession() {
        // Check cache first
        const cached = sessionStorage.getItem('ds_user');
        if (cached) {
            // Verify session is still valid in background
            try {
                const data = await API.get('/auth/me');
                if (data.success && data.user) {
                    sessionStorage.setItem('ds_user', JSON.stringify(data.user));
                    return data.user;
                }
                sessionStorage.removeItem('ds_user');
                return null;
            } catch (e) {
                sessionStorage.removeItem('ds_user');
                return null;
            }
        }

        try {
            const data = await API.get('/auth/me');
            if (data.success && data.user) {
                sessionStorage.setItem('ds_user', JSON.stringify(data.user));
                return data.user;
            }
            return null;
        } catch (e) {
            return null;
        }
    },

    getCachedSession() {
        const cached = sessionStorage.getItem('ds_user');
        return cached ? JSON.parse(cached) : null;
    },

    async requireAuth(allowedRoles = null) {
        const user = await this.getSession();
        if (!user) {
            window.location.href = 'login.html';
            return null;
        }
        if (allowedRoles && !allowedRoles.includes(user.role)) {
            window.location.href = 'index.html';
            return null;
        }
        return user;
    }
};

// ===== USERS API =====
const USERS_API = {
    async getAll() {
        const data = await API.get('/users');
        return data.users;
    },

    async getEmployees() {
        const data = await API.get('/users/employees');
        return data.employees;
    },

    async getClients() {
        const data = await API.get('/users/clients');
        return data.clients;
    },

    async getStats() {
        const data = await API.get('/users/stats');
        return data.stats;
    },

    async createEmployee(name, email, password, department) {
        return API.post('/users/employee', { name, email, password, department });
    },

    async updateUser(id, updates) {
        return API.put('/users/' + id, updates);
    },

    async deleteUser(id) {
        return API.del('/users/' + id);
    }
};

// ===== PRODUCTS API =====
const PRODUCTS_API = {
    async getAll(params = {}) {
        const query = new URLSearchParams(params).toString();
        const data = await API.get('/products' + (query ? '?' + query : ''));
        return data.products;
    },

    async getById(id) {
        const data = await API.get('/products/' + id);
        return data.product;
    },

    async getCategories() {
        const data = await API.get('/products/categories/list');
        return data.categories;
    },

    async create(product) {
        return API.post('/products', product);
    },

    async update(id, updates) {
        return API.put('/products/' + id, updates);
    },

    async remove(id) {
        return API.del('/products/' + id);
    },

    async bulkStock(updates) {
        return API.post('/products/bulk-stock', { updates });
    },

    async bulkImport(products) {
        return API.post('/products/bulk-import', { products });
    },

    async getStockLog(productId) {
        const data = await API.get('/products/' + productId + '/stock-log');
        return data.logs;
    }
};

// ===== CHAT API =====
const CHAT_API = {
    async getMyChats() {
        const data = await API.get('/chats');
        return data.chats;
    },

    async startChat(employeeId) {
        const data = await API.post('/chats', { employee_id: employeeId });
        return data;
    },

    async getMessages(chatId) {
        const data = await API.get('/chats/' + chatId + '/messages');
        return data;
    },

    async sendMessage(chatId, text) {
        return API.post('/chats/' + chatId + '/messages', { text });
    },

    async closeChat(chatId) {
        return API.put('/chats/' + chatId + '/close');
    }
};
