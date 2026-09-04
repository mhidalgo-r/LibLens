const state = {
  allPackages: [],
  selectedPackage: null,
  activeFilter: 'all',
  searchQuery: '',
  contextMenuItems: []
};

const dom = {};

function init() {
  dom.btnScan = document.getElementById('btn-scan');
  dom.progBg = document.getElementById('prog-bg');
  dom.progFg = document.getElementById('prog-fg');
  dom.progText = document.getElementById('prog-text');
  dom.statsGrid = document.getElementById('stats-grid');
  dom.searchInput = document.getElementById('search-input');
  dom.filters = document.getElementById('filters');
  dom.pkgList = document.getElementById('package-list');
  dom.cmdInput = document.getElementById('cmd-input');
  dom.runCmd = document.getElementById('run-cmd');
  dom.outputArea = document.getElementById('output-area');
  dom.detailPanel = document.getElementById('detail-panel');
  dom.detailName = document.getElementById('detail-name');
  dom.detailContent = document.getElementById('detail-content');

  // Context menu
  dom.contextMenu = document.createElement('div');
  dom.contextMenu.id = 'context-menu';
  dom.contextMenu.style.cssText = `
    position:fixed;z-index:9000;background:#1e1f42;border:1px solid #2a2d5a;
    border-radius:8px;padding:4px;min-width:200px;display:none;
    box-shadow:0 8px 32px rgba(0,0,0,0.6);backdrop-filter:blur(8px);
  `;

  document.body.appendChild(dom.contextMenu);

  bindEvents();
}

function showContextMenu(x, y, items) {
  let html = '';

  for (const item of items) {
    const cls = item.destructive ? 'ctx-item ctx-destructive' : 'ctx-item';
    html += `<div class="${cls}" data-cmd="${item.cmd}" data-destructive="${item.destructive || false}">${item.label}</div>`;
  }

  dom.contextMenu.innerHTML = html;

  // Clamp position
  if (x + 220 > window.innerWidth) x = window.innerWidth - 220;
  if (y + items.length * 40 > window.innerHeight) y = window.innerHeight - items.length * 40;
  dom.contextMenu.style.left = x + 'px';
  dom.contextMenu.style.top = y + 'px';
  dom.contextMenu.style.display = 'block';

  // Bind clicks
  dom.contextMenu.querySelectorAll('.ctx-item').forEach(el => {
    el.addEventListener('click', function(ev) {
      ev.stopPropagation();
      hideContextMenu();
      runAction(this.dataset.cmd, this.dataset.destructive === 'true');
    });
  });
}

function hideContextMenu() {
  dom.contextMenu.style.display = 'none';
}

document.addEventListener('contextmenu', (ev) => {
  // If not on a package item, allow default
  const pkgItem = ev.target.closest('.package-item');
  if (!pkgItem) return;

  ev.preventDefault();
  ev.stopPropagation();

  const name = pkgItem.dataset.name;
  const pkg = state.allPackages.find(p => p.name === name);
  if (!pkg) return;

  fetch('/api/get-actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: pkg.name, category: pkg.category })
  }).then(r => r.json()).then(data => {
    if (data.actions.length) showContextMenu(ev.clientX, ev.clientY, data.actions);
  });
});

document.addEventListener('click', hideContextMenu);

function runAction(cmd, isDestructive) {
  if (isDestructive) {
    const name = cmd.split(/uninstall\s+/).pop() || 'unknown';
    if (!confirm(`Are you sure you want to uninstall "${name}"? This cannot be undone.`)) return;
  }

  fetch('/api/execute-command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: cmd, isDestructive: isDestructive === 'true', destructive: isDestructive })
  }).then(r => r.json()).then(data => {
    if (data.error) {
      dom.outputArea.innerHTML = `<div class="output-output error">${escapeHtml(data.error)}</div>`;
    } else {
      const output = data.stdout || '(no output)';
      dom.outputArea.innerHTML = `<div class="output-output" style="margin-bottom:8px;">${escapeHtml('$ ' + cmd)}</div><div class="output-output">${escapeHtml(output)}</div>`;
    }
  }).catch(err => {
    dom.outputArea.innerHTML = `<div class="output-output error">${escapeHtml(err.message)}</div>`;
  });
}

function bindEvents() {
  dom.btnScan.addEventListener('click', startScan);

  dom.searchInput.addEventListener('input', function () {
    state.searchQuery = this.value.toLowerCase();
    renderList();
  });

  dom.filters.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', function () {
      dom.filters.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      this.classList.add('active');
      state.activeFilter = this.dataset.cat;
      renderList();
    });
  });

  dom.cmdInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') runCommand(this.value);
  });

  dom.runCmd.addEventListener('click', () => runCommand(dom.cmdInput.value));

  document.getElementById('close-detail').addEventListener('click', () => {
    dom.detailPanel.classList.add('hidden');
    state.selectedPackage = null;
    renderList();
  });
}

async function startScan() {
  dom.btnScan.disabled = true;
  dom.btnScan.textContent = 'Scanning...';
  dom.progBg.style.display = 'block';
  dom.progText.style.display = 'block';
  dom.progFg.style.width = '5%';

  const messages = [
    'Detecting system...',
    'Scanning Python packages...',
    'Scanning Node.js packages...',
    'Scanning Homebrew packages...',
    'Building list...'
  ];

  let msgIdx = 0;
  const interval = setInterval(() => {
    msgIdx++;
    if (msgIdx < messages.length) {
      dom.progText.textContent = messages[msgIdx];
      dom.progFg.style.width = ((msgIdx + 1) / messages.length * 70) + '%';
    } else {
      dom.progText.textContent = 'Almost there...';
      dom.progFg.style.width = '90%';
    }
  }, 500);

  try {
    const resp = await fetch('/api/discover', { signal: AbortSignal.timeout(45000) });
    clearInterval(interval);

    if (!resp.ok) throw new Error('Server returned ' + resp.status);

    const data = await resp.json();
    dom.progFg.style.width = '100%';
    dom.progText.textContent = 'Done! Found ' + Object.values(data.summary).reduce((a, b) => a + b, 0) + ' packages';

    state.allPackages = [];
    const colors = { nodejs: '#E3DDAA', python: '#56B4BD', ruby: '#CC6699', brew: '#FFD6A1', system: '#C9CBFF' };

    if (data.graph && data.graph.nodes) {
      for (const n of data.graph.nodes) {
        if (n.isFileNode && n.name && n.version) {
          state.allPackages.push({
            name: n.name,
            version: n.version,
            category: n.category,
            color: colors[n.category] || '#7aa2f7',
            path: n.path || '',
            dependencies: n.dependencies || [],
            id: n.id
          });
        }
      }
    }

    // Update stats
    const summary = data.summary || {};
    document.getElementById('stat-total').textContent = Object.values(summary).reduce((a, b) => a + b, 0);
    document.getElementById('stat-pypi').textContent = summary.python || 0;
    document.getElementById('stat-npm').textContent = summary.nodejs || 0;
    document.getElementById('stat-brew').textContent = summary.brew || 0;
    dom.statsGrid.style.display = 'grid';

    renderList();

    // Show output with summary
    showOutput(getSummaryTable(data, summary), false);

  } catch (err) {
    clearInterval(interval);
    let msg = err.name === 'TimeoutError' ? 'Scan timed out. One command took too long.' : (err.message || 'Unknown error');
    dom.progText.textContent = 'Error: ' + msg;
    dom.outputArea.querySelector('.welcome-msg').style.display = 'none';
    dom.outputArea.innerHTML = '<div class="output-output error">' + escapeHtml(msg) + '</div>';

  } finally {
    setTimeout(() => {
      dom.progBg.style.display = 'none';
      dom.progText.style.display = 'none';
      dom.btnScan.disabled = false;
      dom.btnScan.textContent = '\uD83D\uDD0D Scan Again';
    }, 800);
  }
}

function getSummaryTable(data, summary) {
  const sys = data.systemInfo || {};
  let s = 'LibLens Summary\n' + '='.repeat(40) + '\n';
  s += 'OS: ' + (sys.platform || 'unknown') + ' (' + sys.arch + ') - ' + (sys.hostname || 'unknown') + '\n';
  s += 'Total packages: ' + Object.values(summary).reduce((a, b) => a + b, 0) + '\n\n';

  const cats = { nodejs: 'Node.js', python: 'Python', ruby: 'Ruby', brew: 'Homebrew', system: 'System', composer: 'Composer', other: 'Other' };
  for (const [key, count] of Object.entries(summary)) {
    if (count > 0) s += `[${cats[key] || key}] ${count} package(s)\n`;
  }

  return s;
}

function renderList() {
  const filtered = state.allPackages.filter(p => {
    const matchesFilter = state.activeFilter === 'all' || p.category === state.activeFilter;
    const matchesSearch = !state.searchQuery || p.name.toLowerCase().includes(state.searchQuery) || (p.version && p.version.includes(state.searchQuery));
    return matchesFilter && matchesSearch;
  });

  // Group by category
  const groups = {};
  for (const p of filtered) {
    if (!groups[p.category]) groups[p.category] = [];
    groups[p.category].push(p);
  }

  const catLabels = { nodejs: 'Node.js', python: 'Python', ruby: 'Ruby Gems', brew: 'Homebrew', system: 'System' };
  const catDots = { nodejs: 'nodejs-dot', python: 'python-dot', ruby: 'ruby-dot', brew: 'brew-dot', system: 'system-dot' };

  let html = '';
  for (const [cat, pkgs] of Object.entries(groups)) {
    html += `<div class="category-header"><span class="category-dot ${catDots[cat] || ''}"></span> ${catLabels[cat] || cat} (${pkgs.length})</div>`;
    for (const p of pkgs) {
      const sel = state.selectedPackage && state.selectedPackage.name === p.name ? ' selected' : '';
      html += `<div class="package-item${sel}" data-name="${escapeHtml(p.name)}">
        <span class="pkg-name">${highlightSearch(escapeHtml(p.name))}</span>
        <span class="pkg-version">${escapeHtml(p.version)}</span>
      </div>`;
    }
  }

  if (!filtered.length) {
    html = `<div style="text-align:center;padding:20px;color:#545c7e;">No packages found.</div>`;
  }

  dom.pkgList.innerHTML = html;

  dom.pkgList.querySelectorAll('.package-item').forEach(item => {
    item.addEventListener('click', function () {
      showDetail(this.dataset.name);
      renderList();
    });
  });
}

function highlightSearch(name) {
  if (!state.searchQuery) return name;
  const idx = name.toLowerCase().indexOf(state.searchQuery);
  if (idx === -1) return name;
  return name.slice(0, idx) + '<span style="background:#7aa2f73;color:#c9d1d9">' + name.slice(idx, idx + state.searchQuery.length) + '</span>' + name.slice(idx + state.searchQuery.length);
}

async function showDetail(name) {
  // Find package
  const pkg = state.allPackages.find(p => p.name === name);
  if (!pkg) return;

  state.selectedPackage = pkg;

  dom.detailName.textContent = pkg.name + ' v' + pkg.version;

  let rowsHtml = '';
  rowsHtml += `<div class="detail-row"><span class="detail-label">Version</span><span class="detail-value">${escapeHtml(pkg.version)}</span></div>`;
  if (pkg.path) rowsHtml += `<div class="detail-row"><span class="detail-label">Path</span><span class="detail-value">${escapeHtml(pkg.path)}</span></div>`;
  rowsHtml += `<div class="detail-row"><span class="detail-label">Category</span><span class="detail-value">${pkg.category}</span></div>`;

  if (pkg.dependencies && pkg.dependencies.length) {
    rowsHtml += `<div class="detail-row" style="grid-column:1/-1;"><span class="detail-label">Dependencies</span><span class="detail-value" style="display:flex;flex-wrap:wrap;gap:4px;">${pkg.dependencies.map(d => `<span style="background:#1e1f42;padding:2px 6px;border-radius:3px;font-size:11px;">${escapeHtml(d)}</span>`).join('')}</span></div>`;
  }

  // Try pip show for python packages to get more info
  if (pkg.category === 'python') {
    try {
      const resp = await fetch('/api/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: `pip show ${pkg.name}` }) });
      if (resp.ok) {
        const data = await resp.json();
        if (data.stdout) {
          // Parse pip show info
          const lines = data.stdout.trim().split('\n');
          for (const line of lines) {
            const m = line.match(/^(Name|Version|Location|Requires,?|Required-by):?\s*(.+)$/i);
            if (m && m[2].trim()) {
              const key = m[1].startsWith('Requires') ? 'Requires' : m[1].startsWith('Required') ? 'Required by' : m[1];
              rowsHtml += `<div class="detail-row"><span class="detail-label">${key}</span><span class="detail-value">${escapeHtml(m[2].trim())}</span></div>`;
            }
          }
        }
      }
    } catch(e) { /* ignore */ }
  }

  dom.detailContent.innerHTML = rowsHtml;
  dom.detailPanel.classList.remove('hidden');
  dom.detailPanel.classList.add('active');
}

async function runCommand(cmd) {
  if (!cmd.trim()) return;

  dom.cmdInput.value = cmd;

  // Show command in output
  const cmdLine = `<div class="output-output" style="margin-bottom:8px;">${escapeHtml('$ ' + cmd)}</div>`;

  try {
    const resp = await fetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd }),
      signal: AbortSignal.timeout(20000)
    });

    if (!resp.ok) throw new Error('Server returned ' + resp.status);

    const data = await resp.json();

    if (data.error) {
      dom.outputArea.innerHTML = cmdLine + `<div class="output-output error">${escapeHtml(data.error)}</div>`;
    } else if (data.stdout) {
      // Format the output intelligently
      let formatted = formatOutput(cmd, data.stdout);
      dom.outputArea.innerHTML = cmdLine + `<div class="output-output">${formatted}</div>`;
    } else {
      dom.outputArea.innerHTML = cmdLine + '<div class="output-output" style="color:#545c7e;">No output. Command executed successfully.</div>';
    }

  } catch (err) {
    dom.outputArea.innerHTML = cmdLine + `<div class="output-output error">${escapeHtml(err.name === 'TimeoutError' ? 'Command timed out (20s limit)' : err.message)}</div>`;
  }
}

function formatOutput(cmd, output) {
  // Detect command type and format accordingly
  const trimmed = output.trim();

  if (/anaconda|conda/.test(cmd)) {
    // conda list - format as table
    const lines = trimmed.split('\n').filter(l => l && !l.startsWith('#'));
    let html = '';
    for (const line of lines) {
      const parts = line.split(/\s{2,}/);
      if (parts.length >= 2) html += `<div style="${parts.length >= 3 ? '' : 'color:#545c7e;'}"> <span style="color:${highlightMatch(cmd, parts[0])}">${escapeHtml(parts[0])}</span> <span class="pkg-version">${escapeHtml(parts[1] || '')}</span> ${parts[2] ? '<span style="color:#545c7e">'+escapeHtml(parts[2])+'</span>' : ''}</div>`;
    }
    return html;
  }

  if (/pip\s+(list|show)/.test(cmd)) {
    // pip list --format=freeze -> Key == Value
    let html = '';
    for (const line of trimmed.split('\n')) {
      const m = line.match(/^([^=]+)==(.+)$/);
      if (m) html += `<div><span style="color:#7aa2f7">${escapeHtml(m[1])}</span> <span class="pkg-version">${escapeHtml(m[2])}</span></div>`;
      else html += `<div>${escapeHtml(line)}</div>`;
    }
    return html;
  }

  if (/npm\s+root/.test(cmd)) {
    return `<div style="color:#56B4BD">${escapeHtml(trimmed)}</div>`;
  }

  if (/npm\s+list/.test(cmd)) {
    try {
      const data = JSON.parse(trimmed);
      let html = '';
      let count = 0;
      function walk(node, indent) {
        for (const [name, info] of Object.entries(node.dependencies || {})) {
          if (info && info.version) {
            if (++count > 200) break;
            const prefix = ' '.repeat(indent * 2);
            html += `<div style="white-space:nowrap"><span style="color:#7aa2f7">${escapeHtml(name)}</span> <span class="pkg-version">${escapeHtml(info.version)}</span></div>`;
            if (info.dependencies) walk(info, indent + 1);
          }
        }
      }
      walk(data, 0);
      if (count > 200) html += '<div style="color:#545c7e;">... truncated</div>';
      return html || `<div>${escapeHtml(output)}</div>`;
    } catch {
      // Fall through to raw output
    }
  }

  if (/brew\s+list/.test(cmd)) {
    let html = '';
    for (const line of trimmed.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) html += `<div><span style="color:#FFD6A1">${escapeHtml(parts[0])}</span> <span class="pkg-version">${escapeHtml(parts.slice(1).join(' '))}</span></div>`;
    }
    return html;
  }

  // Default: raw output with line numbers stripped
  let html = '';
  for (const line of trimmed.split('\n').slice(0, 500)) {
    html += `<div>${escapeHtml(line)}</div>`;
  }
  return html;
}

function highlightMatch(cmd, text) {
  if (/pip/.test(cmd)) return 'color:#56B4BD';
  if (/npm|brew/.test(cmd)) return 'color:#7aa2f7';
  if (/conda/.test(cmd)) return 'color:#FFD6A1';
  return '';
}

function showOutput(html, isError) {
  dom.outputArea.innerHTML = Array.isArray(html) ? html.join('') : `<div class="output-output">${html}</div>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Init
document.addEventListener('DOMContentLoaded', init);
