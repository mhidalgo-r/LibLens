# LibLens

Visualizador interactivo de librerías instaladas en tu sistema. Escanea Homebrew, Node.js, Python, Ruby gems, Composer y más, mostrando el resultado como un grafico manipulable estilo Figma/ComfyUI.

## Dependencias

### Backend (Node.js)
- `express` — servidor HTTP + rutas API
- `socket.io` — progreso en tiempo real durante la escaneado

### Frontend (navegador)
- `d3.v7.min.js` — fuerza grafico interactivo (zoom, pan, drag) via CDN

Ninguna otra dependencia de frontend. No hay bundler ni framework.

## Estructura del proyecto

```
LibLens/
├── package.json
├── server.js          # Express + Socket.IO + descubrimiento
└── public/
    ├── index.html     # Interfaz con sidebar + canvas
    ├── styles.css     # Estilos tema oscuro estilo editor visual
    └── app.js         # Lógica del grafico y UI interactiva
```

## Como debe quedar terminado

### Backend (server.js)
1. Sirve archivos estaticos desde `public/` en el puerto 3000.
2. Expose las rutas:
   - `GET /api/info` — informacion del sistema (OS, arch, CPU, RAM, etc.)
   - `GET /api/discover` — realiza escaneo completo y retorna los datos como JSON con nodes y edges para el grafico.
   - `POST /api/install` e `/api/uninstall` — retornan comandos simulados (no ejecuta nada en realidad)
3. Al escanear detecta automaticamente el OS mediante `os.platform()`:
   - macOS: Homebrew, npm global, pip3 list, gem, etc
   - Linux: dpkg/apt o pacman dependiente de la distribucion
   - Windows: winget/choco

### Backend - Formato del JSON del grafico
El endpoint `/api/discover` retorna un objeto con esta estructura exacta:

```json
{
  "systemInfo": {
    "platform": "darwin",
    "arch": "arm64",
    "hostname": "MiMac",
    "type": "Darwin",
    "release": "23.0.0",
    "cpusCount": 10
  },
  "graph": {
    "nodes": [
      {
        "id": "lib-0",
        "name": "express",
        "version": "4.18.2",
        "path": "/opt/homebrew/lib/node_modules/express",
        "category": "nodejs",
        "radius": 35,
        "dependencies": ["body-parser","cookie-parser"]
      }
    ],
    "edges": [
      { "source": "lib-1", "target": "lib-0" }
    ]
  },
  "summary": {
     "nodejs":32,
     "python":15,
     "ruby":8,
     "brew":42,
     "system":0,
     "composer":3,
     "other":0
  }
}
```

### Frontend - Interfaz

La pagina debe tener dos zonas:

#### Sidebar izquierda (280px)
- Logo/titulo + subtitulo version
- Boton grande **"Scan Libraries"** que dispara el escaneo
- Barra de progreso animada con texto de estado
- Seccion de estadisticas: muestra conteo por categoria (Node.js, Python, Ruby, Brew, Composer, Other) y total
- Seccion de informacion del sistema (OS, arquitecura, CPU, RAM) aparece despues del escaneo
- Leyenda de colores con una bolita de color para cada categoria

#### Area principal (canvas)
- Fondo oscuro tipo editor (colores tipo Tokyo Night / One Dark)
- Grid sutil en el fondo
- Centro: grafico de nodos y lineas
  - Los nodos son cuadrados/redondeados coloreados por categoria
  - El texto dentro del nodo muestra su nombre truncado si es largo
  - Las lineas conectan dependencias entre nodos (flechas o simples lineas)
  - El nodo central representa el sistema operativo y todas las categorias salen de ahi

#### Interacciones

###### Zoom / Pan
- Scroll para zoom in/out
- Click drag en fondo vacio para pan
- Botones + y - en esquina inferior derecha
- Boton **"Re-center"** en sidebar para re-centrar vista

###### Nodes (cuadrados)
- Click arrastra node a nueva posicion
- Hover muestra tooltip con nombre, version y path de la libreria
- Click derecho abre menu contextual con acciones: Install, Uninstall, Copy Path, Focus Node, Hide/Show
- Doble click abre panel lateral derecho con detalles completos

###### Panel detalle (derecha)
- Nombre, version, path, categoria
- Lista de dependencias (badges)
- Botones "Install" e "Uninstall"
- Boton cerrar (x)

###### Filtros por categoria
- Sidebar tiene lista de checkboxes para filtrar categorias
- Desmarcar una categoria oculta sus nodos pero mantiene el grafico funcionando

### Backend - Comandos de escaneo

Cada plataforma debe ejecutar estos comandos via `child_process.exec` en paralelo:

##### macOS (darwin)
| Que buscar | Comando | Categorias |
|---|---|---|
| Homebrew packages | `brew list --versions` | brew |
| Node global | `npm list -g --depth=0 --json` | nodejs |
| Python pip3 | `pip3 list --format=freeze` | python |
| Ruby gems | `gem list --local --format=compact` | ruby |
| Composer global | `composer global show --format=compact` | composer |

##### Linux
| Que buscar | Comando | Categorias |
|---|---|---|
| dpkg/apt | `dpkg --list && apt list --installed 2>/dev/null` | system |
| Node global | `npm list -g --depth=0 --json` | nodejs |
| Python pip3 | `pip3 list --format=freeze` | python |
| Gem/Ruby | `gem list --local --format=compact` | ruby |

##### Windows
| Que buscar | Comando | Categorias |
|---|---|---|
| Winget | `winget list --format json` | other / system |
| Choco | `choco list` | other / system |
| Node global | `npm list -g --depth=0 --json` | nodejs |

### Backend - Parseo de resultados

Cada comando retorna texto crudo. El backend debe:

1. Ejecutar todos los comandos en paralelo con `Promise.all()`
2. Para cada linea de salida, extraer nombre/version/ruta si estan disponibles
3. Agregar al categoria correspondiente
4. Remover duplicados por nombre dentro de misma categoria
5. Después del escaneo, identificar dependencias conocidas (por ejemplo, express depende de body-parser) y generar edges

## Ejecucion para probar funcionalidad

```bash
cd LibLens
npm install
node server.js
# Abrir http://localhost:3000 en el navegador
```
