// ===== Product Data (loaded from API) =====
let products = [];

// ===== State =====
let cart = JSON.parse(localStorage.getItem('cart')) || [];
let wishlist = JSON.parse(localStorage.getItem('wishlist')) || [];
let currentCategory = 'todos';
let currentSort = 'default';
let searchQuery = '';
let productsLoaded = false;

// ===== Load Products from API =====
async function loadProducts() {
    try {
        const params = {};
        if (currentCategory !== 'todos') params.category = currentCategory;
        if (searchQuery) params.search = searchQuery;
        if (currentSort !== 'default') params.sort = currentSort;

        const data = await fetch('/api/products?' + new URLSearchParams(params));
        const json = await data.json();

        if (json.success) {
            // Map DB fields to frontend fields
            products = json.products.map(p => ({
                id: p.id,
                name: p.name,
                category: p.category,
                price: p.price,
                oldPrice: p.old_price,
                image: p.image || '📦',
                rating: p.rating,
                reviews: p.reviews,
                badge: p.badge,
                stock: p.stock,
                stockStatus: p.stock_status,
                sku: p.sku,
                description: p.description,
                sourceUrl: p.source_url,
                sourceName: p.source_name
            }));
            productsLoaded = true;
            renderProducts();
        }
    } catch (err) {
        console.error('Error loading products:', err);
        // Show error in grid
        productsGrid.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px; color: var(--gray);">
                <p style="font-size: 1.2rem;">Error al cargar productos</p>
                <p style="font-size: 0.9rem; margin-top: 8px;">Verifica que el servidor este ejecutandose</p>
            </div>
        `;
    }
}

// ===== DOM Elements =====
const productsGrid = document.getElementById('productsGrid');
const cartBtn = document.getElementById('cartBtn');
const cartSidebar = document.getElementById('cartSidebar');
const cartOverlay = document.getElementById('cartOverlay');
const closeCart = document.getElementById('closeCart');
const cartItems = document.getElementById('cartItems');
const cartCount = document.getElementById('cartCount');
const cartTotal = document.getElementById('cartTotal');
const cartFooter = document.getElementById('cartFooter');
const menuToggle = document.getElementById('menuToggle');
const mobileNav = document.getElementById('mobileNav');
const searchInput = document.getElementById('searchInput');
const sortSelect = document.getElementById('sortSelect');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toastMessage');
const newsletterForm = document.getElementById('newsletterForm');
const checkoutBtn = document.getElementById('checkoutBtn');

// ===== Render Products =====
function getFilteredProducts() {
    // Products already filtered by API, just return them
    return products;
}

function renderStars(rating) {
    const full = Math.floor(rating);
    const half = rating % 1 >= 0.5 ? 1 : 0;
    const empty = 5 - full - half;
    return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
}

function getStockLabel(product) {
    if (product.stockStatus === 'en_stock') {
        return `<span class="stock-badge stock-available">En Stock (${product.stock})</span>`;
    } else if (product.stockStatus === 'a_pedido') {
        return '<span class="stock-badge stock-order">A Pedido</span>';
    } else {
        return '<span class="stock-badge stock-out">Agotado</span>';
    }
}

function renderProducts() {
    const filtered = getFilteredProducts();

    if (filtered.length === 0) {
        productsGrid.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px; color: var(--gray);">
                <p style="font-size: 1.2rem;">No se encontraron productos</p>
                <p style="font-size: 0.9rem; margin-top: 8px;">Intenta con otra busqueda o categoria</p>
            </div>
        `;
        return;
    }

    productsGrid.innerHTML = filtered.map(product => {
        const isWished = wishlist.includes(product.id);
        const badgeClass = product.badge === 'new' ? 'new' : '';
        const badgeText = product.badge === 'new' ? 'Nuevo' : product.badge;
        const isDisabled = product.stockStatus === 'agotado';
        const btnText = isDisabled ? 'Agotado' : (product.stockStatus === 'a_pedido' ? 'Pedir' : 'Agregar');

        return `
            <div class="product-card">
                ${product.badge ? `<span class="product-badge ${badgeClass}">${badgeText}</span>` : ''}
                <div class="product-image">
                    <button class="product-wishlist ${isWished ? 'active' : ''}"
                            onclick="toggleWishlist(${product.id})"
                            aria-label="Agregar a favoritos">
                        ${isWished ? '❤️' : '🤍'}
                    </button>
                    ${product.image}
                </div>
                <div class="product-info">
                    <span class="product-category">${product.category}</span>
                    <h3 class="product-name">${product.name}</h3>
                    <div class="product-rating">
                        <span class="stars">${renderStars(product.rating)}</span>
                        <span class="rating-count">(${product.reviews})</span>
                    </div>
                    ${getStockLabel(product)}
                    <div class="product-footer">
                        <div class="product-price">
                            <span class="price-current">$${product.price.toFixed(2)}</span>
                            ${product.oldPrice ? `<span class="price-old">$${product.oldPrice.toFixed(2)}</span>` : ''}
                        </div>
                        <button class="add-to-cart" onclick="addToCart(${product.id})" ${isDisabled ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>${btnText}</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ===== Cart Functions =====
function addToCart(productId) {
    const product = products.find(p => p.id === productId);
    if (!product || product.stockStatus === 'agotado') return;

    const existing = cart.find(item => item.id === productId);

    if (existing) {
        existing.qty += 1;
    } else {
        cart.push({ ...product, qty: 1 });
    }

    saveCart();
    updateCartUI();
    showToast(`${product.name} agregado al carrito`);
}

function removeFromCart(productId) {
    cart = cart.filter(item => item.id !== productId);
    saveCart();
    updateCartUI();
}

function updateQty(productId, delta) {
    const item = cart.find(i => i.id === productId);
    if (!item) return;

    item.qty += delta;
    if (item.qty <= 0) {
        removeFromCart(productId);
        return;
    }

    saveCart();
    updateCartUI();
}

function saveCart() {
    localStorage.setItem('cart', JSON.stringify(cart));
}

function getCartTotal() {
    return cart.reduce((sum, item) => sum + item.price * item.qty, 0);
}

function getCartCount() {
    return cart.reduce((sum, item) => sum + item.qty, 0);
}

function updateCartUI() {
    const count = getCartCount();
    cartCount.textContent = count;
    cartCount.style.display = count > 0 ? 'flex' : 'none';

    if (cart.length === 0) {
        cartItems.innerHTML = '<div class="cart-empty"><p>Tu carrito esta vacio</p></div>';
        cartFooter.style.display = 'none';
        return;
    }

    cartFooter.style.display = 'block';
    cartTotal.textContent = `$${getCartTotal().toFixed(2)}`;

    cartItems.innerHTML = cart.map(item => `
        <div class="cart-item">
            <div class="cart-item-image">${item.image}</div>
            <div class="cart-item-details">
                <div class="cart-item-name">${item.name}</div>
                <div class="cart-item-price">$${(item.price * item.qty).toFixed(2)}</div>
                <div class="cart-item-qty">
                    <button onclick="updateQty(${item.id}, -1)">-</button>
                    <span>${item.qty}</span>
                    <button onclick="updateQty(${item.id}, 1)">+</button>
                </div>
            </div>
            <button class="cart-item-remove" onclick="removeFromCart(${item.id})" aria-label="Eliminar">&times;</button>
        </div>
    `).join('');
}

// ===== Wishlist =====
function toggleWishlist(productId) {
    const index = wishlist.indexOf(productId);
    if (index > -1) {
        wishlist.splice(index, 1);
        showToast('Eliminado de favoritos');
    } else {
        wishlist.push(productId);
        showToast('Agregado a favoritos');
    }
    localStorage.setItem('wishlist', JSON.stringify(wishlist));
    renderProducts();
}

// ===== Cart Sidebar Toggle =====
function openCart() {
    cartSidebar.classList.add('active');
    cartOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeCartFn() {
    cartSidebar.classList.remove('active');
    cartOverlay.classList.remove('active');
    document.body.style.overflow = '';
}

cartBtn.addEventListener('click', openCart);
closeCart.addEventListener('click', closeCartFn);
cartOverlay.addEventListener('click', closeCartFn);

// ===== Mobile Menu =====
menuToggle.addEventListener('click', () => {
    mobileNav.classList.toggle('active');
});

// Close mobile nav on link click
mobileNav.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
        mobileNav.classList.remove('active');
    });
});

// ===== Category Filter =====
document.querySelectorAll('.category-card').forEach(card => {
    card.addEventListener('click', () => {
        document.querySelectorAll('.category-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        currentCategory = card.dataset.category;
        loadProducts();
    });
});

// ===== Search =====
let searchTimeout;
searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => loadProducts(), 300);
});

// ===== Sort =====
sortSelect.addEventListener('change', (e) => {
    currentSort = e.target.value;
    loadProducts();
});

// ===== Toast =====
let toastTimeout;
function showToast(message) {
    toastMessage.textContent = message;
    toast.classList.add('active');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.classList.remove('active');
    }, 2500);
}

// ===== Countdown Timer =====
function updateCountdown() {
    const now = new Date();
    const end = new Date(now);
    end.setDate(end.getDate() + 3);
    end.setHours(23, 59, 59, 0);

    // Save end date in session so it persists during the session
    if (!window._countdownEnd) {
        const saved = sessionStorage.getItem('countdownEnd');
        if (saved) {
            window._countdownEnd = new Date(saved);
        } else {
            window._countdownEnd = end;
            sessionStorage.setItem('countdownEnd', end.toISOString());
        }
    }

    const diff = window._countdownEnd - now;

    if (diff <= 0) {
        sessionStorage.removeItem('countdownEnd');
        window._countdownEnd = null;
        return;
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    document.getElementById('days').textContent = String(days).padStart(2, '0');
    document.getElementById('hours').textContent = String(hours).padStart(2, '0');
    document.getElementById('minutes').textContent = String(minutes).padStart(2, '0');
    document.getElementById('seconds').textContent = String(seconds).padStart(2, '0');
}

setInterval(updateCountdown, 1000);
updateCountdown();

// ===== Newsletter =====
newsletterForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = newsletterForm.querySelector('input').value;
    if (email) {
        showToast('Suscripcion exitosa! Gracias.');
        newsletterForm.reset();
    }
});

// ===== Checkout =====
checkoutBtn.addEventListener('click', () => {
    if (cart.length === 0) return;
    showToast('Redirigiendo al pago...');
    setTimeout(() => {
        cart = [];
        saveCart();
        updateCartUI();
        closeCartFn();
        showToast('Compra realizada con exito!');
    }, 1500);
});

// ===== Active Nav on Scroll =====
const sections = document.querySelectorAll('section[id]');
window.addEventListener('scroll', () => {
    const scrollY = window.scrollY + 100;
    sections.forEach(section => {
        const top = section.offsetTop;
        const height = section.offsetHeight;
        const id = section.getAttribute('id');
        const link = document.querySelector(`.nav-link[href="#${id}"]`);
        if (link) {
            if (scrollY >= top && scrollY < top + height) {
                document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
                link.classList.add('active');
            }
        }
    });
});

// ===== Dark Mode =====
const themeToggle = document.getElementById('themeToggle');
const iconSun = themeToggle.querySelector('.icon-sun');
const iconMoon = themeToggle.querySelector('.icon-moon');

function setTheme(dark) {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    iconSun.style.display = dark ? 'none' : 'block';
    iconMoon.style.display = dark ? 'block' : 'none';
    localStorage.setItem('theme', dark ? 'dark' : 'light');
}

// Load saved theme or detect system preference
const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    setTheme(true);
}

themeToggle.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    setTheme(!isDark);
});

// ===== Auto-refresh: detect DB changes from Python app =====
let lastUpdate = null;
async function checkForUpdates() {
    try {
        const res = await fetch('/api/products/last-update');
        const data = await res.json();
        if (data.success && data.last_update) {
            if (lastUpdate && lastUpdate !== data.last_update) {
                // DB was updated externally (Python app), reload products
                loadProducts();
            }
            lastUpdate = data.last_update;
        }
    } catch (e) {
        // Server not available, ignore
    }
}
setInterval(checkForUpdates, 10000); // Check every 10 seconds

// ===== Init =====
loadProducts();
updateCartUI();
