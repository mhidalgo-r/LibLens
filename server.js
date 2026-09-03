const express = require('express')
const { createServer } = require('http')
const { Server } = require('socket.io')
const os = require('os')
const path = require('path')
const fs = require('fs')
const { exec } = require('child_process')
const util = require('util')

const execPromise = util.promisify(exec)

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, { cors: { origin: ['http://localhost:3000', 'http://127.0.0.1:3000'] } })

app.use(express.static(path.join(__dirname, 'public')))

let cachedResult = null
let isScanning = false

function detectOS() {
  const platform = os.platform()
  const arch = os.arch()
  return {
    platform,
    arch,
    hostname: os.hostname(),
    type: os.type(),
    release: os.release(),
    uptime: Math.floor(os.uptime() / 86400),
    cpus: os.cpus().map(c => ({ model: c.model, speed: c.speed })),
    memory: Math.round(os.totalmem() / (1024 * 1024 * 1024)) + ' GB',
    freeMemory: Math.round(os.freemem() / (1024 * 1024 * 1024)) + ' GB',
    interfaces: os.networkInterfaces(),
    homedir: os.homedir(),
    tmpdir: os.tmpdir(),
    cpusCount: os.cpus().length,
    endianness: os.endianness()
  }
}

function addDependencies(categories) {
  const knownDeps = {
    express: ['body-parser', 'cookie-parser', 'qs', 'debug'],
    react: ['react-dom', 'jsx-runtime'],
    webpack: ['css-loader', 'style-loader', 'babel-loader', 'html-webpack-plugin'],
    vue: ['vue-router', 'vuex', 'pinia'],
    angular: ['rxjs', '@angular/core', '@angular/common'],
    next: ['react', 'react-dom', 'styled-jsx'],
    rails: ['actionpack', 'activerecord', 'railties'],
    django: ['django-rest-framework', 'celery'],
    flask: ['flask-cors', 'flask-sqlalchemy'],
    fastapi: ['pydantic', 'sqlalchemy'],
    nest: ['typeorm', 'rxjs', 'passport'],
    laravel: ['guzzle', 'monolog', 'swiftmailer'],
    jquery: ['bootstrap', 'popper'],
    lodash: [],
    asyncio: ['aiohttp', 'asyncio-mqtt'],
    tailwindcss: ['postcss', 'autoprefixer'],
    vitest: ['@vitest/ui'],
    jest: ['babel-jest', 'ts-jest'],
    typescript: ['tsc-watch', 'ttypescript'],
    eslint: ['prettier', 'eslint-plugin-react', 'eslint-config-airbnb']
  }

  const allNames = new Set()
  for (const cat of Object.values(categories)) {
    for (const lib of cat) allNames.add(lib.name)
  }

  for (const [pkgName, depNames] of Object.entries(knownDeps)) {
    for (const cat of Object.values(categories)) {
      const pkg = cat.find(x => x.name === pkgName)
      if (!pkg) continue
      for (const d of depNames) {
        if (d.includes('@')) {
          const base = d.split('/')[0]
          if (allNames.has(base)) {
            pkg.dependencies = (pkg.dependencies || []).concat(d)
          }
        } else if (allNames.has(d)) {
          pkg.dependencies = (pkg.dependencies || []).concat(d)
        }
      }
    }
  }

  return categories
}

function buildGraph(categories, systemInfo) {
  const nodes = []
  const edges = []
  const nodeIdsByName = {}
  
   // Root: System node (level 0)
   const systemId = 'system'
   const systemName = systemInfo.hostname || 'MacBook'
   nodes.push({
     id: systemId,
     name: systemName,
     version: '',
     category: '__root__',
     radius: 55,
     level: 0,
     isRoot: true
   })

   const catIcons = { nodejs: '⬢', python: '🐍', ruby: '💎', system: '🖥️', brew: '🍺', composer: '📦', other: '⚡' }
   const pkgIcons = { nodejs: '🔵', python: '🐍', ruby: '💠', npm: '🔵', pip: '🐍', gem: '💠' }
   const catNames = { nodejs: 'Node.js', python: 'Python', ruby: 'Ruby', brew: 'Homebrew', composer: 'Composer', system: 'System', other: 'Other' }
   
   // Sort categories by count descending for better layout
   const sortedCats = Object.entries(categories).sort((a, b) => b[1].length - a[1].length)

   for (const [catName, catList] of sortedCats) {
     if (catList.length === 0) continue
     
     // Category hub node (level 1)
     const catId = 'cat-' + catName
     nodeIdsByName[catId] = catId
     nodes.push({
       id: catId,
       name: catNames[catName] || catName,
       version: catList.length + ' libs',
       category: '__category__',
       radius: 40,
       level: 1,
       isCategoryHub: true,
       icon: catIcons[catName] || '●',
       count: catList.length,
       pkgIcon: pkgIcons[catName] || '📄'
     })
     
     // Edge from system to category
     edges.push({ source: systemId, target: catId, category: 'hub' })

     // Libraries in this category (level 2+), arranged in arcs
     const chunkSize = Math.ceil(catList.length / 3)
     for (let i = 0; i < catList.length; i += chunkSize) {
       const chunk = catList.slice(i, i + chunkSize)
       
       for (const lib of chunk) {
         const pkgId = 'pkg-' + catName + '-' + lib.name.replace(/[^a-zA-Z0-9_-]/g, '-')
         const subCat = chunk.length > 1 ? `sub-${Math.floor(i / chunkSize)}` : null
         
         if (subCat) {
           // Sub-group node for large categories
           const subId = `${catId}-${subCat}`
           if (!nodeIdsByName[subId]) {
             nodeIdsByName[subId] = subId
             nodes.push({
               id: subId,
               name: '',
               version: `└ ${chunk.length} libs`,
               category: '__subgroup__',
               radius: 20,
               level: 2,
               isSubGroup: true,
               parentId: catId,
               pkgIcon: pkgIcons[catName] || '📄'
             })
             edges.push({ source: catId, target: subId, category: 'subgroup' })
           }
           
           nodes.push({
             id: pkgId,
             name: lib.name,
             version: lib.version,
             category: catName,
             radius: 28,
             level: 3,
             parentId: subId,
             path: lib.path || '',
             isFileNode: true,
             dependencies: lib.dependencies || []
           })
           edges.push({ source: subId, target: pkgId, category: 'package' })
         } else {
           nodes.push({
             id: pkgId,
             name: lib.name,
             version: lib.version,
             category: catName,
             radius: 28,
             level: 2,
             parentId: catId,
             path: lib.path || '',
             isFileNode: true,
             dependencies: lib.dependencies || [],
             pkgIcon: pkgIcons[catName] || '📄'
           })
           edges.push({ source: catId, target: pkgId, category: 'package' })
         }
         
         nodeIdsByName[pkgId] = pkgId
       }
     }
   }

   return { nodes, edges }
}

async function scanHomebrew() {
  try {
    const result = await execPromise('brew list --versions')
    if (!result.stdout.trim()) return []
    const packages = []
    for (const line of result.stdout.trim().split('\n')) {
      const parts = line.trim().split(/\s+/)
      if (parts.length >= 2) packages.push({ id: 'brew-' + Math.random().toString(36).substr(2,9), name: parts[0], version: parts.slice(1).join(' '), path: '' })
    }
    return packages
  } catch(e) { return [] }
}

async function scanNpmGlobal() {
  try {
    const result = await execPromise('npm list -g --depth=0 --json')
    if (!result.stdout.trim()) return []
    const packages = []
    const data = JSON.parse(result.stdout)
    function walk(node) {
      for (const [name, info] of Object.entries(node.dependencies || {})) {
        if (info && info.version) {
          packages.push({ id: 'npm-' + Math.random().toString(36).substr(2,9), name, version: info.version, path: '' })
        }
        if (typeof walk === 'function' && info.dependencies) walk(info)
      }
    }
    walk(data)
    return packages
  } catch(e) { return [] }
}

async function scanPython() {
  try {
    const result = await execPromise('pip3 list --format=freeze').catch(() => execPromise('pip list --format=freeze'))
    if (!result.stdout.trim()) return []
    const packages = []
    for (const line of result.stdout.trim().split('\n')) {
      const parts = line.split('==')
      if (parts.length >= 2) packages.push({ id: 'py-' + Math.random().toString(36).substr(2,9), name: parts[0], version: parts.slice(1).join('=='), path: '' })
    }
    return packages
  } catch(e) { return [] }
}

async function scanGem() {
  try {
    const result = await execPromise('gem list --local --format=compact')
    if (!result.stdout.trim()) return []
    const packages = []
    for (const line of result.stdout.trim().split('\n')) {
      const match = line.match(/^([\w-]+)\s+\(([^)]+)\)/)
      if (match) packages.push({ id: 'gem-' + Math.random().toString(36).substr(2,9), name: match[1], version: match[2], path: '' })
    }
    return packages
  } catch(e) { return [] }
}

async function scanComposer() {
  try {
    const result = await execPromise('composer global show --format=compact')
    if (!result.stdout.trim()) return []
    const packages = []
    for (const line of result.stdout.trim().split('\n')) {
      const match = line.match(/^([\w-]+)\s+v?([\d.]+)/)
      if (match) packages.push({ id: 'composer-' + Math.random().toString(36).substr(2,9), name: match[1], version: match[2] || '?', path: '' })
    }
    return packages
  } catch(e) { return [] }
}

async function scanLinuxPackages() {
  const results = { dpkg: [], apt: [] }
  try { results.dpkg = await execPromise('dpkg --list') } catch(e) {}
  try { results.apt = await execPromise('apt list --installed 2>/dev/null') } catch(e) {}
  const packages = []
  
  if (results.dpkg.stdout && results.dpkg.stdout.trim()) {
    for (const line of results.dpkg.stdout.trim().split('\n').slice(4)) {
      if (!line.startsWith('ii ')) continue
      const parts = line.trim().split(/\s+/)
      if (parts.length >= 2) {
        const nameVer = parts[1].split(':')
        packages.push({ id: 'dpkg-' + Math.random().toString(36).substr(2,9), name: nameVer[0], version: (nameVer[1] || '?'), path: '/usr' })
      }
    }
  }

  if (results.apt.stdout && results.apt.stdout.trim()) {
    for (const line of results.apt.stdout.trim().split('\n')) {
      const match = line.match(/^([\w.-]+)\/[\w.]+\s+(([^,]+),\s*([\w.]+))/)
      if (match && !packages.find(p => p.name === match[1])) {
        packages.push({ id: 'apt-' + Math.random().toString(36).substr(2,9), name: match[1], version: match[3] || '?', path: '/usr' })
      }
    }
  }
  
  return packages
}

async function scanWindowsPackages() {
  try {
    const result = await execPromise('winget list --format json')
    if (!result.stdout.trim()) return []
    const packages = []
    const data = JSON.parse(result.stdout)
    for (const pkg of data) {
      packages.push({ id: 'winget-' + Math.random().toString(36).substr(2,9), name: pkg.Name || pkg.id || '?', version: pkg.Version || '?', path: '' })
    }
    return packages
  } catch(e) { return [] }
}

async function scanChoco() {
  try {
    const result = await execPromise('choco list --no-color')
    if (!result.stdout.trim()) return []
    const packages = []
    const lines = result.stdout.trim().split('\n')
    for (let i = 2; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line || line.startsWith('---')) continue
      const parts = line.split(/\s{2,}/)
      if (parts.length >= 2) {
        const name = parts[0]?.replace(/[v∗]/g, '').trim()
        const version = parts[1]?.trim()
        if (name && version) packages.push({ id: 'choco-' + name.replace(/[^a-zA-Z0-9_-]/g, '-'), name, version })
      }
    }
    return packages
  } catch(e) { return [] }
}

async function performScan(platform, socket) {
  if (socket) socket.emit('progress-update', 'Detected OS: ' + platform)
  
  const categories = { nodejs: [], python: [], ruby: [], system: [], brew: [], composer: [], other: [] }
  const seenInCategory = { nodejs: new Set(), python: new Set(), ruby: new Set(), system: new Set(), brew: new Set(), composer: new Set(), other: new Set() }

  function dedup(pkg, cat) {
    if (seenInCategory[cat].has(pkg.name)) return false
    seenInCategory[cat].add(pkg.name)
    pkg.id = cat + '-' + pkg.name.replace(/[^a-zA-Z0-9_-]/g, '-')
    return true
  }

  try {
    const [nodePkgs, pyPackages, gemPackages, brewResult, linuxPkgs, windowsPkgs, composerPkg] = await Promise.all([
      scanNpmGlobal(),
      scanPython(),
      scanGem(),
      (platform === 'macos' || platform === 'darwin') ? scanHomebrew() : Promise.resolve([]),
      platform === 'linux' ? scanLinuxPackages() : Promise.resolve([]),
      platform === 'win32' ? Promise.all([scanWindowsPackages(), scanChoco()]) : Promise.resolve([[null, []]]),
      scanComposer()
    ])

    for (const p of nodePkgs) if (dedup(p, 'nodejs')) categories.nodejs.push(p)
    for (const p of pyPackages) if (dedup(p, 'python')) categories.python.push(p)
    for (const p of gemPackages) if (dedup(p, 'ruby')) categories.ruby.push(p)

    if (platform === 'macos' || platform === 'darwin') {
      if (socket) socket.emit('progress-update', 'Scanning Homebrew packages...')
      for (const p of brewResult) if (p && dedup(p, 'brew')) categories.brew.push(p)
    } else if (platform === 'linux') {
      if (socket) socket.emit('progress-update', 'Scanning system packages...')
      for (const p of linuxPkgs) if (p && dedup(p, 'system')) categories.system.push(p)
    } else if (platform === 'win32') {
      const [wPack, cPack] = windowsPkgs
      if (wPack) { if (socket) socket.emit('progress-update', 'Scanning Windows packages...'); for (const p of wPack) if (p && dedup(p, 'other')) categories.other.push(p) }
      if (cPack) { if (socket) socket.emit('progress-update', 'Scanning chocolatey packages...'); for (const p of cPack) if (p && dedup(p, 'other')) categories.other.push(p) }
    }

    if (socket) socket.emit('progress-update', 'Scanning Composer packages...')
    for (const p of composerPkg) if (p && dedup(p, 'composer')) categories.composer.push(p)
  } catch(e) { console.error('Scan error:', e) }

  addDependencies(categories)

  const systemInfo = detectOS()
  const graph = buildGraph(categories, systemInfo)

  return {
    systemInfo,
    graph,
    summary: Object.fromEntries(Object.entries(categories).map(([k,v]) => [k, v.length]))
  }
}

app.get('/api/info', (req, res) => { res.json(detectOS()) })

app.get('/api/discover', async (req, res) => {
  if (isScanning) return res.json(cachedResult || { graph: { nodes:[], edges:[] }, systemInfo: detectOS(), summary: {}, message: 'Scan in progress' })
  
  const now = Date.now()
  if (cachedResult && now - cachedResult._timestamp < 60000) {
    return res.json({ ...cachedResult, cache: 'hit', message: 'Discovery complete (cached)' })
  }

  isScanning = true
  
  try {
    const platform = os.platform()
    cachedResult = await performScan(platform, null)
    cachedResult._timestamp = now
    res.json({ ...cachedResult, cache: 'miss', message: 'Discovery complete' })
  } catch(e) {
    result = { graph: { nodes:[], edges:[]}, systemInfo: detectOS(), summary:{}, error:e.message }
    res.json({ ...cachedResult, cache: 'hit', message: 'Discovery complete (from previous scan)', graph: { nodes:[], edges:[] }, systemInfo: detectOS(), summary:{}, error: e?.message })
  }
  
  isScanning = false
})

app.post('/api/install/:name', (req, res) => {
  const name = req.params.name
  if (!name || /[;<>"'&|$`\\]/.test(name)) return res.status(400).json({ error: 'Invalid package name' })
  const platform = os.platform()
  let cmd = ''
  if (platform === 'darwin') cmd = 'brew install ' + name
  else if (platform === 'linux') cmd = 'sudo apt install ' + name
  else if (platform === 'win32') cmd = 'winget install ' + name
  else cmd = '(install not available for platform)'
  res.json({ command: cmd, name: name })
})

app.post('/api/uninstall/:name', (req, res) => {
  const name = req.params.name
  if (!name || /[;<>"'&|$`\\]/.test(name)) return res.status(400).json({ error: 'Invalid package name' })
  const platform = os.platform()
  let cmd = ''
  if (platform === 'darwin') cmd = 'brew uninstall ' + name
  else if (platform === 'linux') cmd = 'sudo apt remove ' + name
  else if (platform === 'win32') cmd = 'winget uninstall ' + name
  else cmd = '(uninstall not available for platform)'
  res.json({ command: cmd, name: name })
})

io.on('connection', (socket) => {
  socket.emit('progress-update', 'Connected. Click "Scan" in the sidebar to discover libraries.')
  
  socket.on('scan', async () => {
    isScanning = true
    let lastResult
    try {
      const platform = os.platform()
      lastResult = await performScan(platform, socket)
      cachedResult = lastResult
    } catch(e) {}
    isScanning = false
    socket.emit('progress-update', 'Scan complete!')
  })
})

httpServer.listen(3000, () => console.log('LibLens running at http://localhost:3000'))
