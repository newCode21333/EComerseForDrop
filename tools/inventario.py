#!/usr/bin/env python3
"""
DropShop - Gestor de Inventario
================================
Aplicacion de consola para gestionar el inventario de la tienda.

Funciones:
  - Ver productos y stock actual
  - Agregar nuevos productos
  - Actualizar stock de productos existentes
  - Importar inventario desde archivo CSV
  - Scraping de precios desde URLs (+ markup automatico del 10%)
  - Exportar inventario a CSV

Uso:
  python inventario.py --url http://localhost:3000

Requiere: pip install -r requirements.txt
"""

import argparse
import csv
import json
import os
import sys
import time
from getpass import getpass

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("Error: Instala las dependencias primero:")
    print("  pip install -r requirements.txt")
    sys.exit(1)


class DropShopClient:
    """Cliente API para el servidor DropShop."""

    def __init__(self, base_url):
        self.base_url = base_url.rstrip('/')
        self.session = requests.Session()
        self.logged_in = False

    def login(self, email, password):
        """Iniciar sesion como admin."""
        resp = self.session.post(f"{self.base_url}/api/auth/login", json={
            "email": email,
            "password": password
        })
        data = resp.json()
        if data.get("success"):
            user = data["user"]
            if user["role"] != "admin":
                print(f"Error: Solo administradores pueden usar esta herramienta.")
                print(f"       Tu rol es: {user['role']}")
                return False
            self.logged_in = True
            print(f"Sesion iniciada como: {user['name']} ({user['email']})")
            return True
        else:
            print(f"Error de login: {data.get('message', 'Desconocido')}")
            return False

    def get_products(self):
        """Obtener todos los productos."""
        resp = self.session.get(f"{self.base_url}/api/products")
        data = resp.json()
        return data.get("products", [])

    def create_product(self, product):
        """Crear un producto nuevo."""
        resp = self.session.post(f"{self.base_url}/api/products", json=product)
        return resp.json()

    def update_product(self, product_id, updates):
        """Actualizar un producto."""
        resp = self.session.put(f"{self.base_url}/api/products/{product_id}", json=updates)
        return resp.json()

    def bulk_stock(self, updates):
        """Actualizar stock en masa."""
        resp = self.session.post(f"{self.base_url}/api/products/bulk-stock", json={"updates": updates})
        return resp.json()

    def bulk_import(self, products):
        """Importar productos en masa."""
        resp = self.session.post(f"{self.base_url}/api/products/bulk-import", json={"products": products})
        return resp.json()


def clear_screen():
    os.system('cls' if os.name == 'nt' else 'clear')


def print_header(title):
    print()
    print("=" * 60)
    print(f"  {title}")
    print("=" * 60)


def print_table(headers, rows, widths=None):
    """Imprimir tabla formateada."""
    if not widths:
        widths = [max(len(str(h)), max((len(str(r[i])) for r in rows), default=0)) + 2
                  for i, h in enumerate(headers)]

    # Header
    header_line = ""
    for i, h in enumerate(headers):
        header_line += str(h).ljust(widths[i])
    print(f"\n  {header_line}")
    print("  " + "-" * sum(widths))

    # Rows
    for row in rows:
        line = ""
        for i, cell in enumerate(row):
            line += str(cell).ljust(widths[i])
        print(f"  {line}")

    print()


def scrape_price(url):
    """
    Intenta extraer el precio de una URL.
    Busca patrones comunes de precio en paginas de ecommerce.
    """
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }

    try:
        print(f"  Obteniendo precio de: {url}")
        resp = requests.get(url, headers=headers, timeout=10)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, 'html.parser')

        # Estrategias comunes para extraer precios
        price = None

        # 1. Meta tags (Open Graph, Schema.org)
        meta_price = soup.find('meta', {'property': 'product:price:amount'})
        if meta_price:
            price = meta_price.get('content')

        # 2. Schema.org JSON-LD
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

        # 3. Selectores CSS comunes
        if not price:
            selectors = [
                '.price', '.product-price', '#price', '.current-price',
                '[data-price]', '.offer-price', '.sale-price',
                'span.price', '.price-current', '.a-price .a-offscreen',
                '[itemprop="price"]'
            ]
            for sel in selectors:
                el = soup.select_one(sel)
                if el:
                    text = el.get_text(strip=True)
                    # Extraer numero del texto
                    import re
                    match = re.search(r'[\d,.]+', text.replace(',', ''))
                    if match:
                        price = match.group()
                        break

        if price:
            # Limpiar y convertir
            price_str = str(price).replace(',', '.').replace('$', '').replace('€', '').strip()
            return float(price_str)
        else:
            print("  No se pudo extraer el precio automaticamente.")
            return None

    except requests.RequestException as e:
        print(f"  Error al acceder a la URL: {e}")
        return None


# ===== Menu Functions =====

def menu_ver_productos(client):
    """Ver todos los productos con su stock."""
    products = client.get_products()

    if not products:
        print("\n  No hay productos en la base de datos.")
        return

    print_header(f"INVENTARIO ({len(products)} productos)")

    rows = []
    for p in products:
        status_icon = {
            "en_stock": "✅",
            "a_pedido": "📦",
            "agotado": "❌"
        }.get(p["stock_status"], "?")

        rows.append([
            p["id"],
            p["sku"] or "-",
            p["name"][:30],
            p["category"],
            f"${p['source_price']:.2f}" if p.get("source_price") else "-",
            f"${p['price']:.2f}",
            p["stock"],
            f"{status_icon} {p['stock_status']}"
        ])

    print_table(
        ["ID", "SKU", "Nombre", "Categoria", "Costo", "Precio", "Stock", "Estado"],
        rows,
        [5, 12, 32, 14, 10, 10, 7, 16]
    )


def menu_agregar_producto(client):
    """Agregar un producto nuevo (con opcion de scraping)."""
    print_header("AGREGAR PRODUCTO")

    name = input("  Nombre: ").strip()
    if not name:
        print("  Cancelado.")
        return

    category = input("  Categoria (electronica/ropa/hogar/deportes/accesorios): ").strip()
    sku = input("  SKU (codigo unico, opcional): ").strip() or None
    description = input("  Descripcion (opcional): ").strip() or None
    image = input("  Emoji/imagen (default: 📦): ").strip() or "📦"

    # Precio: manual o scraping
    source_url = input("  URL de origen para scraping (Enter para manual): ").strip()
    source_price = None
    source_name = None

    if source_url:
        source_name = input("  Nombre del proveedor: ").strip() or None
        source_price = scrape_price(source_url)
        if source_price:
            print(f"  Precio encontrado: ${source_price:.2f}")
            confirm = input("  Usar este precio? (S/n): ").strip().lower()
            if confirm == 'n':
                source_price = None

    if not source_price:
        try:
            source_price = float(input("  Precio de costo (proveedor): $"))
        except ValueError:
            print("  Precio invalido. Cancelado.")
            return

    # Markup
    markup_input = input("  Markup/margen (default 1.10 = +10%): ").strip()
    markup = float(markup_input) if markup_input else 1.10
    final_price = round(source_price * markup, 2)
    print(f"  Precio de venta calculado: ${final_price:.2f}")

    # Old price (precio tachado)
    old_price_input = input("  Precio anterior/tachado (Enter para ninguno): $").strip()
    old_price = float(old_price_input) if old_price_input else None

    # Stock
    try:
        stock = int(input("  Cantidad en stock (0 = a pedido): "))
    except ValueError:
        stock = 0

    stock_status = "en_stock" if stock > 0 else "a_pedido"
    if stock == 0:
        status_choice = input("  Estado: (1) A pedido  (2) Agotado  [1]: ").strip()
        if status_choice == "2":
            stock_status = "agotado"

    badge = input("  Badge (new, -20%, etc. o Enter): ").strip() or None

    product = {
        "name": name,
        "category": category,
        "source_price": source_price,
        "markup": markup,
        "old_price": old_price,
        "image": image,
        "stock": stock,
        "stock_status": stock_status,
        "source_url": source_url or None,
        "source_name": source_name,
        "sku": sku,
        "description": description,
        "badge": badge
    }

    result = client.create_product(product)
    if result.get("success"):
        p = result["product"]
        print(f"\n  Producto creado exitosamente!")
        print(f"  ID: {p['id']} | SKU: {p.get('sku', '-')} | Precio: ${p['price']:.2f}")
    else:
        print(f"\n  Error: {result.get('message', 'Desconocido')}")


def menu_actualizar_stock(client):
    """Actualizar el stock de productos existentes."""
    print_header("ACTUALIZAR STOCK")

    products = client.get_products()
    if not products:
        print("  No hay productos.")
        return

    # Mostrar lista resumida
    for p in products:
        print(f"  [{p['id']}] {p['sku'] or '-':<12} {p['name'][:30]:<32} Stock: {p['stock']}")

    print()
    ids = input("  IDs a actualizar (separados por coma, o 'all'): ").strip()

    if ids.lower() == 'all':
        targets = products
    else:
        try:
            id_list = [int(x.strip()) for x in ids.split(',')]
            targets = [p for p in products if p['id'] in id_list]
        except ValueError:
            print("  IDs invalidos.")
            return

    updates = []
    for p in targets:
        try:
            new_stock = input(f"  {p['name'][:30]} (actual: {p['stock']}): ").strip()
            if new_stock == '':
                continue
            new_stock = int(new_stock)
            if p.get('sku'):
                updates.append({
                    "sku": p['sku'],
                    "stock": new_stock,
                    "notes": "Actualizado desde inventario.py"
                })
            else:
                # Update individually if no SKU
                result = client.update_product(p['id'], {"stock": new_stock})
                if result.get("success"):
                    print(f"    Actualizado: {p['name']} -> {new_stock}")
        except ValueError:
            print(f"    Valor invalido, omitido.")

    if updates:
        result = client.bulk_stock(updates)
        if result.get("success"):
            r = result["results"]
            print(f"\n  Resultado: {r['updated']} actualizados, {r['not_found']} no encontrados")
            if r.get("errors"):
                for err in r["errors"]:
                    print(f"    - {err}")
        else:
            print(f"  Error: {result.get('message')}")


def menu_scraping_precios(client):
    """Scraping de precios desde URL y actualizar productos."""
    print_header("SCRAPING DE PRECIOS")

    products = client.get_products()
    products_with_url = [p for p in products if p.get('source_url')]

    if products_with_url:
        print(f"\n  {len(products_with_url)} productos tienen URL de origen.")
        update_all = input("  Actualizar precios de todos? (s/N): ").strip().lower()

        if update_all == 's':
            for p in products_with_url:
                print(f"\n  [{p['id']}] {p['name']}")
                new_price = scrape_price(p['source_url'])
                if new_price and new_price != p.get('source_price'):
                    final = round(new_price * p.get('markup', 1.10), 2)
                    print(f"  Precio anterior: ${p['source_price']:.2f} -> Nuevo: ${new_price:.2f}")
                    print(f"  Precio de venta: ${p['price']:.2f} -> Nuevo: ${final:.2f}")

                    result = client.update_product(p['id'], {"source_price": new_price})
                    if result.get("success"):
                        print(f"  Actualizado!")
                    else:
                        print(f"  Error al actualizar.")
                elif new_price:
                    print(f"  Precio sin cambios: ${new_price:.2f}")
                time.sleep(1)  # Rate limiting
            return

    # Manual scraping
    url = input("\n  URL para scraping: ").strip()
    if not url:
        return

    price = scrape_price(url)
    if price:
        markup = float(input("  Markup (default 1.10): ").strip() or "1.10")
        final = round(price * markup, 2)
        print(f"\n  Precio encontrado: ${price:.2f}")
        print(f"  Precio de venta (+{int((markup-1)*100)}%): ${final:.2f}")

        apply = input("  Aplicar a un producto existente? (ID o Enter para nuevo): ").strip()
        if apply:
            try:
                pid = int(apply)
                result = client.update_product(pid, {
                    "source_price": price,
                    "markup": markup,
                    "source_url": url
                })
                if result.get("success"):
                    print(f"  Producto {pid} actualizado a ${result['product']['price']:.2f}")
            except ValueError:
                print("  ID invalido.")


def menu_importar_csv(client):
    """Importar productos desde un archivo CSV."""
    print_header("IMPORTAR DESDE CSV")
    print("""
  Formato del CSV (con cabeceras):
  name,category,source_price,markup,stock,sku,image,description,source_url,old_price,badge

  Ejemplo:
  Producto X,electronica,45.00,1.10,20,ELEC-100,📱,Descripcion,,59.99,new
    """)

    filepath = input("  Ruta del archivo CSV: ").strip()
    if not filepath or not os.path.exists(filepath):
        print("  Archivo no encontrado.")
        return

    products = []
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                product = {
                    "name": row.get("name", "").strip(),
                    "category": row.get("category", "").strip(),
                    "source_price": float(row.get("source_price", 0)),
                    "markup": float(row.get("markup", 1.10) or 1.10),
                    "stock": int(row.get("stock", 0) or 0),
                    "sku": row.get("sku", "").strip() or None,
                    "image": row.get("image", "📦").strip() or "📦",
                    "description": row.get("description", "").strip() or None,
                    "source_url": row.get("source_url", "").strip() or None,
                    "old_price": float(row["old_price"]) if row.get("old_price") else None,
                    "badge": row.get("badge", "").strip() or None
                }
                if product["name"] and product["category"] and product["source_price"]:
                    products.append(product)

        print(f"  {len(products)} productos encontrados en el CSV.")
        confirm = input("  Importar? (s/N): ").strip().lower()

        if confirm == 's':
            result = client.bulk_import(products)
            if result.get("success"):
                r = result["results"]
                print(f"\n  Resultado:")
                print(f"    Creados: {r['created']}")
                print(f"    Actualizados: {r['updated']}")
                if r.get("errors"):
                    print(f"    Errores: {len(r['errors'])}")
                    for err in r["errors"][:5]:
                        print(f"      - {err}")
            else:
                print(f"  Error: {result.get('message')}")
    except Exception as e:
        print(f"  Error leyendo CSV: {e}")


def menu_exportar_csv(client):
    """Exportar inventario a CSV."""
    print_header("EXPORTAR A CSV")

    products = client.get_products()
    if not products:
        print("  No hay productos para exportar.")
        return

    filepath = input("  Ruta de salida (default: inventario_export.csv): ").strip()
    if not filepath:
        filepath = "inventario_export.csv"

    try:
        fields = ["id", "sku", "name", "category", "source_price", "price", "markup",
                   "old_price", "stock", "stock_status", "image", "description",
                   "source_url", "source_name", "badge", "rating", "reviews"]

        with open(filepath, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=fields)
            writer.writeheader()
            for p in products:
                row = {k: p.get(k, '') for k in fields}
                writer.writerow(row)

        print(f"\n  Exportado: {filepath} ({len(products)} productos)")
    except Exception as e:
        print(f"  Error: {e}")


def main():
    parser = argparse.ArgumentParser(description='DropShop - Gestor de Inventario')
    parser.add_argument('--url', default='http://localhost:3000',
                        help='URL del servidor DropShop (default: http://localhost:3000)')
    parser.add_argument('--email', help='Email del admin')
    parser.add_argument('--password', help='Password del admin')
    args = parser.parse_args()

    clear_screen()
    print()
    print("  ╔══════════════════════════════════════════╗")
    print("  ║    DropShop - Gestor de Inventario       ║")
    print("  ╚══════════════════════════════════════════╝")
    print(f"\n  Servidor: {args.url}")

    # Test connection
    try:
        resp = requests.get(f"{args.url}/api/products", timeout=5)
        if resp.status_code != 200:
            raise Exception(f"Status {resp.status_code}")
        print("  Conexion: OK")
    except Exception as e:
        print(f"\n  Error: No se puede conectar al servidor en {args.url}")
        print(f"  Asegurate de ejecutar 'npm start' primero.")
        print(f"  Detalle: {e}")
        sys.exit(1)

    # Login
    client = DropShopClient(args.url)
    print()
    email = args.email or input("  Email admin: ").strip()
    password = args.password or getpass("  Password: ")

    if not client.login(email, password):
        sys.exit(1)

    # Main loop
    while True:
        print()
        print("  ┌─────────────────────────────────────┐")
        print("  │          MENU PRINCIPAL              │")
        print("  ├─────────────────────────────────────┤")
        print("  │  1. Ver inventario                   │")
        print("  │  2. Agregar producto                 │")
        print("  │  3. Actualizar stock                 │")
        print("  │  4. Scraping de precios              │")
        print("  │  5. Importar desde CSV               │")
        print("  │  6. Exportar a CSV                   │")
        print("  │  0. Salir                            │")
        print("  └─────────────────────────────────────┘")

        choice = input("\n  Opcion: ").strip()

        if choice == '1':
            menu_ver_productos(client)
        elif choice == '2':
            menu_agregar_producto(client)
        elif choice == '3':
            menu_actualizar_stock(client)
        elif choice == '4':
            menu_scraping_precios(client)
        elif choice == '5':
            menu_importar_csv(client)
        elif choice == '6':
            menu_exportar_csv(client)
        elif choice == '0':
            print("\n  Hasta luego!")
            break
        else:
            print("  Opcion no valida.")


if __name__ == '__main__':
    main()
