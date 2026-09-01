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
const io = new Server(httpServer, { cors: { origin: '*' } })

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
  for (const l of categories.nodejs) {
    if (l.name === 'express') {
      const deps = ['body-parser', 'cookie-parser', 'qs', 'debug']
      for (const d of deps) {
        if (categories.nodejs.find(x => x.name === d)) l.dependencies = (l.dependencies || []).concat(d)
      }
    }
  }
  return categories
}

function buildGraph(categories, systemInfo) {
  const nodes = []
  const edges = []
  let nodeId = 0
  const nodeIdsByName = {}

  for (const [catName, catList] of Object.entries(categories)) {
    for (const lib of catList) {
      const id = lib.id || 'lib-' + (++nodeId)
      nodeIdsByName[lib.name] = id
      nodes.push({
        id: id,
        name: lib.name,
        version: lib.version,
        path: lib.path,
        category: catName,
        radius: 32,
        dependencies: lib.dependencies || []
      })
    }
  }

  nodes.forEach(n => {
    if (n.dependencies) {
      for (const dep of n.dependencies) {
        if (nodeIdsByName[dep]) edges.push({ source: n.id, target: nodeIdsByName[dep] })
      }
    }
  })

  nodes.push({ id: 'system', name: systemInfo.hostname || 'System', version: systemInfo.platform + '-' + systemInfo.arch, path: systemInfo.homedir, category: 'system', radius: 45 })
  for (const cat of Object.keys(categories)) {
    const catNode = nodes.find(n => n.category === cat)
    if (catNode) edges.push({ source: 'system', target: catNode.id })
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

async function performScan(platform, socket) {
  if (socket) socket.emit('progress-update', 'Detected OS: ' + platform)
  
  const categories = { nodejs: [], python: [], ruby: [], system: [], brew: [], composer: [], other: [] }

  try {
    const [nodePkgs] = await Promise.all([ scanNpmGlobal() ])
    categories.nodejs = nodePkgs

    if (socket) socket.emit('progress-update', 'Scanning Python packages...')
    const pyPackages = await scanPython()
    categories.python = pyPackages

    if (socket) socket.emit('progress-update', 'Scanning Ruby gems...')
    const gemPackages = await scanGem()
    categories.ruby = gemPackages

    if (platform === 'macos' || platform === 'darwin') {
      if (socket) socket.emit('progress-update', 'Scanning Homebrew packages...')
      categories.brew = await scanHomebrew()
    } else if (platform === 'linux') {
      if (socket) socket.emit('progress-update', 'Scanning system packages...')
      const linuxPkgs = await scanLinuxPackages()
      categories.system = linuxPkgs
    } else if (platform === 'win32') {
      if (socket) socket.emit('progress-update', 'Scanning Windows packages...')
      categories.other = await scanWindowsPackages()
    }

    if (socket) socket.emit('progress-update', 'Scanning Composer packages...')
    categories.composer = await scanComposer()
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
  
  isScanning = true
  let result
  
  try {
    const platform = os.platform()
    cachedResult = await performScan(platform, null)
    result = cachedResult
  } catch(e) {
    result = { graph: { nodes:[], edges:[]}, systemInfo: detectOS(), summary:{}, error:e.message }
  }
  
  isScanning = false
  res.json({ ...result, message:'Discovery complete' })
})

app.post('/api/install/:name', (req, res) => {
  const name = req.params.name
  const platform = os.platform()
  let cmd = ''
  if (platform === 'darwin') cmd = 'brew install ' + name
  else if (platform === 'linux') cmd = 'sudo apt install ' + name
  else cmd = 'winget install ' + name
  res.json({ command: cmd, name: name })
})

app.post('/api/uninstall/:name', (req, res) => {
  const name = req.params.name
  const platform = os.platform()
  let cmd = ''
  if (platform === 'darwin') cmd = 'brew uninstall ' + name
  else if (platform === 'linux') cmd = 'sudo apt remove ' + name
  else cmd = 'winget uninstall ' + name
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
