# LibLens

Visualizador interactivo de librerías instaladas vía comandos del sistema (pip show, npm root -g, conda list, brew list). Escaneo Homebrew, Node.js global y pip en el entorno base, mostrando paquetes como lista ordenada con panel de detalles y ejecucion de comandos contextuales.

---

## 📁 Estructura del proyecto

```
LibLens/
├── package.json
├── server.js          # Express + Socket.IO + discover + query executor
└── public/
    ├── index.html     # Interfaz: sidebar lista paquetes + comando bar + output area
    ├── app.js         # Lógica de lista, filtro, detalles y ejecucion de comandos
    └── styles.css     # Estilos tema oscuro (Tokyo Night)
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

### v3.0 — Lista de paquetes con ejecucion de comandos (actual)

**Cambio principal:** se elimino el grafo d3 que no funcionaba con 100+ paquetes. Nueva interfaz basada en lista + panel lateral.

**`server.js`:**
- Endpoint `/api/query` — ejecuta cualquier comando del sistema segun whitelist {pip,npm,conda,brew,gem,composer}
- Endpoint `/api/execute-command` — ejecuta acciones destructivas (uninstall) con regex de seguridad estricta
- Endpoint `/api/get-actions` — devuelve lista de acciones disponibles por paquete segun su categoria
  - Python: `pip show`, `pip uninstall`, `pip list | grep`, `python3 import test`
  - Node.js: `npm list`, `npm ls | grep`
  - Homebrew: `brew info`, `brew list | grep`
- Timeout de 15-20s en todos los comandos via wrapper `withTimeout()`
- Eliminar funciones muertas: scanConda, scanPythonWithShow, scanNpmRoot, scanNpmListGlobal

**`public/app.js`:**
- Vista de lista agrupada por categoria con chips de filtro y busqueda
- Click derecho en paquete → consulta `/api/get-actions` → muestra menu contextual
  - Acciones no destructivas: consultar info/verificar instalacion
  - Acciones destructivas (uninstall): muestran confirm via `confirm()` antes de ejecutar
- Ejecucion de comandos de usuario en la barra superior con formato inteligente segun tipo (pip freeze, npm ls tree, etc.)
- Panel lateral con detalles del paquete y info de `pip show` cuando aplica

**`public/index.html`:**
- Nueva estructura: sidebar izquierda con lista de paquetes + command bar arriba del area de output
- Salida formateada por comando (pip freeze → key==value, conda list → tabla, npm list → arbol indented)

---

## API de Endpoints

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| GET | `/api/info` | Info del sistema (OS, arch, CPU, RAM) |
| GET | `/api/discover` | Escaneo completo — nodos {name, version, isFileNode, category} + summary por categoria |
| POST | `/api/query` | Ejecuta comando con whitelist de herramientas seguras |
| POST | `/api/execute-command` | Ejecuta acciones (incluye destructivas con confirmacion previa via frontend) |
| POST | `/api/get-actions` | Devuelve lista de acciones para un paquete dado su categoria name + category |

---

## 📌 Tareas pendientes

### **Por hacer**

- [ ] Escaneo de entornos conda individuales (`conda list -n entorno-ia`) — actualmente solo escanea pip base
- [ ] Escaneo de npm en projectos locales (`npm list` dentro del directorio actual)
- [ ] Soporte para instalar paquetes desde el menú contextual (pip install / npm install)
- [ ] Exportar lista de paquetes a JSON/CSV
- [ ] Historial de comandos ejecutados
- [ ] Filtro de entorno: mostrar solo paquetes de un entorno conda especifico

---
