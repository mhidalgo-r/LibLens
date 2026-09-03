# LibLens

Visualizador interactivo de librerías instaladas en tu sistema. Escaneo Homebrew, Node.js, Python, Ruby gems, Composer y más, mostrando el resultado como un grafo jerárquico tipo organigrama.

---

## 📁 Estructura del proyecto

```
LibLens/
├── package.json
├── server.js          # Express + Socket.IO + descubrimiento de paquetes
└── public/
    ├── index.html     # Interfaz con sidebar + canvas
    ├── styles.css     # Estilos tema oscuro (Tokyo Night) responsive
    └── app.js         # Lógica del grafo d3.tree y UI interactiva
```

---

## Como ejecutar para probar

```bash
cd LibLens
npm install
node server.js
# Abrir http://localhost:3000 en el navegador
```

---

## 📋 Changelog / Cambios aplicados

### v1.1 — Layout jerárquico tree y refactor general (actual)

**`server.js`:**
- Backend reconstruido para formato de grafo jerárquico raíz → categorías → paquetes
- Nodo raíz del sistema (system, level 0) como punto de partida central
- Nodos hub intermedios por categoría (level 1): icono representativo + cantidad de libs
- Paquetes como nodos hojas de nivel 2+ conectados a su categoría padre
- Edges curvos (cubic bezier) entre padre e hijo con grosor color según tipo (hub=grueso azul, package=standard gris, subgroup=finos)
- Sistema de deduplicación por categoría con Set `seenInCategory` e ID estable `<cat>-<sanitizedName>` via `dedup()`
- Cacheado de 60s en `/api/discover` con `_timestamp` para evitar re-escaneo repetido
- Whitelist de dependencias conocidas: express, react, webpack, vue, angular, next, rails, django, flask, fastapi, nest, laravel, jquery, lodash, asyncio, tailwindcss, vitest, jest, typescript, eslint
- Soporte para Chocolatey en Windows (`scanChoco()`, parsea `choco list --no-color`)
- Validación de inyección de comandos regex `/[;<>"'&|$`\\]/` en rutas install/uninstall
- Scans ejecutados en paralelo con `Promise.all()`

**`public/app.js`:**
- Renderizado completamente reescrito: ya no usa force simulation, ahora usa `d3.tree()` layout jerárquico
- Layout de árbol con `nodeSize([160, 220])` y separación configurable
- Zoom-to-fit automático al renderizar — calcula bounds de todos los nodos y escala para llenar viewport con margen 85%
- Cubic bezier curves para todas las conexiones padre-hijo (`M${x},${y} C...`)
- Nodos del root: rectángulo grande (130x80, rx=20) azul brillante con glow y ícono 🖥️
- Nodos de categoría hub: rectángulos coloridos por tipo (nodejs=azul púrpura, python=teal, ruby=magenta, brew=naranja, composer=rojo) con icono + nombre + "₳ libs"
- Nodos de paquetes: rectángulos pequeños (56x56, rx=6) con color de categoría por fondo
- Filtros de categorías ocultas se aplican vía Set `nodeIdsToKeep` antes del layout tree
- `renderGraph()` ahora es async y devuelve Promise
- Search debounce mejorado a 200ms
- `recenterView()` actualiza viewW/viewH al recalcular
- CORS restringido a `['http://localhost:3000', 'http://127.0.0.1:3000']` en server.js
- Zoom buttons usan `CONST.ZOOM_STEP` y su inverso

**`public/index.html`:**
- Accessibilidad mejorada con `aria-label`, `role="img"`, `role="navigation"`, `role="toolbar"`, `aria-live="polite"`
- D3 script con `onerror` fallback para detección de carga fallida
- Botón de toggle sidebar (`sidebar-toggle-btn`) para móvil
- Nuevos meta viewport

**`public/styles.css`:**
- Sidebar colapsable horizontalmente sobre sí misma (width → translateX(-100%)) con `transition: transform 0.3s ease, opacity 0.3s ease; z-index: 50`
- Clase `.sidebar.collapsed` aplica width:0 + min-width:0 + max-width:0 + left:-280px — sidebar se oculta sin romper el layout
- Media queries responsive: desktop (default), tablet ≤1024px (sidebar 240px, panel detalle 280px), móvil ≤768px (sidebar overlay absoluta + toggle visible, panel detalle bottom sheet de ancho completo), pequeño ≤480px (sidebar 240px)
- Panel detalle en móvil: bottom sheet anclado a la parte inferior con `max-height: 60vh`
- Sidebar toggle button: `position: fixed; z-index: 60; display: none` por defecto (visible solo en mobile via media query)

---

### Bugs corregidos (`v1.x`)

1. L350: Variable no definida `maxChar` → `maxChars` (truncamiento de labels en nodos)
2. L439: Syntax erróneo `btnScan.disabled: true` → `= true`
3. L467: Referencia inexistente `message` → `err.message` en block catch del scan
4. L489-502: Bloque try de instalación sin catch → añadido manejo de errores completo
5. L549: Comparación errónea `d.y !== 'undefined'` (string) → `!== undefined` (valor real)
6. L574-576: Listener `input` usaba variable `event` sin parámetro → agregado `function(event)`
7. L582, 584 → `this.data-cat` → `this.dataset.cat` (propiedad dataset correcta)
8. L584 → Selector CSS `[type="checked"]` → `[type="checkbox"]:checked` correcto
9. L589 → `renderGraph()` faltaban parámetros summary y systemInfo completos
10. Faltaban variables de estado `lastSummary`, `lastSystemInfo`, `currentZoom` → agregadas al closure

---

### v2.0 — Vista explorador tipo VS Code (tarea completada)

**`public/app.js`:**

- **TAREA 1 completada:** grafo jerárquico renderizado como archivo tree estilo VS Code
- Funcion `groupIntoTree()` Agregada: convierte flat nodes+links en arbol d3.hierarchy (antes faltaba, causaba crash al scan)
- Chevrons por-nodo corrigidos: cada categoria muestra ▶/▼ segun su propio estado en `expandedNodes` (antes usaba `.datum()` del primer nodo para todas las categorias)
- Click handler unificado a unico nodeGroup.on('click') — eliminados los 2 handlers duplicados que causaban doble render
- **Preservacion de zoom:** al expandir/colapsar nodos, la posicion y escala actual se mantiene en lugar de hacer zoom-to-fit (antes el zoom se reseteaba cada vez)
- Estado `expandedNodes = new Set()` persiste entre renders — nodos expandidos mantienen su estado post-scan
- Tooltips unificados con unico handler nodeGroup.filter(isFileNode).on('mouseenter'/'mouseleave') en lugar de handlers separados
- SVG renderizado directo via createElementNS para package nodes (en lugar de d3.append duplicado), mejorando consistencia del DOM
- Bordes izquierdos coloridos por categoria implementados via <rect> insertado a cada paquete node

## Backend - API

### Endpoints

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| GET | `/api/info` | Info del sistema (OS, arch, CPU, RAM) |
| GET | `/api/discover` | Escaneo completo y retorna grafo en formato jerárquico JSON con nodes y edges |
| POST | `/api/install/:name` | Retorna comando simulado de instalacion (valida caracteres peligrosos antes) |
| POST | `/api/uninstall/:name` | Retorna comando simulado de desinstalacion (valida caracteres peligrosos antes) |

### Formato del JSON del grafo hierarchical

```json
{
  "systemInfo": { ... },
  "graph": {
    "nodes": [
      {
        "id": "system",
        "name": "MacBook",
        "category": "__root__",
        "radius": 55,
        "level": 0,
        "isRoot": true
      },
      {
        "id": "cat-nodejs",
        "name": "Node.js",
        "version": "32 libs",
        "category": "__category__",
        "radius": 40,
        "level": 1,
        "isCategoryHub": true,
        "icon": "⬢",
        "count": 32
      },
      {
        "id": "pkg-nodejs-express",
        "name": "express",
        "version": "4.18.2",
        "category": "nodejs",
        "radius": 28,
        "level": 2,
        "parentId": "cat-nodejs"
      }
    ],
    "edges": [
      { "source": "system", "target": "cat-nodejs", "category": "hub" },
      { "source": "cat-nodejs", "target": "pkg-nodejs-express", "category": "package" }
    ]
  },
  "summary": { "nodejs": 32, "python": 15, ... },
  "cache": "hit|miss",
  "message": "Discovery complete"
}
```

---

## Frontend - Diseño de interfaz

### Sidebar izquierda (280px fijo / responsive en mobile)
- Logo/titulo + subtitulo version
- Boton principal **"Scan Libraries"** que dispara el escaneo
- Barra de progreso animada con texto de estado dinámico
- Seccion de estadisticas: conteo por categoria y total
- Seccion info del sistema (OS, arquitectura, CPU, RAM) post-escaneo
- Leyenda de colores con bolita para cada categoria
- Filtros por categoria (checkboxes) con debounce automatico
- Input de busqueda con filtro en tiempo real

### Area principal (canvas)
- Fondo oscuro tipo Tokyo Night (#1a1b26) con grid sutil via SVG defs
- **Grafo jerarquico tipo organigrama:**
  - Raiz central arriba: nodo grande azul brillante con icono 🖥️ y nombre del sistema
  - Nivel 1 (departamentos): nodos hub por categoria con icono, nombre y cantidad de libs
  - Nivel 2+ (paquetes): nodos hojas con nombre/version, color por categoria
  - Conexiones curvas cubic bezier con flechas y grosor según profundidad
- Zoom-to-fit automatico al render
- Interacciones: scroll zoom, drag pan, click node → select, doble click → detail panel, right-click → context menu

### Panel de detalle (lateral derecho / bottom sheet en mobile)
- Nombre, version, path, categoria con separador ":"
- Lista de dependencias como badges
- Botones Install y Uninstall
- Cerrar con X

---

## Backend - Comandos de escaneo por plataforma

| Plataforma | Homebrew | npm global | pip3 | gem | Composer | Chocolatey | dpkg/apt |
|------------|----------|------------|------|-----|----------|------------|----------|
| macOS ✅    | brew list --versions | npm list -g --depth=0 --json | pip3 list --format=freeze | gem list --local | composer global show | — | — |
| Linux ✅    | — | npm list -g --depth=0 --json | pip3 list --format=freeze | gem list --local | composer global show | — | dpkg/apt |
| Windows ✅  | — | npm list -g --depth=0 --json | pip list --format=freeze | gem list --local | composer global show | choco list | winget |

**Todas las plataformas:** scans en paralelo con `Promise.all()`

---

## Backend - Parseo de resultados

1. Ejecutar comandos en paralelo via `Promise.all()`
2. Para cada linea de salida, extraer nombre/version/ruta si disponibles
3. Agregar a la categoria correspondiente (nodejs, python, ruby, brew, composer, system, other)
4. Remover duplicados por nombre dentro de misma categoria con `dedup()` y Set `seenInCategory`
5. Despues del escaneo, identificar dependencias conocidas via whitelist de 20+ paquetes populares
6. Generar edges para grafo jerarquico root → category hub → packages

---

## Estado final: **v1.1 completa** — Layout jerarquico tree implementado con renderizado d3.tree(), backend reconstruido con formato de grafo jerarquico, deduplicacion, cache 60s, y validacion de comandos

---

## 📌 Tareas en progreso

### [✓] COMPLETADA — TAREA 1 (v2.0) — Vista de explorador tipo carpetas (estilo VS Code) en el grafo interactivo

**Implementado:**
- Chevron por-nodo con estado individual ✓
- Click handler unificado sin doble render ✓
- Preservacion de zoom al expandir/colapsar ✓
- Estado expandedNodes persiste entre renders y scans ✓
- Tooltips consistentes implementados ✓
- Bordes izquierdos coloridos por categoria en cada paquete ✓
- groupIntoTree() implementada (antes faltante, causaba crash) ✓

**Estado:** Listo para pruebas — ejecutar `node server.js` y abrir http://localhost:3000

---
