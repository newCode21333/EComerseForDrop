#!/usr/bin/env python3
"""
DropShop Manager - Aplicacion de Escritorio
=============================================
Gestiona inventario, productos, stock y precios.
Se conecta directamente a la base de datos SQLite.
Los cambios se reflejan al instante en la pagina web.

Uso:
  python dropshop_manager.py

  O si la base de datos esta en otra ruta:
  python dropshop_manager.py --db /ruta/a/dropshop.db

Requisitos: Python 3.8+ (tkinter viene incluido)
Para scraping: pip install requests beautifulsoup4
"""

import sqlite3
import os
import sys
import csv
import json
import math
import re
import tkinter as tk
from tkinter import ttk, messagebox, filedialog, simpledialog
from datetime import datetime
from pathlib import Path
import argparse

# Ruta por defecto a la base de datos
DEFAULT_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'database', 'dropshop.db')

# Intentar importar requests para scraping (opcional)
try:
    import requests
    from bs4 import BeautifulSoup
    HAS_SCRAPING = True
except ImportError:
    HAS_SCRAPING = False


class Database:
    """Conexion directa a SQLite."""

    def __init__(self, db_path):
        self.db_path = db_path
        self.conn = None

    def connect(self):
        if not os.path.exists(self.db_path):
            raise FileNotFoundError(
                f"Base de datos no encontrada: {self.db_path}\n"
                f"Ejecuta 'npm start' primero para crear la BD."
            )
        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")

    def close(self):
        if self.conn:
            self.conn.close()

    def execute(self, sql, params=()):
        return self.conn.execute(sql, params)

    def executemany(self, sql, params_list):
        return self.conn.executemany(sql, params_list)

    def commit(self):
        self.conn.commit()

    def get_products(self, active_only=True):
        sql = "SELECT * FROM products"
        if active_only:
            sql += " WHERE active = 1"
        sql += " ORDER BY id"
        return self.execute(sql).fetchall()

    def get_product(self, product_id):
        return self.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()

    def get_product_by_sku(self, sku):
        return self.execute("SELECT * FROM products WHERE sku = ?", (sku,)).fetchone()

    def add_product(self, data):
        source_price = data['source_price']
        markup = data.get('markup', 1.10)
        price = round(source_price * markup, 2)
        stock = data.get('stock', 0)
        stock_status = 'en_stock' if stock > 0 else data.get('stock_status', 'a_pedido')

        cursor = self.execute("""
            INSERT INTO products (name, category, price, source_price, markup, old_price,
                image, rating, reviews, badge, stock, stock_status, source_url, source_name,
                sku, description, active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        """, (
            data['name'], data['category'], price, source_price, markup,
            data.get('old_price'), data.get('image', '📦'),
            data.get('rating', 0), data.get('reviews', 0),
            data.get('badge'), stock, stock_status,
            data.get('source_url'), data.get('source_name'),
            data.get('sku'), data.get('description')
        ))
        self.commit()

        # Log stock
        if stock > 0:
            self.log_stock(cursor.lastrowid, 0, stock, 'manual', 'Producto creado desde app')

        return cursor.lastrowid

    def update_product(self, product_id, data):
        product = self.get_product(product_id)
        if not product:
            return False

        # Recalculate price
        source_price = data.get('source_price', product['source_price'])
        markup = data.get('markup', product['markup'])
        price = round(source_price * markup, 2)

        # Auto stock status
        new_stock = data.get('stock', product['stock'])
        if 'stock_status' in data:
            stock_status = data['stock_status']
        elif new_stock > 0:
            stock_status = 'en_stock'
        elif new_stock == 0 and product['stock_status'] == 'agotado':
            stock_status = 'agotado'
        else:
            stock_status = 'a_pedido'

        self.execute("""
            UPDATE products SET
                name=?, category=?, price=?, source_price=?, markup=?, old_price=?,
                image=?, rating=?, reviews=?, badge=?, stock=?, stock_status=?,
                source_url=?, source_name=?, sku=?, description=?,
                active=?, updated_at=datetime('now')
            WHERE id=?
        """, (
            data.get('name', product['name']),
            data.get('category', product['category']),
            price, source_price, markup,
            data.get('old_price', product['old_price']),
            data.get('image', product['image']),
            data.get('rating', product['rating']),
            data.get('reviews', product['reviews']),
            data.get('badge', product['badge']),
            new_stock, stock_status,
            data.get('source_url', product['source_url']),
            data.get('source_name', product['source_name']),
            data.get('sku', product['sku']),
            data.get('description', product['description']),
            data.get('active', product['active']),
            product_id
        ))
        self.commit()

        # Log stock change
        if new_stock != product['stock']:
            self.log_stock(product_id, product['stock'], new_stock, 'manual', 'Editado desde app')

        return True

    def delete_product(self, product_id):
        self.execute("UPDATE products SET active = 0, updated_at = datetime('now') WHERE id = ?", (product_id,))
        self.commit()

    def restore_product(self, product_id):
        self.execute("UPDATE products SET active = 1, updated_at = datetime('now') WHERE id = ?", (product_id,))
        self.commit()

    def update_stock(self, product_id, new_stock, notes=''):
        product = self.get_product(product_id)
        if not product:
            return False

        stock_status = 'en_stock' if new_stock > 0 else 'a_pedido'
        self.execute(
            "UPDATE products SET stock=?, stock_status=?, updated_at=datetime('now') WHERE id=?",
            (new_stock, stock_status, product_id)
        )
        self.log_stock(product_id, product['stock'], new_stock, 'manual', notes or 'App desktop')
        self.commit()
        return True

    def log_stock(self, product_id, prev, new, change_type, notes):
        self.execute(
            "INSERT INTO stock_log (product_id, previous_stock, new_stock, change_type, notes) VALUES (?,?,?,?,?)",
            (product_id, prev, new, change_type, notes)
        )

    def get_stock_log(self, product_id, limit=20):
        return self.execute(
            "SELECT * FROM stock_log WHERE product_id=? ORDER BY created_at DESC LIMIT ?",
            (product_id, limit)
        ).fetchall()

    def get_categories(self):
        rows = self.execute("SELECT DISTINCT category FROM products WHERE active=1 ORDER BY category").fetchall()
        return [r['category'] for r in rows]

    def get_stats(self):
        total = self.execute("SELECT COUNT(*) as c FROM products WHERE active=1").fetchone()['c']
        in_stock = self.execute("SELECT COUNT(*) as c FROM products WHERE active=1 AND stock_status='en_stock'").fetchone()['c']
        on_order = self.execute("SELECT COUNT(*) as c FROM products WHERE active=1 AND stock_status='a_pedido'").fetchone()['c']
        out = self.execute("SELECT COUNT(*) as c FROM products WHERE active=1 AND stock_status='agotado'").fetchone()['c']
        total_value = self.execute("SELECT COALESCE(SUM(price * stock), 0) as v FROM products WHERE active=1").fetchone()['v']
        total_items = self.execute("SELECT COALESCE(SUM(stock), 0) as s FROM products WHERE active=1").fetchone()['s']
        return {
            'total': total, 'in_stock': in_stock, 'on_order': on_order,
            'out_of_stock': out, 'total_value': total_value, 'total_items': total_items
        }

    def import_csv(self, filepath):
        results = {'created': 0, 'updated': 0, 'errors': []}
        with open(filepath, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    data = {
                        'name': row.get('name', '').strip(),
                        'category': row.get('category', '').strip(),
                        'source_price': float(row.get('source_price', 0)),
                        'markup': float(row.get('markup', 1.10) or 1.10),
                        'stock': int(row.get('stock', 0) or 0),
                        'sku': row.get('sku', '').strip() or None,
                        'image': row.get('image', '📦').strip() or '📦',
                        'description': row.get('description', '').strip() or None,
                        'source_url': row.get('source_url', '').strip() or None,
                        'old_price': float(row['old_price']) if row.get('old_price') else None,
                        'badge': row.get('badge', '').strip() or None,
                        'rating': float(row.get('rating', 0) or 0),
                        'reviews': int(row.get('reviews', 0) or 0),
                    }

                    if not data['name'] or not data['category'] or not data['source_price']:
                        results['errors'].append(f"Datos incompletos: {row.get('name', '?')}")
                        continue

                    # Update if SKU exists
                    if data['sku']:
                        existing = self.get_product_by_sku(data['sku'])
                        if existing:
                            self.update_product(existing['id'], data)
                            results['updated'] += 1
                            continue

                    self.add_product(data)
                    results['created'] += 1
                except Exception as e:
                    results['errors'].append(f"{row.get('name', '?')}: {str(e)}")

        return results

    def export_csv(self, filepath):
        products = self.get_products(active_only=False)
        fields = ['id', 'sku', 'name', 'category', 'source_price', 'price', 'markup',
                   'old_price', 'stock', 'stock_status', 'image', 'description',
                   'source_url', 'source_name', 'badge', 'rating', 'reviews', 'active']

        with open(filepath, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=fields)
            writer.writeheader()
            for p in products:
                writer.writerow({k: p[k] for k in fields})

        return len(products)


def scrape_price(url):
    """Extraer precio de una URL de ecommerce."""
    if not HAS_SCRAPING:
        return None

    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

    try:
        resp = requests.get(url, headers=headers, timeout=10)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, 'html.parser')
        price = None

        # Meta tags
        meta = soup.find('meta', {'property': 'product:price:amount'})
        if meta:
            price = meta.get('content')

        # JSON-LD
        if not price:
            for script in soup.find_all('script', type='application/ld+json'):
                try:
                    data = json.loads(script.string)
                    if isinstance(data, list):
                        data = data[0]
                    if 'offers' in data:
                        offers = data['offers']
                        if isinstance(offers, list):
                            offers = offers[0]
                        price = offers.get('price')
                    elif 'price' in data:
                        price = data['price']
                except (json.JSONDecodeError, KeyError, TypeError):
                    continue

        # CSS selectors
        if not price:
            for sel in ['.price', '.product-price', '#price', '.current-price',
                        '[data-price]', '.sale-price', '[itemprop="price"]',
                        'span.price', '.a-price .a-offscreen']:
                el = soup.select_one(sel)
                if el:
                    text = el.get_text(strip=True)
                    match = re.search(r'[\d,.]+', text.replace(',', ''))
                    if match:
                        price = match.group()
                        break

        if price:
            return float(str(price).replace(',', '.').replace('$', '').replace('€', '').strip())
    except Exception:
        pass
    return None


# ============================================================
# GUI APPLICATION
# ============================================================

class DropShopApp:
    """Aplicacion principal con interfaz grafica."""

    CATEGORIES = ['electronica', 'ropa', 'hogar', 'deportes', 'accesorios']
    STATUS_OPTIONS = ['en_stock', 'a_pedido', 'agotado']

    def __init__(self, db_path):
        self.db = Database(db_path)
        self.db.connect()

        self.root = tk.Tk()
        self.root.title("DropShop Manager - Gestor de Inventario")
        self.root.geometry("1100x700")
        self.root.minsize(900, 600)

        # Style
        self.style = ttk.Style()
        self.style.theme_use('clam')
        self.style.configure('Title.TLabel', font=('Helvetica', 14, 'bold'))
        self.style.configure('Stat.TLabel', font=('Helvetica', 20, 'bold'), foreground='#6c5ce7')
        self.style.configure('StatLabel.TLabel', font=('Helvetica', 9), foreground='#636e72')
        self.style.configure('Treeview', rowheight=28, font=('Helvetica', 9))
        self.style.configure('Treeview.Heading', font=('Helvetica', 9, 'bold'))
        self.style.configure('Green.TButton', foreground='#00b894')
        self.style.configure('Red.TButton', foreground='#d63031')

        self.build_ui()
        self.refresh_all()

    def build_ui(self):
        """Construir la interfaz."""
        # Top bar
        topbar = ttk.Frame(self.root, padding=10)
        topbar.pack(fill='x')

        ttk.Label(topbar, text="DropShop Manager", style='Title.TLabel').pack(side='left')

        btn_frame = ttk.Frame(topbar)
        btn_frame.pack(side='right')

        ttk.Button(btn_frame, text="Refrescar", command=self.refresh_all).pack(side='left', padx=2)
        ttk.Button(btn_frame, text="Importar CSV", command=self.import_csv).pack(side='left', padx=2)
        ttk.Button(btn_frame, text="Exportar CSV", command=self.export_csv).pack(side='left', padx=2)

        # Stats bar
        self.stats_frame = ttk.Frame(self.root, padding=(10, 5))
        self.stats_frame.pack(fill='x')
        self.stat_labels = {}
        for key, label in [('total', 'Productos'), ('in_stock', 'En Stock'),
                           ('on_order', 'A Pedido'), ('out_of_stock', 'Agotado'),
                           ('total_items', 'Unidades'), ('total_value', 'Valor Total')]:
            f = ttk.Frame(self.stats_frame, padding=8)
            f.pack(side='left', padx=5, expand=True, fill='x')
            val_label = ttk.Label(f, text="0", style='Stat.TLabel')
            val_label.pack()
            ttk.Label(f, text=label, style='StatLabel.TLabel').pack()
            self.stat_labels[key] = val_label

        ttk.Separator(self.root).pack(fill='x', padx=10, pady=5)

        # Filter bar
        filter_frame = ttk.Frame(self.root, padding=(10, 5))
        filter_frame.pack(fill='x')

        ttk.Label(filter_frame, text="Buscar:").pack(side='left')
        self.search_var = tk.StringVar()
        self.search_var.trace_add('write', lambda *a: self.refresh_table())
        search_entry = ttk.Entry(filter_frame, textvariable=self.search_var, width=25)
        search_entry.pack(side='left', padx=5)

        ttk.Label(filter_frame, text="Categoria:").pack(side='left', padx=(15, 0))
        self.cat_var = tk.StringVar(value='Todas')
        cat_combo = ttk.Combobox(filter_frame, textvariable=self.cat_var,
                                 values=['Todas'] + self.CATEGORIES, width=15, state='readonly')
        cat_combo.pack(side='left', padx=5)
        cat_combo.bind('<<ComboboxSelected>>', lambda e: self.refresh_table())

        ttk.Label(filter_frame, text="Estado:").pack(side='left', padx=(15, 0))
        self.status_var = tk.StringVar(value='Todos')
        status_combo = ttk.Combobox(filter_frame, textvariable=self.status_var,
                                    values=['Todos'] + self.STATUS_OPTIONS, width=12, state='readonly')
        status_combo.pack(side='left', padx=5)
        status_combo.bind('<<ComboboxSelected>>', lambda e: self.refresh_table())

        # Action buttons
        action_frame = ttk.Frame(self.root, padding=(10, 5))
        action_frame.pack(fill='x')

        ttk.Button(action_frame, text="+ Agregar Producto", command=self.add_product).pack(side='left', padx=2)
        ttk.Button(action_frame, text="Editar", command=self.edit_product).pack(side='left', padx=2)
        ttk.Button(action_frame, text="Cambiar Stock", command=self.change_stock).pack(side='left', padx=2)
        ttk.Button(action_frame, text="Scraping Precio", command=self.scrape_product).pack(side='left', padx=2)
        ttk.Button(action_frame, text="Eliminar", command=self.delete_product).pack(side='left', padx=2)
        ttk.Button(action_frame, text="Ver Log Stock", command=self.view_stock_log).pack(side='left', padx=2)

        # Products table
        table_frame = ttk.Frame(self.root, padding=10)
        table_frame.pack(fill='both', expand=True)

        columns = ('id', 'sku', 'nombre', 'categoria', 'costo', 'precio', 'markup', 'stock', 'estado', 'actualizado')
        self.tree = ttk.Treeview(table_frame, columns=columns, show='headings', selectmode='browse')

        # Column config
        col_config = {
            'id': ('ID', 40), 'sku': ('SKU', 90), 'nombre': ('Nombre', 220),
            'categoria': ('Categoria', 90), 'costo': ('Costo', 75), 'precio': ('Precio', 75),
            'markup': ('Markup', 60), 'stock': ('Stock', 55), 'estado': ('Estado', 80),
            'actualizado': ('Actualizado', 130)
        }
        for col, (heading, width) in col_config.items():
            self.tree.heading(col, text=heading, command=lambda c=col: self.sort_column(c))
            self.tree.column(col, width=width, minwidth=40)

        # Scrollbar
        scrollbar = ttk.Scrollbar(table_frame, orient='vertical', command=self.tree.yview)
        self.tree.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side='right', fill='y')
        self.tree.pack(fill='both', expand=True)

        # Double-click to edit
        self.tree.bind('<Double-1>', lambda e: self.edit_product())

        # Status bar
        self.statusbar = ttk.Label(self.root, text="Conectado a la base de datos", padding=5, relief='sunken')
        self.statusbar.pack(fill='x', side='bottom')

        self.sort_col = 'id'
        self.sort_reverse = False

    def set_status(self, text):
        self.statusbar.config(text=text)
        self.root.update_idletasks()

    def refresh_all(self):
        """Refrescar estadisticas y tabla."""
        self.refresh_stats()
        self.refresh_table()
        self.set_status(f"Actualizado: {datetime.now().strftime('%H:%M:%S')}")

    def refresh_stats(self):
        stats = self.db.get_stats()
        self.stat_labels['total'].config(text=str(stats['total']))
        self.stat_labels['in_stock'].config(text=str(stats['in_stock']))
        self.stat_labels['on_order'].config(text=str(stats['on_order']))
        self.stat_labels['out_of_stock'].config(text=str(stats['out_of_stock']))
        self.stat_labels['total_items'].config(text=str(stats['total_items']))
        self.stat_labels['total_value'].config(text=f"${stats['total_value']:,.2f}")

    def refresh_table(self):
        """Refrescar tabla de productos."""
        for item in self.tree.get_children():
            self.tree.delete(item)

        products = self.db.get_products(active_only=True)
        search = self.search_var.get().lower()
        cat_filter = self.cat_var.get()
        status_filter = self.status_var.get()

        for p in products:
            # Filters
            if search and search not in p['name'].lower() and search not in (p['sku'] or '').lower():
                continue
            if cat_filter != 'Todas' and p['category'] != cat_filter:
                continue
            if status_filter != 'Todos' and p['stock_status'] != status_filter:
                continue

            status_display = {
                'en_stock': 'En Stock',
                'a_pedido': 'A Pedido',
                'agotado': 'Agotado'
            }.get(p['stock_status'], p['stock_status'])

            updated = p['updated_at'] or p['created_at']
            if updated:
                try:
                    updated = datetime.fromisoformat(updated).strftime('%Y-%m-%d %H:%M')
                except (ValueError, TypeError):
                    pass

            self.tree.insert('', 'end', iid=str(p['id']), values=(
                p['id'],
                p['sku'] or '-',
                p['name'],
                p['category'],
                f"${p['source_price']:.2f}" if p['source_price'] else '-',
                f"${p['price']:.2f}",
                f"x{p['markup']:.2f}",
                p['stock'],
                status_display,
                updated or '-'
            ))

            # Color by status
            if p['stock_status'] == 'agotado':
                self.tree.item(str(p['id']), tags=('agotado',))
            elif p['stock_status'] == 'a_pedido':
                self.tree.item(str(p['id']), tags=('a_pedido',))

        self.tree.tag_configure('agotado', foreground='#d63031')
        self.tree.tag_configure('a_pedido', foreground='#e17055')

    def sort_column(self, col):
        """Ordenar tabla por columna."""
        if self.sort_col == col:
            self.sort_reverse = not self.sort_reverse
        else:
            self.sort_col = col
            self.sort_reverse = False

        items = [(self.tree.set(k, col), k) for k in self.tree.get_children('')]

        # Try numeric sort
        try:
            items.sort(key=lambda t: float(t[0].replace('$', '').replace('x', '').replace(',', '')),
                       reverse=self.sort_reverse)
        except ValueError:
            items.sort(key=lambda t: t[0].lower(), reverse=self.sort_reverse)

        for i, (_, k) in enumerate(items):
            self.tree.move(k, '', i)

    def get_selected_id(self):
        sel = self.tree.selection()
        if not sel:
            messagebox.showwarning("Aviso", "Selecciona un producto primero.")
            return None
        return int(sel[0])

    # ========== Product Form ==========
    def product_form(self, title, product=None):
        """Ventana de formulario para agregar/editar producto."""
        win = tk.Toplevel(self.root)
        win.title(title)
        win.geometry("520x680")
        win.resizable(False, False)
        win.grab_set()

        canvas = tk.Canvas(win)
        scrollbar = ttk.Scrollbar(win, orient="vertical", command=canvas.yview)
        scroll_frame = ttk.Frame(canvas, padding=15)

        scroll_frame.bind("<Configure>", lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.create_window((0, 0), window=scroll_frame, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)

        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        entries = {}

        def add_field(label, key, default='', width=40, field_type='entry'):
            f = ttk.Frame(scroll_frame)
            f.pack(fill='x', pady=3)
            ttk.Label(f, text=label, width=18, anchor='e').pack(side='left')

            if field_type == 'combo':
                var = tk.StringVar(value=default)
                w = ttk.Combobox(f, textvariable=var, width=width-2, state='readonly')
                if key == 'category':
                    w['values'] = self.CATEGORIES
                elif key == 'stock_status':
                    w['values'] = self.STATUS_OPTIONS
                w.pack(side='left', padx=5)
                entries[key] = var
            elif field_type == 'text':
                w = tk.Text(f, width=width, height=3, font=('Helvetica', 9))
                w.insert('1.0', default or '')
                w.pack(side='left', padx=5)
                entries[key] = w
            else:
                var = tk.StringVar(value=str(default) if default is not None else '')
                w = ttk.Entry(f, textvariable=var, width=width)
                w.pack(side='left', padx=5)
                entries[key] = var

            return w

        p = product or {}

        add_field("Nombre *:", 'name', p.get('name', ''))
        add_field("Categoria *:", 'category', p.get('category', 'electronica'), field_type='combo')
        add_field("SKU:", 'sku', p.get('sku', ''))
        add_field("Precio costo *:", 'source_price', p.get('source_price', ''))
        add_field("Markup:", 'markup', p.get('markup', 1.10))
        add_field("Precio anterior:", 'old_price', p.get('old_price', ''))
        add_field("Imagen (emoji):", 'image', p.get('image', '📦'))
        add_field("Stock:", 'stock', p.get('stock', 0))
        add_field("Estado stock:", 'stock_status', p.get('stock_status', 'a_pedido'), field_type='combo')
        add_field("Rating:", 'rating', p.get('rating', 0))
        add_field("Reviews:", 'reviews', p.get('reviews', 0))
        add_field("Badge:", 'badge', p.get('badge', ''))
        add_field("URL origen:", 'source_url', p.get('source_url', ''))
        add_field("Proveedor:", 'source_name', p.get('source_name', ''))
        add_field("Descripcion:", 'description', p.get('description', ''), field_type='text')

        # Price preview
        preview_frame = ttk.Frame(scroll_frame, padding=(0, 10))
        preview_frame.pack(fill='x')
        price_preview = ttk.Label(preview_frame, text="Precio de venta: -", font=('Helvetica', 11, 'bold'))
        price_preview.pack()

        def update_preview(*args):
            try:
                sp = float(entries['source_price'].get())
                mk = float(entries['markup'].get())
                price_preview.config(text=f"Precio de venta: ${sp * mk:.2f}")
            except (ValueError, TypeError):
                price_preview.config(text="Precio de venta: -")

        entries['source_price'].trace_add('write', update_preview)
        entries['markup'].trace_add('write', update_preview)
        update_preview()

        # Scraping button
        if HAS_SCRAPING:
            def do_scrape():
                url = entries['source_url'].get().strip()
                if not url:
                    messagebox.showwarning("Aviso", "Ingresa una URL primero.")
                    return
                self.set_status("Scrapeando precio...")
                win.update_idletasks()
                price = scrape_price(url)
                if price:
                    entries['source_price'].set(str(price))
                    self.set_status(f"Precio encontrado: ${price:.2f}")
                    messagebox.showinfo("Scraping", f"Precio encontrado: ${price:.2f}")
                else:
                    self.set_status("No se pudo extraer el precio")
                    messagebox.showwarning("Scraping", "No se pudo extraer el precio de esa URL.")

            scrape_btn_frame = ttk.Frame(scroll_frame)
            scrape_btn_frame.pack(fill='x', pady=5)
            ttk.Button(scrape_btn_frame, text="Obtener precio desde URL", command=do_scrape).pack()

        # Result
        result = {'saved': False, 'data': None}

        def save():
            name = entries['name'].get().strip()
            category = entries['category'].get()
            source_price_str = entries['source_price'].get().strip()

            if not name:
                messagebox.showerror("Error", "El nombre es obligatorio.")
                return
            if not category:
                messagebox.showerror("Error", "Selecciona una categoria.")
                return
            if not source_price_str:
                messagebox.showerror("Error", "El precio de costo es obligatorio.")
                return

            try:
                data = {
                    'name': name,
                    'category': category,
                    'source_price': float(source_price_str),
                    'markup': float(entries['markup'].get() or 1.10),
                    'stock': int(entries['stock'].get() or 0),
                    'stock_status': entries['stock_status'].get(),
                    'sku': entries['sku'].get().strip() or None,
                    'image': entries['image'].get().strip() or '📦',
                    'rating': float(entries['rating'].get() or 0),
                    'reviews': int(entries['reviews'].get() or 0),
                    'badge': entries['badge'].get().strip() or None,
                    'source_url': entries['source_url'].get().strip() or None,
                    'source_name': entries['source_name'].get().strip() or None,
                    'description': entries['description'].get('1.0', 'end').strip() or None,
                }

                old_price_str = entries['old_price'].get().strip()
                data['old_price'] = float(old_price_str) if old_price_str else None

                result['saved'] = True
                result['data'] = data
                win.destroy()
            except ValueError as e:
                messagebox.showerror("Error", f"Valor invalido: {e}")

        btn_frame = ttk.Frame(scroll_frame, padding=(0, 10))
        btn_frame.pack(fill='x')
        ttk.Button(btn_frame, text="Cancelar", command=win.destroy).pack(side='right', padx=5)
        ttk.Button(btn_frame, text="Guardar", command=save).pack(side='right', padx=5)

        win.wait_window()
        return result

    # ========== Actions ==========
    def add_product(self):
        result = self.product_form("Agregar Producto")
        if result['saved']:
            pid = self.db.add_product(result['data'])
            self.refresh_all()
            self.set_status(f"Producto creado (ID: {pid})")

    def edit_product(self):
        pid = self.get_selected_id()
        if not pid:
            return
        product = self.db.get_product(pid)
        if not product:
            return

        p_dict = dict(product)
        result = self.product_form(f"Editar: {product['name']}", p_dict)
        if result['saved']:
            self.db.update_product(pid, result['data'])
            self.refresh_all()
            self.set_status(f"Producto actualizado (ID: {pid})")

    def change_stock(self):
        pid = self.get_selected_id()
        if not pid:
            return
        product = self.db.get_product(pid)
        if not product:
            return

        new_stock = simpledialog.askinteger(
            "Cambiar Stock",
            f"{product['name']}\nStock actual: {product['stock']}\n\nNuevo stock:",
            initialvalue=product['stock'],
            minvalue=0,
            parent=self.root
        )

        if new_stock is not None:
            self.db.update_stock(pid, new_stock, 'Cambio desde app desktop')
            self.refresh_all()
            self.set_status(f"Stock actualizado: {product['name']} -> {new_stock}")

    def scrape_product(self):
        if not HAS_SCRAPING:
            messagebox.showinfo("Scraping",
                "Para usar scraping instala:\npip install requests beautifulsoup4")
            return

        pid = self.get_selected_id()
        if pid:
            product = self.db.get_product(pid)
            if product and product['source_url']:
                self.set_status(f"Scrapeando {product['source_url']}...")
                self.root.update_idletasks()
                price = scrape_price(product['source_url'])
                if price:
                    old = product['source_price']
                    self.db.update_product(pid, {'source_price': price})
                    self.refresh_all()
                    self.set_status(f"Precio actualizado: ${old:.2f} -> ${price:.2f}")
                    messagebox.showinfo("Scraping",
                        f"Precio actualizado!\n\nAnterior: ${old:.2f}\nNuevo: ${price:.2f}\n"
                        f"Venta: ${round(price * product['markup'], 2):.2f}")
                else:
                    self.set_status("No se pudo obtener el precio")
                    messagebox.showwarning("Scraping", "No se pudo extraer el precio.")
                return

        # Manual URL scraping
        url = simpledialog.askstring("Scraping", "URL para obtener precio:", parent=self.root)
        if url:
            self.set_status(f"Scrapeando...")
            self.root.update_idletasks()
            price = scrape_price(url)
            if price:
                messagebox.showinfo("Scraping", f"Precio encontrado: ${price:.2f}\n+10% = ${price*1.10:.2f}")
                self.set_status(f"Precio: ${price:.2f}")
            else:
                messagebox.showwarning("Scraping", "No se pudo extraer el precio.")
                self.set_status("Scraping fallido")

    def delete_product(self):
        pid = self.get_selected_id()
        if not pid:
            return
        product = self.db.get_product(pid)
        if not product:
            return

        if messagebox.askyesno("Confirmar", f"Desactivar producto:\n{product['name']}?"):
            self.db.delete_product(pid)
            self.refresh_all()
            self.set_status(f"Producto desactivado: {product['name']}")

    def view_stock_log(self):
        pid = self.get_selected_id()
        if not pid:
            return
        product = self.db.get_product(pid)
        if not product:
            return

        logs = self.db.get_stock_log(pid, limit=30)

        win = tk.Toplevel(self.root)
        win.title(f"Historial Stock: {product['name']}")
        win.geometry("600x400")

        cols = ('fecha', 'anterior', 'nuevo', 'tipo', 'notas')
        tree = ttk.Treeview(win, columns=cols, show='headings')
        tree.heading('fecha', text='Fecha')
        tree.heading('anterior', text='Anterior')
        tree.heading('nuevo', text='Nuevo')
        tree.heading('tipo', text='Tipo')
        tree.heading('notas', text='Notas')
        tree.column('fecha', width=140)
        tree.column('anterior', width=70)
        tree.column('nuevo', width=70)
        tree.column('tipo', width=80)
        tree.column('notas', width=200)

        for log in logs:
            tree.insert('', 'end', values=(
                log['created_at'],
                log['previous_stock'],
                log['new_stock'],
                log['change_type'],
                log['notes'] or ''
            ))

        tree.pack(fill='both', expand=True, padx=10, pady=10)

        if not logs:
            ttk.Label(win, text="No hay historial de stock para este producto.").pack(pady=20)

    def import_csv(self):
        filepath = filedialog.askopenfilename(
            title="Seleccionar CSV",
            filetypes=[("CSV files", "*.csv"), ("All files", "*.*")],
            parent=self.root
        )
        if not filepath:
            return

        self.set_status("Importando CSV...")
        self.root.update_idletasks()

        results = self.db.import_csv(filepath)
        self.refresh_all()

        msg = f"Creados: {results['created']}\nActualizados: {results['updated']}"
        if results['errors']:
            msg += f"\nErrores: {len(results['errors'])}"
            for err in results['errors'][:5]:
                msg += f"\n  - {err}"

        messagebox.showinfo("Importacion CSV", msg)
        self.set_status(f"CSV importado: {results['created']} creados, {results['updated']} actualizados")

    def export_csv(self):
        filepath = filedialog.asksaveasfilename(
            title="Exportar CSV",
            defaultextension=".csv",
            filetypes=[("CSV files", "*.csv")],
            initialfile=f"inventario_{datetime.now().strftime('%Y%m%d')}.csv",
            parent=self.root
        )
        if not filepath:
            return

        count = self.db.export_csv(filepath)
        messagebox.showinfo("Exportacion", f"{count} productos exportados a:\n{filepath}")
        self.set_status(f"Exportado: {filepath}")

    def run(self):
        self.root.mainloop()
        self.db.close()


def main():
    parser = argparse.ArgumentParser(description='DropShop Manager - Gestor de Inventario')
    parser.add_argument('--db', default=DEFAULT_DB,
                        help=f'Ruta a dropshop.db (default: {DEFAULT_DB})')
    args = parser.parse_args()

    db_path = os.path.abspath(args.db)

    if not os.path.exists(db_path):
        print(f"Error: Base de datos no encontrada en: {db_path}")
        print(f"Ejecuta 'npm start' en el directorio del proyecto primero.")
        print(f"Esto creara la base de datos automaticamente.")
        sys.exit(1)

    print(f"Conectando a: {db_path}")
    app = DropShopApp(db_path)
    app.run()


if __name__ == '__main__':
    main()
