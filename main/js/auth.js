// ===== Auth System =====
// Uses localStorage to simulate a backend

const AUTH = {
    // Default admin and employees
    defaultUsers: [
        { id: 1, name: "Admin Principal", email: "admin@dropshop.com", password: "admin123", role: "admin", avatar: "👑", createdAt: "2026-01-01" },
        { id: 2, name: "Carlos Soporte", email: "carlos@dropshop.com", password: "emp123", role: "employee", avatar: "👨‍💼", department: "Soporte", status: "online", createdAt: "2026-01-15" },
        { id: 3, name: "Maria Ventas", email: "maria@dropshop.com", password: "emp123", role: "employee", avatar: "👩‍💼", department: "Ventas", status: "online", createdAt: "2026-02-01" },
        { id: 4, name: "Luis Tecnico", email: "luis@dropshop.com", password: "emp123", role: "employee", avatar: "👨‍🔧", department: "Soporte Tecnico", status: "away", createdAt: "2026-02-10" }
    ],

    init() {
        if (!localStorage.getItem('ds_users')) {
            localStorage.setItem('ds_users', JSON.stringify(this.defaultUsers));
        }
    },

    getUsers() {
        this.init();
        return JSON.parse(localStorage.getItem('ds_users')) || [];
    },

    saveUsers(users) {
        localStorage.setItem('ds_users', JSON.stringify(users));
    },

    register(name, email, password, role = 'client') {
        const users = this.getUsers();
        if (users.find(u => u.email === email)) {
            return { success: false, message: "Este correo ya esta registrado" };
        }
        const newUser = {
            id: Date.now(),
            name,
            email,
            password,
            role,
            avatar: role === 'employee' ? '👨‍💼' : '👤',
            department: role === 'employee' ? 'General' : undefined,
            status: role === 'employee' ? 'online' : undefined,
            createdAt: new Date().toISOString().split('T')[0]
        };
        users.push(newUser);
        this.saveUsers(users);
        return { success: true, user: newUser };
    },

    login(email, password) {
        const users = this.getUsers();
        const user = users.find(u => u.email === email && u.password === password);
        if (!user) {
            return { success: false, message: "Correo o contrasena incorrectos" };
        }
        const session = { ...user };
        delete session.password;
        localStorage.setItem('ds_session', JSON.stringify(session));
        return { success: true, user: session };
    },

    logout() {
        localStorage.removeItem('ds_session');
        window.location.href = 'login.html';
    },

    getSession() {
        const session = localStorage.getItem('ds_session');
        return session ? JSON.parse(session) : null;
    },

    isLoggedIn() {
        return this.getSession() !== null;
    },

    requireAuth(allowedRoles = null) {
        const session = this.getSession();
        if (!session) {
            window.location.href = 'login.html';
            return null;
        }
        if (allowedRoles && !allowedRoles.includes(session.role)) {
            window.location.href = 'index.html';
            return null;
        }
        return session;
    },

    deleteUser(userId) {
        let users = this.getUsers();
        users = users.filter(u => u.id !== userId);
        this.saveUsers(users);
    },

    updateUser(userId, updates) {
        const users = this.getUsers();
        const index = users.findIndex(u => u.id === userId);
        if (index > -1) {
            users[index] = { ...users[index], ...updates };
            this.saveUsers(users);
            // Update session if editing self
            const session = this.getSession();
            if (session && session.id === userId) {
                const updated = { ...users[index] };
                delete updated.password;
                localStorage.setItem('ds_session', JSON.stringify(updated));
            }
            return true;
        }
        return false;
    },

    getEmployees() {
        return this.getUsers().filter(u => u.role === 'employee');
    },

    getClients() {
        return this.getUsers().filter(u => u.role === 'client');
    }
};

// ===== Chat System =====
const CHAT = {
    getChats() {
        return JSON.parse(localStorage.getItem('ds_chats')) || [];
    },

    saveChats(chats) {
        localStorage.setItem('ds_chats', JSON.stringify(chats));
    },

    startChat(clientId, employeeId) {
        const chats = this.getChats();
        // Check for existing open chat
        const existing = chats.find(c => c.clientId === clientId && c.employeeId === employeeId && c.status === 'open');
        if (existing) return existing;

        const chat = {
            id: Date.now(),
            clientId,
            employeeId,
            status: 'open',
            messages: [],
            createdAt: new Date().toISOString()
        };
        chats.push(chat);
        this.saveChats(chats);
        return chat;
    },

    sendMessage(chatId, senderId, text) {
        const chats = this.getChats();
        const chat = chats.find(c => c.id === chatId);
        if (!chat) return null;

        const msg = {
            id: Date.now(),
            senderId,
            text,
            timestamp: new Date().toISOString()
        };
        chat.messages.push(msg);
        this.saveChats(chats);
        return msg;
    },

    getChatMessages(chatId) {
        const chats = this.getChats();
        const chat = chats.find(c => c.id === chatId);
        return chat ? chat.messages : [];
    },

    getUserChats(userId) {
        const chats = this.getChats();
        return chats.filter(c => c.clientId === userId || c.employeeId === userId);
    },

    closeChat(chatId) {
        const chats = this.getChats();
        const chat = chats.find(c => c.id === chatId);
        if (chat) {
            chat.status = 'closed';
            this.saveChats(chats);
        }
    }
};

// Init on load
AUTH.init();
