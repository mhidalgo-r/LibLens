(function() {
  let simulation = null;
  let nodesData = [];
  let linksData = [];
  let nodeVisibility = {};
  let selectedNode = null;
  let searchQuery = '';
  const catNameMap = {
    'nodejs': 'Node.js',
    'python': 'Python',
    'ruby': 'Ruby Gems',
    'system': 'System',
    'brew': 'Homebrew',
    'composer': 'Composer',
    'other': 'Other'
  };

  const catColors = {
    'nodejs': { fill: '#E3DDAA', stroke: '#B8AE70', labelFill: '#1a1b26' },
    'python': { fill: '#56B4BD', stroke: '#38909A', labelFill: '#fff' },
    'ruby':   { fill: '#CC6699', stroke: '#A04E76', labelFill: '#fff' },
    'system': { fill: '#C9CBFF', stroke: '#9B9CDD', labelFill: '#1a1b26' },
    'brew':   { fill: '#FFD6A1', stroke: '#CC9E6A', labelFill: '#1a1b26' },
    'composer': { fill: '#F78497', stroke: '#C45A6A', labelFill: '#fff' },
    'other':  { fill: '#E5C38C', stroke: '#AA9855', labelFill: '#1a1b26'}
  };

  // DOM refs
  const svgEl = d3.select('#graph-svg');
  const graphGroup = svgEl.append('g').attr('class', 'graph-group');
  const canvasContainer = document.getElementById('canvas-container');

  // Zoom
  const zoomBehavior = d3.zoom()
    .scaleExtent([0.1, 5])
    .on('zoom', (event) => {
      graphGroup.attr('transform', event.transform);
      document.getElementById('zoom-info').textContent = Math.round(event.transform.k * 100) + '%';
    });

  svgEl.call(zoomBehavior);

  // Elements
  const btnScan = document.getElementById('btn-scan');
  const btnRecenter = document.getElementById('btn-recenter');
  const zoomInBtn = document.getElementById('zoom-in');
  const zoomOutBtn = document.getElementById('zoom-out');
  const progressBg = document.getElementById('progress-bg');
  const progressFill = document.getElementById('progress-fill');
  const progressTextEl = document.getElementById('progress-text');
  const statsSection = document.getElementById('stats-section');
  const statsContent = document.getElementById('stats-content');
  const systemInfoSection = document.getElementById('system-info-section');
  const systemInfoContent = document.getElementById('system-info-content');
  const searchInput = document.getElementById('search-input');
  const tooltipEl = document.getElementById('tooltip');
  const contextMenuEl = document.getElementById('context-menu');
  const detailPanel = document.getElementById('detail-panel');

  // Helpers
  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Tooltip
  function showTooltip(event, d) {
    let html = '<div class="tt-name">' + escapeHtml(d.name) + '</div>';
    if (d.version) html += '<span class="tt-version">' + escapeHtml(d.version) + '</span>';
    if (d.path) html += '<div class="tt-path">' + escapeHtml(d.path) + '</div>';
    tooltipEl.innerHTML = html;
    tooltipEl.classList.remove('hidden');
    
    const w = canvasContainer.getBoundingClientRect().width;
    const h = canvasContainer.getBoundingClientRect().height;
    let left = event.clientX - canvasContainer.getBoundingClientRect().left + 12;
    let top = event.clientY - canvasContainer.getBoundingClientRect().top + 12;
    if (left + 270 > w) left -= 282;
    if (top + 120 > h) top -= 130;
    tooltipEl.style.left = left + 'px';
    tooltipEl.style.top = top + 'px';
  }

  function hideTooltip() {
    tooltipEl.classList.add('hidden');
  }

  // Context menu
  function showContextMenu(event, d) {
    event.preventDefault();
    event.stopPropagation();
    
    let html = '';
    if (d.category !== 'system' && d.category !== 'brew') {
      html += '<div class="ctx-item" data-action="install">Install ' + escapeHtml(d.name) + '</div>';
      html += '<div class="ctx-item" data-action="uninstall">Uninstall ' + escapeHtml(d.name) + '</div>';
    }
    if (d.path) {
      html += '<div class="ctx-item" data-action="copy-path">&#x1F4CB Copy Path</div>';
    }
    html += '<div style="height:1px;background:#292e42;margin:3px 8px;"></div>';
    html += '<div class="ctx-item" data-action="focus">Focus Node</div>';
    html += '<div class="ctx-item" data-action="toggle">' + (d.disabled ? 'Show' : 'Hide') + '</div>';
    
    contextMenuEl.innerHTML = html;
    
    const w = canvasContainer.getBoundingClientRect().width;
    const h = canvasContainer.getBoundingClientRect().height;
    let left = event.clientX - canvasContainer.getBoundingClientRect().left;
    let top = event.clientY - canvasContainer.getBoundingClientRect().top;
    if (left + 200 > w) left -= 210;
    if (top + 200 > h) top -= 210;
    
    contextMenuEl.style.left = left + 'px';
    contextMenuEl.style.top = top + 'px';
    contextMenuEl.classList.remove('hidden');
  }

  function hideContextMenu() {
    contextMenuEl.classList.add('hidden');
  }

  // Detail panel
  function showDetailPanel(d) {
    selectedNode = d;
    document.getElementById('detail-name').textContent = d.name;
    document.getElementById('detail-version').innerHTML = '<strong>Version</strong>' + (d.version ? escapeHtml(d.version) : ' Unknown');
    
    if (d.path) {
      document.getElementById('detail-path').innerHTML = '<strong>Path</strong><div class="detail-path">' + escapeHtml(d.path) + '</div>';
    } else {
      document.getElementById('detail-path').innerHTML = '<strong>Path</strong>N/A';
    }
    
    const catLabel = catNameMap[d.category] || d.category;
    document.getElementById('detail-category').innerHTML = '<strong>Category</strong>' + escapeHtml(catLabel);

    let depsHtml = '';
    if (d.dependencies && d.dependencies.length > 0) {
      depsHtml = '<div class="detail-field"><strong>Dependencies</strong><div class="dep-list">';
      for (const dep of d.dependencies) {
        depsHtml += '<span class="dep-badge">' + escapeHtml(dep) + '</span>';
      }
      depsHtml += '</div></div>';
    } else if (d.dependents && d.dependents.length > 0) {
      depsHtml = '<div class="detail-field"><strong>Dependents</strong><div class="dep-list">';
      for (const dep of d.dependents) {
        depsHtml += '<span class="dep-badge">' + escapeHtml(dep) + '</span>';
      }
      depsHtml += '</div></div>';
    }
    document.getElementById('detail-deps-text').innerHTML = depsHtml;

    const colors = catColors[d.category] || catColors['other'];
    document.getElementById('btn-install').style.background = 'linear-gradient(135deg, #3d4aee, #7aa2f7)';
    document.getElementById('btn-uninstall').style.background = 'linear-gradient(135deg, #db6e8b, #f7768e)';
    
    detailPanel.classList.remove('hidden');
  }

  function hideDetailPanel() {
    selectedNode = null;
    detailPanel.classList.add('hidden');
  }

  // Stats
  function renderStats(summary) {
    if (!summary || Object.keys(summary).length === 0) return;
    
    let html = '<div style="font-size:11px;color:#545c7e;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid #292e42;">Total: ' + Object.values(summary).reduce((a,b)=>a+b,0) + ' libraries</div>';
    
    for (const [cat, count] of Object.entries(summary)) {
      if (count <= 0) continue;
      const icon = {'nodejs':'\u26AB','python':'\uD83D\uDC0D','ruby':'\uD83C\uDF39','system':'\u2699\uFE0F','brew':'\uD83E\uDD53','composer':'\uD83C\uDF1F','other':'\u26A1'}[cat] || '\u25CB';
      const label = catNameMap[cat] || cat;
      html += '<div style="display:flex;align-items:center;gap:6px;"><span>' + icon + '</span><span class="stat-cat">' + escapeHtml(label) + '</span><span style="margin-left:auto;font-weight:600;">' + count + '</span></div>';
    }
    
    statsContent.innerHTML = html;
    statsSection.style.display = 'block';
  }

  function renderSystemInfo(sys) {
    if (!sys) return;
    let html = '';
    const fields = [
      ['OS', sys.platform + ' ' + (sys.arch || '')],
      ['Type', sys.type || ''],
      ['Release', sys.release || ''],
      ['Hostname', sys.hostname || ''],
      ['CPU Cores', sys.cpusCount || sys.cpus?.length || '?'],
      ['Memory', sys.memory || '']
    ];
    
    for (const [label, value] of fields) {
      if (value && String(value).trim()) {
        html += '<div style="margin-bottom:2px;"><strong>' + escapeHtml(label) + '</strong> ' + escapeHtml(String(value)) + '</div>';
      }
    }
    
    systemInfoContent.innerHTML = html;
    systemInfoSection.classList.remove('hidden');
  }

  // Main graph rendering
  function renderGraph(graphData, summary, sysInfo) {
    graphGroup.selectAll('*').remove();
    
    if (!graphData || !graphData.nodes || graphData.nodes.length === 0) return;
    
    nodesData = graphData.nodes.map(n => ({ ...n, disabled: false }));
    
    // Initialize visibility from checkboxes
    const visibleCats = new Set();
    document.querySelectorAll('.filter-item input[type="checkbox"]').forEach(cb => {
      if (cb.checked) visibleCats.add(cb.dataset.cat);
    });
    
    nodesData.forEach(n => {
      n.disabled = !visibleCats.has(n.category);
    });

    // Create links
    linksData = (graphData.edges || []).map(e => ({
      source: typeof e.source === 'object' ? e.source.id : e.source,
      target: typeof e.target === 'object' ? e.target.id : e.target
    }));

    // Apply search filter
    const filteredNodes = nodesData.filter(n => {
      if (n.disabled) return false;
      if (searchQuery && !n.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });

    const visibleLinks = linksData.filter(e => {
      const sId = typeof e.source === 'string' ? e.source : e.source.id;
      const tId = typeof e.target === 'string' ? e.target : e.target.id;
      const sVisible = filteredNodes.find(n => n.id === sId);
      const tVisible = filteredNodes.find(n => n.id === tId);
      return sVisible && tVisible;
    });

    // Destroy old simulation
    if (simulation) simulation.stop();

    // Create new nodes array for simulation with positions
    const simNodes = filteredNodes.map(n => {
      if (!n.x) n.x = (Math.random() - 0.5) * 400;
      if (!n.y) n.y = (Math.random() - 0.5) * 400;
      return n;
    });

    // Create simulation
    simulation = d3.forceSimulation(simNodes)
      .force('link', d3.forceLink(visibleLinks).id(d => d.id).distance(120))
      .force('charge', d3.forceManyBody().strength(-350))
      .force('center', d3.forceCenter(0, 0))
      .force('collision', d3.forceCollide().radius(d => (d.radius || 32) + 15))
      .stop();

    // Manual tick loop for better control
    for (let i = 0; i < 300; ++i) simulation.tick();

    // Add links
    const linkLine = graphGroup.append('g').selectAll('.link-line')
      .data(visibleLinks, d => (typeof d.source === 'string' ? d.source : d.source.id) + '-' + (typeof d.target === 'string' ? d.target : d.target.id))
      .enter().append('line')
      .attr('class', 'link-line')
      .attr('stroke', '#414868')
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.5);

    // Add nodes
    const nodeGroups = graphGroup.append('g').selectAll('.node-group')
      .data(simNodes, d => d.id)
      .enter().append('g')
      .attr('class', 'node-group')
      .call(d3.drag()
        .on('start', (event, d) => {
          simulation.alpha(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
          canvasContainer.classList.add('dragging-node');
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', () => {
          simulation.alpha(0.1).restart();
          canvasContainer.classList.remove('dragging-node');
        }))
      .on('mouseover', function(event, d) { 
        showTooltip(event, d);
        highlightConnected(d);
      })
      .on('mousemove', function(event, d) { 
        showTooltip(event, d);
      })
      .on('mouseout', function() { 
        hideTooltip();
        unhighlightAll();
      })
      .on('contextmenu', function(event, d) { 
        showContextMenu(event, d);
      })
      .on('dblclick', () => { showDetailPanel(d); });

    // Node rectangles
    nodeGroups.append('rect')
      .attr('class', 'node-rect')
      .attr('x', d => -(d.radius || 32)/2)
      .attr('y', d => -(d.radius || 32)/2)
      .attr('width', d => (d.radius || 32))
      .attr('height', d => (d.radius || 32))
      .attr('rx', 6).attr('ry', 6)
      .attr('fill', d => catColors[d.category]?.fill || catColors['other'].fill)
      .attr('stroke', d => catColors[d.category]?.stroke || catColors['other'].stroke)
      .attr('stroke-width', 2);

    // Node shadows
    nodeGroups.append('rect')
      .attr('x', d => -(d.radius || 32)/2)
      .attr('y', d => -(d.radius || 32)/2)
      .attr('width', d => (d.radius || 32))
      .attr('height', d => (d.radius || 32))
      .attr('rx', 6).attr('ry', 6)
      .attr('fill', 'transparent')
      .attr('stroke-width', 0);

    // Labels
    nodeGroups.append('text')
      .attr('class', 'node-label')
      .attr('x', 0)
      .attr('y', 4)
      .attr('fill', d => catColors[d.category]?.labelFill || '#fff')
      .attr('font-size', d => Math.max(8, (d.radius || 32)/5) + 'px')
      .attr('font-weight', 600)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('pointer-events', 'none')
      .attr('dy', '0.35em')
      .text(d => {
        const w = (d.radius || 32);
        const maxChars = Math.max(3, Math.floor(w / 8));
        return d.name.length > maxChar ? d.name.substring(0, maxChar - 1) + '...' : d.name;
    });

    // Update positions
    nodeGroups.attr('transform', d => `translate(${d.x},${d.y})`);
    linkLine
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);

    renderStats(summary);
    renderSystemInfo(sysInfo);

    // Zoom to fit after render
    setTimeout(() => {
      const bounds = graphGroup.node().getBBox();
      if (bounds.width > 0 && bounds.height > 0) {
        const w = canvasContainer.clientWidth;
        const h = canvasContainer.clientHeight;
        const scale = Math.min(w / bounds.width, h / bounds.height) * 0.85;
        const tx = w/2 - (bounds.x + bounds.width/2) * scale;
        const ty = h/2 - (bounds.y + bounds.height/2) * scale;
        svgEl.transition().duration(750).call(zoomBehavior.transform, d3.zoomIdentity.translate(tx,ty).scale(Math.min(scale, 0.8)));
      }
    }, 400);

    // Update progress to complete
    setTimeout(() => {
      progressFill.style.width = '100%';
      if (progressTextEl) {
        progressTextEl.textContent = 'Scan complete!';
        setTimeout(() => {
          if (progressBg) progressBg.classList.add('hidden');
          if (progressTextEl) progressTextEl.classList.add('hidden');
        }, 1500);
      }
    }, 200);

    // Update button state
    btnScan.disabled = false;
    btnScan.textContent = 'Scan Libraries';
  }

  // Highlight connected nodes
  function highlightConnected(d) {
    const connectedIds = new Set();
    connectedIds.add(d.id);
    
    linksData.forEach(e => {
      const sId = typeof e.source === 'object' ? e.source.id : e.source;
      const tId = typeof e.target === 'object' ? e.target.id : e.target;
      if (sId === d.id) connectedIds.add(tId);
      if (tId === d.id) connectedIds.add(sId);
    });

    graphGroup.selectAll('.node-group').attr('opacity', g => connectedIds.has(g.id) ? 1 : 0.2);
    graphGroup.selectAll('.link-line').attr('stroke-width', g => {
      const sId = typeof g.source === 'object' ? g.source.id : g.source;
      const tId = typeof g.target === 'object' ? g.target.id : g.target;
      return (sId === d.id || tId === d.id) ? 2.5 : 1;
    }).attr('stroke', g => {
      const sId = typeof g.source === 'object' ? g.source.id : g.source;
      const tId = typeof g.target === 'object' ? g.target.id : g.target;
      return (sId === d.id || tId === d.id) ? '#709FE6' : '#414868';
    }).attr('stroke-opacity', g => {
      const sId = typeof g.source === 'object' ? g.source.id : g.source;
      const tId = typeof g.target === 'object' ? g.target.id : g.target;
      return (sId === d.id || tId === d.id) ? 0.8 : 0.3;
    });
  }

  function unhighlightAll() {
    graphGroup.selectAll('.node-group').attr('opacity', 1);
    graphGroup.selectAll('.link-line').attr('stroke-width', 1.5).attr('stroke', '#414868');
  }

  // Re-center view
  function recenterView() {
    const w = canvasContainer.clientWidth;
    const h = canvasContainer.clientHeight;
    svgEl.transition().duration(750).call(zoomBehavior.transform, d3.zoomIdentity.translate(w/2,h/2).scale(1));
  }

  // Start scan
  async function startScan () {
    btnScan.disabled: true;
    btnScan.textContent = 'Scanning...';
    
    if (progressBg) progressBg.classList.remove('hidden');
    if (progressTextEl) {
      progressTextEl.classList.remove('hidden');
      progressTextEl.textContent = 'Detecting operating system...';
    }
    if (progressFill) progressFill.style.width = '10%';

    // Simulate progress
    const stages = [15,30,45,60,75];
    let sIdx = 0;
    const stageInterval = setInterval(() => {
      if (sIdx < stages.length) {
        progressFill.style.width = stages[sIdx] + '%';
        sIdx++;
      } else clearInterval(stageInterval);
    }, 300);

    try {
      const response = await fetch('/api/discover');
      const data = await response.json();
      
      clearInterval(stageInterval);
      renderGraph(data.graph, data.summary, data.systemInfo);
    } catch(err) {
      console.error('Scan failed:', err);
      progressTextEl.textContent = 'Error: ' + message;

      if (progressBg) progressBg.classList.add('hidden');
      if (progressTextEl) progressTextEl.classList.add('hidden');
      
      btnScan.disabled = false;
      btnScan.textContent = 'Scan Libraries';
    }
  };

  // Event listeners
  btnScan.addEventListener('click', startScan);
  btnRecenter.addEventListener('click', recenterView);
  
  zoomInBtn.addEventListener('click', () => { svgEl.transition().duration(200).call(zoomBehavior.scaleBy, 1.3) });
  zoomOutBtn.addEventListener('click', () => { svgEl.transition().duration(200).call(zoomBehavior.scaleBy, 0.7) });

  // Close detail panel
  document.getElementById('close-detail').addEventListener('click', hideDetailPanel);
  
  document.getElementById('btn-install').addEventListener('click', async function() {
    if (!selectedNode) return;
    
    const name = selectedNode.name;
    try {
      const res = await fetch('/api/install/' + encodeURIComponent(name));
      const data = await res.json();
      
      let msg = "Install command:\n";
      msg += data.command || '(install not available for ' + (os.platform || 'unknown'));
    
      alert(msg);
    };
  });

  document.getElementById('btn-uninstall').addEventListener('click', async function() {
    if (!selectedNode) return;
    
    const name = selectedNode.name;
    try {
      const res = await fetch('/api/uninstall/' + encodeURIComponent(name));
      const data = await res.json();

      let msg = "Uninstall command:\n";
      msg += data.command || '(uninstall not available for platform)';
      
      alert(msg);
    } catch(err) {
      console.error('Uninstall error:', err);
      alert('Failed to get uninstall command');
    }
  });

  // Context menu clicks
  contextMenuEl.addEventListener('click', async function(event) {
    const actionEl = event.target.closest('.ctx-item');
    if (!actionEl) return;
    
    const action = actionEl.dataset.action;
    hideContextMenu();
    
    let d = selectedNode || nodesData.find(n => n.name === actionEl.textContent.trim());
    if (!d) return;

    if (action === 'install') {
      try {
        const res = await fetch('/api/install/' + encodeURIComponent(d.name));
        const data = await res.json();
        alert('Install: ' + (data.command || '(N/A)'));
      } catch(e) {}
    } else if (action === 'uninstall') {
      try {
        const res = await fetch('/api/uninstall/' + encodeURIComponent(d.name));
        const data = await res.json();
        alert('Uninstall: ' + (data.command || '(N/A)'));
      } catch(e) {}
    } else if (action === 'copy-path' && d.path) {
      navigator.clipboard?.writeText(d.path);
    } else if (action === 'focus') {
      if (d.x !== undefined && d.y !== 'undefined') {
        const width = canvasContainer.clientWidth;
        const height = canvasContainer.clientHeight;
        svgEl.transition().duration(500).call(zoomBehavior.transform, d3.zoomIdentity.translate(width/2 - d.x, height/2-d.y).scale(currentZoom?.k || 1));
      }
    } else if (action === 'toggle') {
      d.disabled = !d.disabled;
      renderGraph({ nodes: nodesData, edges: linksData }, {}, {});
    }
  });

  // Close menus on click outside
  canvasContainer.addEventListener('click', function(event) {
    if (!contextMenuEl.contains(event.target)) hideContextMenu();
  });

  document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
      hideContextMenu();
      hideDetailPanel();
      hideTooltip();
    }
    // Search box focus handler
  });

  searchInput.addEventListener('input', function() {
    searchQuery = event.target.value.trim().toLowerCase();
    renderGraph({ nodes: nodesData, edges: linksData }, {}, {});
  });

  // Filter checkboxes
  document.querySelectorAll('.filter-item input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', function() {
      nodeVisibility[this.data-cat] = this.checked;
      const visibleCats = new Set();
      document.querySelectorAll('.filter-item input[type="checked"]:checked').forEach(cbx => {
        visibleCats.add(cbx.dataset.cat);
      });

      nodesData.forEach(n => n.disabled = !visibleCats.has(n.category));
      renderGraph({ nodes: nodesData, edges: linksData }, {});
    });
  });

  // Update system info immediately
  fetch('/api/info').then(res => res.json()).then(data => {
    renderSystemInfo(data);
    systemInfoSection.classList.remove('hidden');
  }).catch(() => {});

})();
