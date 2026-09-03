(function() {
  console.log('[LibLens] Initializing...');
  
  if (typeof d3 === 'undefined') {
    console.error('[LibLens] ERROR: D3.js failed to load! Check internet connection or AdBlock.');
    alert('Failed to load D3.js library. Please disable AdBlock or check your internet connection and refresh.');
    return;
  }
  
  let simulation = null;
  let nodesData = [];
  let linksData = [];
  let nodeVisibility = {};
  let selectedNode = null;
  let searchQuery = '';
  let lastSummary = {};
  let lastSystemInfo = {};
  let currentZoom = null;
  const expandedNodes = new Set(['system']);
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

  let viewW = 800, viewH = 600;

  // Named constants (M24)
  const CONST = {
    NODE_RADIUS: 32,
    LINK_DISTANCE: 120,
    CHARGE_STRENGTH: -350,
    COLLIDE_RADIUS_PAD: 15,
    SIM_TICKS: 300,
    GRID_SPACING: 40,
    ZOOM_MIN: 0.1,
    ZOOM_MAX: 5,
    ZOOM_STEP: 1.3,
    SEARCH_DEBOUNCE_MS: 200,
    FOCUS_NODE_PAD_PX: 80
  };

  // Create grid pattern (M25-26)
  function createGrid() {
    let defs = svgEl.select('defs');
    if (defs.empty()) defs = svgEl.append('defs');
    
    let gridPattern = defs.select('#grid-pattern');
    
    if (gridPattern.empty()) {
      gridPattern = defs.append('pattern')
        .attr('id', 'grid-pattern')
        .attr('width', CONST.GRID_SPACING)
        .attr('height', CONST.GRID_SPACING)
        .attr('patternUnits', 'userSpaceOnUse');
      
      gridPattern.append('path')
        .attr('d', `M ${CONST.GRID_SPACING} 0 L 0 0 0 ${CONST.GRID_SPACING}`)
        .attr('fill', 'none')
        .attr('stroke', '#292e42')
        .attr('stroke-width', 0.5)
        .attr('stroke-opacity', 0.6);
    }
    
    svgEl.selectAll('rect.background-rect').remove();
    svgEl.insert('rect', ':first-child')
      .attr('class', 'background-rect')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('fill', 'url(#grid-pattern)');
  }

  // --- groupIntoTree: convert flat nodes+links into d3.hierarchy tree data ---
  function groupIntoTree(allNodes, allEdges) {
    const nodeMap = new Map()
    for (const n of allNodes) {
      if (!n.disabled || n.category === '__root__') {
        nodeMap.set(n.id, { data: n, children: [] })
      }
    }

    // Ensure parent nodes exist in the map even if their category is hidden
    for (const n of allNodes) {
      if (n.parentId) {
        const parentExists = allNodes.some(p => p.id === n.parentId && !p.disabled)
        if (!nodeMap.has(n.parentId) && parentExists) {
          const parentNode = allNodes.find(p => p.id === n.parentId)
          nodeMap.set(n.parentId, { data: parentNode, children: [] })
        }
      }
    }

    let root = null
    for (const link of allEdges) {
      const sourceId = typeof link.source === 'object' ? link.source.id : link.source
      const targetId = typeof link.target === 'object' ? link.target.id : link.target
      if (!nodeMap.has(targetId)) continue
      if (!sourceId || !nodeMap.has(sourceId)) {
        root = nodeMap.get(targetId)
      } else {
        const sourceNode = nodeMap.get(sourceId)
        const targetNode = nodeMap.get(targetId)
        if (sourceNode && targetNode && sourceNode.data.id !== targetNode.data.id) {
          sourceNode.children.push(targetNode)
        }
      }
    }
    return root || nodeMap.get('system')
  }

  // "No libraries found" message (M15)
  let emptyMessageEl = null;
  function showEmptyMessage(show) {
    if (!canvasContainer) return;
    if (show && !emptyMessageEl) {
      const svg = d3.select('#graph-svg');
      emptyMessageEl = svg.append('text')
        .attr('class', 'empty-message')
        .attr('x', viewW / 2)
        .attr('y', viewH / 2)
        .attr('text-anchor','middle')
        .attr('fill','#3d59a1')
        .attr('font-size','14px')
        .attr('dominant-baseline','central');
    }
    if (emptyMessageEl) {
      emptyMessageEl.text(show ? 'No libraries found' : '');
      emptyMessageEl.style('display', show ? 'block' : 'none');
    }
  }

  function updateSvgSize() {
    const container = canvasContainer;
    viewW = Math.max(container.clientWidth, 200);
    viewH = Math.max(container.clientHeight, 200);
    svgEl
      .attr('width', viewW)
      .attr('height', viewH)
      .style('width', '100%')
      .style('height', '100%');
    createGrid();
    
    svgEl.attr('viewBox', `0 0 ${viewW} ${viewH}`);
    
    // M6: Preserve zoom on resize, only center if no transform set
    const currentTransform = d3.zoomTransform(svgEl.node());
    if (!currentTransform || currentTransform.x === 0 && currentTransform.y === 0) {
      svgEl.call(zoomBehavior.transform, d3.zoomIdentity.translate(viewW / 2, viewH / 2).scale(1));
    }
  }

  // Zoom behavior (must be defined before updateSvgSize uses it)
  const zoomBehavior = d3.zoom()
    .scaleExtent([0.1, 5])
    .on('zoom', (event) => {
      graphGroup.attr('transform', event.transform);
      currentZoom = event.transform;
      document.getElementById('zoom-info').textContent = Math.round(event.transform.k * 100) + '%';
    });

  // Initialize size
  updateSvgSize();

  window.addEventListener('resize', () => {
    const oldW = viewW;
    const oldH = viewH;
    updateSvgSize();
    
    // Adjust simulation center if viewport changed significantly
    if (simulation) {
      simulation.force('center', d3.forceCenter(0, 0));
      simulation.alpha(0.1).restart();
    }
  });

  const zoomInitTransform = d3.zoomIdentity.translate(viewW / 2, viewH / 2).scale(1);
  svgEl.call(zoomBehavior, zoomInitTransform);

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

  // Context menu (B3-M20)
  function showContextMenu(event, d) {
    event.preventDefault();
    event.stopPropagation();
    
    let html = '';
    if (d.category !== 'system' && d.category !== 'brew') {
      const installHtml = '<div class="ctx-item" data-action="install" data-node-id="' + d.id + '">Install ' + escapeHtml(d.name) + '</div>';
      html += installHtml;
      const uninstallHtml = '<div class="ctx-item" data-action="uninstall" data-node-id="' + d.id + '">Uninstall ' + escapeHtml(d.name) + '</div>';
      html += uninstallHtml;
    }
    if (d.path) {
      html += '<div class="ctx-item" data-action="copy-path" data-node-id="' + d.id + '">&#x1F4CB Copy Path</div>';
    }
    html += '<div style="height:1px;background:#292e42;margin:3px 8px;"></div>';
    html += '<div class="ctx-item" data-action="focus" data-node-id="' + d.id + '">Focus Node</div>';
    html += '<div class="ctx-item" data-action="toggle" data-node-id="' + d.id + '">' + (d.disabled ? 'Show' : 'Hide') + '</div>';

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

  // Detail panel (M16: pass node data directly)
  function showDetailPanel(d) {
    selectedNode = d;
    document.getElementById('detail-name').textContent = d.name;
    document.getElementById('detail-version').innerHTML = '<strong>Version</strong>: ' + (d.version ? escapeHtml(d.version) : ' Unknown');
    
    if (d.path) {
      document.getElementById('detail-path').innerHTML = '<strong>Path</strong>: <div class="detail-path">' + escapeHtml(d.path) + '</div>';
    } else {
      document.getElementById('detail-path').innerHTML = '<strong>Path</strong>: N/A';
    }
    
    const catLabel = catNameMap[d.category] || d.category;
    document.getElementById('detail-category').innerHTML = '<strong>Category</strong>: ' + escapeHtml(catLabel);

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
    if (!summary || Object.keys(summary).length === 0) { showEmptyMessage(true); return; }
    showEmptyMessage(false);
    
    let total = 0;
    for (const v of Object.values(summary)) total += v;
    if (total === 0) { showEmptyMessage(true); return; }
    
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

  // Main graph rendering - hierarchical tree layout (VS Code file-tree style)
  async function renderGraph(graphData, summary, sysInfo) {
    if (!graphData || !graphData.nodes || graphData.nodes.length === 0) return;

    let isInitialRender = !nodesData || nodesData.length === 0;

    // Keep current zoom position when toggling expand/collapse
    const preserveZoom = !isInitialRender ? (currentZoom || d3.zoomIdentity) : null;

    nodesData = graphData.nodes.map(n => ({ ...n }));

    // Initialize visibility from checkboxes
    const visibleCats = new Set();
    document.querySelectorAll('.filter-item input[type="checkbox"]').forEach(cb => {
      if (cb.checked) visibleCats.add(cb.dataset.cat);
    });

    nodesData.forEach(n => {
      n.disabled = n.category === '__root__' || n.category === '__category__' ? false : !visibleCats.has(n.category);
    });

    // Create links
    linksData = (graphData.edges || []).map(e => ({
      source: typeof e.source === 'object' ? e.source.id : e.source,
      target: typeof e.target === 'object' ? e.target.id : e.target
    }));

    const data = groupIntoTree(nodesData, linksData);
    if (!data) return;

    const nodeIdsToKeep = new Set();
    nodesData.forEach(n => {
      if (n.category === '__root__') nodeIdsToKeep.add(n.id);
      else if (!n.disabled) nodeIdsToKeep.add(n.id);
    });

    const currentRoot = d3.hierarchy(data, d => d.children);
    const treeLayoutCfg = d3.tree().nodeSize([180, 60]).separation((a, b) => {
      if (a.parent === b.parent) return a.depth === 0 ? 1.2 : 0.8;
      return 0.7;
    });
    treeLayoutCfg(currentRoot);

    showEmptyMessage(!data.children || data.children.every(c => !c.descendants().some(n => n.data != null)) || currentRoot.height === 0);

    const w = canvasContainer.clientWidth || viewW;
    const h = canvasContainer.clientHeight || viewH;

    // Compute visible nodes respecting expand/collapse state
    function getVisibleNodes(rootData) {
      const visible = new Set();
      function walk(node) {
        visible.add(String(node.data.id));
        if (!expandedNodes.has(String(node.data.id))) return;
        for (const child of (node.children || [])) walk(child);
      }
      walk(rootData);
      // Always include root
      const rootNode = nodesData.find(n => n.category === '__root__');
      if (rootNode) visible.add(String(rootNode.id));
      return visible;
    }

    const visibleNodeIds = getVisibleNodes(data);

    // Zoom handling: initial render does zoom-to-fit, expand/collapse preserves view
    function applyZoom() {
      if (preserveZoom) {
        svgEl.attr('viewBox', `0 0 ${w} ${h}`);
        graphGroup.attr('transform', preserveZoom);
        currentZoom = preserveZoom;
        document.getElementById('zoom-info').textContent = Math.round(preserveZoom.k * 100) + '%';
      } else {
        let bx1 = Infinity, by1 = Infinity, bx2 = -Infinity, by2 = -Infinity;
        currentRoot.descendants().forEach(n => {
          const r = n.depth === 0 ? 85 : (n.depth >= 3 ? 15 : (n.depth === 2 ? 35 : 60));
          bx1 = Math.min(bx1, n.x - r);
          by1 = Math.min(by1, n.y - r / 2);
          bx2 = Math.max(bx2, n.x + r);
          by2 = Math.max(by2, n.y + r / 2);
        });
        const bw = bx2 - bx1;
        const bh = by2 - by1;
        if (bw === 0 || bh === 0) return;
        const scale = Math.min(w / (bw + 120), h / (bh + 80)) * 0.85;
        const tx = w / 2 - (bx1 + bx2) / 2 * scale + 60;
        const ty = h / 2 - (by1 + by2) / 2 * scale + 40;
        svgEl.attr('viewBox', `0 0 ${w} ${h}`);
        svgEl.transition().duration(500).call(zoomBehavior.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
      }
    }

    // --- Rendering function (used by both initial render and expand/collapse) ---
    function renderFileTree() {
      graphGroup.selectAll('*').remove();

      // Ensure defs exist
      let defs = svgEl.select('defs');
      if (defs.empty()) defs = svgEl.append('defs');
      if (!svgEl.select('#arrowhead').size()) {
        const marker = defs.append('marker')
          .attr('id', 'arrowhead').attr('viewBox', '-0 -5 10 10')
          .attr('refX', 24).attr('refY', 0)
          .attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto');
        marker.append('path').attr('d', 'M0,-5L10,0L0,5').attr('fill', '#414868');
      }

      // Collect visible links
      const nodeMap = new Map();
      currentRoot.descendants().forEach(n => nodeMap.set(String(n.data.id), n));

      const edgeGroup = graphGroup.insert('g', ':first-child').attr('class', 'edges-inner');

      for (const link of linksData) {
        const sId = String(typeof link.source === 'object' ? link.source.id : link.source);
        const tId = String(typeof link.target === 'object' ? link.target.id : link.target);
        if (!visibleNodeIds.has(sId)) continue;
        if (!expandedNodes.has(sId) && nodeMap.has(tId) && nodeMap.get(tId).depth > currentRoot.depth + 1) continue;

        const sNode = nodeMap.get(sId);
        const tNode = nodeMap.get(tId);
        if (!sNode || !tNode) continue;

        // Determine link type from original edges
        let linkType = 'package';
        if (sNode.depth < 2 && tNode.depth >= 3) {
          linkType = graphData.edges?.find(e => {
            const es = String(typeof e.source === 'object' ? e.source.id : e.source);
            const et = String(typeof e.target === 'object' ? e.target.id : e.target);
            return es === sNode.data.id && et === tNode.data.id;
          })?.category || linkType;
        }

        if (sNode.depth < 2 && tNode.depth >= 3) {
          const midX = sNode.x + (tNode.x - sNode.x) / 2;
          const d_path = `M${sNode.x},${sNode.y} C${midX},${sNode.y} ${tNode.x - (tNode.x - sNode.x) / 2},${tNode.y} ${tNode.x},${tNode.y}`;
          edgeGroup.append('path')
            .attr('d', d_path).attr('fill', 'none')
            .attr('stroke', linkType === 'hub' ? '#7aa2f7' : linkType === 'subgroup' ? '#545c7e' : '#414868')
            .attr('stroke-width', linkType === 'hub' ? 3 : linkType === 'subgroup' ? 1.5 : 2)
            .attr('stroke-opacity', 0.4).attr('marker-end', 'url(#arrowhead)');
        } else if (sNode.data.isFileNode || tNode.data.isFileNode) {
          const d_path = `M${sNode.x},${sNode.y} L${tNode.x},${tNode.y}`;
          edgeGroup.append('path')
            .attr('d', d_path).attr('fill', 'none')
            .attr('stroke', '#414868').attr('stroke-width', 1.5)
            .attr('stroke-opacity', 0.3);
        }
      }

      // Data join for nodes
      const allDescendants = currentRoot.descendants();
      const nodeGroup = graphGroup.append('g').selectAll('.node-group')
        .data(allDescendants.filter(d => d.data && visibleNodeIds.has(String(d.data.id))), d => String(d.data.id))
        .join('g')
        .attr('class', 'node-group file-tree-node')
        .attr('transform', d => `translate(${d.x},${d.y})`)
        .style('cursor', 'pointer');

      // Root node (system) - L702-728 from original
      const rootNodes = nodeGroup.filter(d => d.depth === 0);
      rootNodes.append('text')
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'central').attr('font-size', '24px').text('\uD83D\uDCC2');
      rootNodes.append('rect')
        .attr('x', -65).attr('y', -30).attr('width', 130).attr('height', 60)
        .attr('rx', 8).attr('ry', 8).attr('fill', '#2a2f42')
        .attr('stroke', '#7aa2f7').attr('stroke-width', 1.5).attr('stroke-opacity', 0.6);
      rootNodes.append('text')
        .attr('class', 'node-label').attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
        .attr('font-size', '13px').attr('font-weight', 'bold').attr('fill', '#7aa2f7').attr('y', 10)
        .text(d => d.data.name);

      // Category hub nodes - L730-794 from original (FIXED chevron per node)
      const catNodes = nodeGroup.filter(d => d.data.isCategoryHub);
      catNodes.append('text')
        .attr('class', 'chevron-icon').attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
        .attr('font-size', '10px').attr('fill', '#545c7e').attr('x', -38).attr('y', -2)
        .text(d => expandedNodes.has(String(d.data.id)) ? '\u25BC' : '\u25B6'); // FIXED: per-node chevron
      catNodes.append('text')
        .attr('class', 'folder-icon').attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
        .attr('font-size', '16px').attr('x', -24).attr('y', -2)
        .text(d => d.data.icon || '\uD83D\uDCC1');
      catNodes.append('rect')
        .attr('x', -95).attr('y', -18).attr('width', 190).attr('height', 36)
        .attr('rx', 6).attr('ry', 6)
        .attr('fill', d => ({ nodejs: '#2d2b55', python: '#1a3a3a', ruby: '#3a1a2e', brew: '#3a2e1a', composer: '#3e1a1f', system: '#2a2a4a', other: '#3a3020' }[d.data.category] || '#2d2b55'))
        .attr('stroke', d => ({ nodejs: '#E3DDAA', python: '#56B4BD', ruby: '#CC6699', brew: '#FFD6A1', composer: '#F78497', system: '#C9CBFF', other: '#E5C38C' }[d.data.category] || '#E3DDAA'))
        .attr('stroke-width', 1.5);
      catNodes.append('text')
        .attr('class', 'node-label').attr('text-anchor', 'start').attr('dominant-baseline', 'central')
        .attr('font-size', '12px').attr('font-weight', 'bold')
        .attr('fill', d => ({ nodejs: '#E3DDAA', python: '#56B4BD', ruby: '#CC6699', brew: '#FFD6A1', composer: '#F78497', system: '#C9CBFF', other: '#fff' }[d.data.category] || '#fff'))
        .attr('x', -8).attr('y', -4)
        .text(d => d.data.name.length > 12 ? d.data.name.substring(0, 12) + '\u2026' : d.data.name);
      catNodes.append('text')
        .attr('class', 'node-label').attr('text-anchor', 'end').attr('dominant-baseline', 'central')
        .attr('font-size', '9px').attr('fill', '#545c7e').attr('x', 88).attr('y', -2)
        .text(d => d.data.count + ' libs');

      // Package and subgroup nodes - L796-875 from original
      const pkgNodes = nodeGroup.filter(d => d.data.isFileNode || d.data.isSubGroup);
      for (const pkgEl of pkgNodes.nodes()) {
        const d = d3.select(pkgEl).datum();
        if (!d) continue;
        const hasChildren = !!nodesData.find(n => n.parentId === d.data.id) || (d.children && d.children.length > 0);
        const nodeWidth = hasChildren ? 370 : 70;
        const offsetX = hasChildren ? -185 : -35;

        // Chevron for subgroups with per-node chevron state
        if (hasChildren) {
          pkgEl.appendChild((function(dd) {
            const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            t.setAttribute('class', 'chevron-icon');
            t.setAttribute('text-anchor', 'middle');
            t.setAttribute('dominant-baseline', 'central');
            t.setAttribute('font-size', '9px');
            t.setAttribute('fill', '#545c7e');
            t.setAttribute('x', -180);
            t.setAttribute('y', -1);
            t.textContent = expandedNodes.has(String(dd.data.id)) ? '\u25BC' : '\u25B6'; // FIXED: per-node chevron
            return t;
          })(d));

          pkgEl.appendChild((function() {
            const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            r.setAttribute('x', offsetX).setAttribute('y', -12);
            r.setAttribute('width', 370).setAttribute('height', 24);
            r.setAttribute('rx', 4).setAttribute('ry', 4);
            r.setAttribute('fill', '#1a2035');
            return r;
          })());
        } else {
          pkgEl.appendChild((function(dd) {
            const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            t.setAttribute('text-anchor', 'middle').setAttribute('dominant-baseline', 'central');
            t.setAttribute('font-size', '12px').setAttribute('x', -20).setAttribute('y', -1);
            t.textContent = dd.data?.pkgIcon || '\uD83D\uDCC4';
            return t;
          })(d));

          pkgEl.appendChild((function(dd) {
            const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            t.setAttribute('class', 'node-label file-name');
            t.setAttribute('text-anchor', 'start').setAttribute('dominant-baseline', 'central');
            t.setAttribute('font-size', '11px').setAttribute('fill', '#a9b1d6');
            t.setAttribute('x', -5).setAttribute('y', -2);
            const name = dd.data?.name || '';
            t.textContent = name.length > 28 ? name.substring(0, 25) + '\u2026' : name;
            return t;
          })(d));

          pkgEl.appendChild((function(dd) {
            const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            t.setAttribute('class', 'node-label version-label');
            t.setAttribute('text-anchor', 'end').setAttribute('dominant-baseline', 'central');
            t.setAttribute('font-size', '9px').setAttribute('fill', '#545c7e');
            t.setAttribute('x', 32).setAttribute('y', -2);
            t.textContent = dd.data?.version ? `v${dd.data.version}` : '';
            return t;
          })(d));

          const rectBackground = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          rectBackground.setAttribute('class', 'pkg-bg-rect');
          rectBackground.setAttribute('x', offsetX).setAttribute('y', -12);
          rectBackground.setAttribute('width', nodeWidth).setAttribute('height', 24);
          rectBackground.setAttribute('rx', 4).setAttribute('ry', 4);
          rectBackground.setAttribute('fill', '#1f2435');
          rectBackground.setAttribute('stroke', '#292e42');
          rectBackground.setAttribute('stroke-width', 0.5);
          pkgEl.appendChild(rectBackground);

          const leftBorder = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          leftBorder.setAttribute('x', offsetX).setAttribute('y', -12);
          leftBorder.setAttribute('width', 3).setAttribute('height', 24);
          leftBorder.setAttribute('rx', 1);
          leftBorder.setAttribute('fill', d.color || '#7aa2f7'); // Colored left border
          pkgEl.appendChild(leftBorder);
        }
      }

      // Unified click handler for expand/collapse (FIXED: single handler on nodeGroup)
      nodeGroup.on('click', function(event, d) {
        event.stopPropagation();
        if (!expandedNodes.has(String(d.data.id)) || d.children?.length) return;
        if (expandedNodes.has(String(d.data.id))) expandedNodes.delete(String(d.data.id));
        else expandedNodes.add(String(d.data.id));
        onExpandCollapseChanged();
      });

      // Tooltip hover (FIXED: consistent with unified nodeGroup handler)
      nodeGroup.filter(d => d.data.isFileNode)
        .on('mouseenter', function(event, d) { showTooltip(event, d.data); })
        .on('mouseleave', () => hideTooltip());

      // Hover on package background rects (FIXED: consistent on new DOM elements)
      graphGroup.selectAll('.pkg-bg-rect')
        .on('mouseenter', function() { d3.select(this).transition().duration(100).attr('fill', '#2a3045'); })
        .on('mouseleave', function() { d3.select(this).transition().duration(100).attr('fill', '#1f2435'); });

      return nodeGroup;
    }

    // --- Entry point for initial render vs. re-render ---
    function onExpandCollapseChanged() {
      applyZoom(); // Preserve current zoom, don't reset to fit
      renderFileTree();
    }

    if (isInitialRender) {
      applyZoom();
      renderFileTree();
      setTimeout(() => {
        progressFill.style.width = '100%';
        if (progressTextEl) {
          progressTextEl.textContent = 'Scan complete!';
          setTimeout(() => {
            if (progressBg) progressBg.classList.add('hidden');
            if (progressTextEl) progressTextEl.classList.add('hidden');
          }, 1500);
        }
      }, 50);
    } else {
      onExpandCollapseChanged();
    }

    // Store for later use
    lastSummary = summary || {};
    lastSystemInfo = sysInfo || {};
    nodesData.forEach(n => n.disabled = false);

    // Update button state
    btnScan.disabled = false;
    btnScan.textContent = 'Scan Libraries';

    return true; // signal success for callers that check
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

  function recenterView() {
    const w = canvasContainer.clientWidth;
    const h = canvasContainer.clientHeight;
    viewW = w;
    viewH = h;
    svgEl.attr('width', w).attr('height', h);
    svgEl.transition().duration(750).call(zoomBehavior.transform, d3.zoomIdentity.translate(w/2,h/2).scale(1));
  }

  // Start scan
  async function startScan () {
    btnScan.disabled = true;
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
      await renderGraph(data.graph, data.summary, data.systemInfo);
    } catch(err) {
      console.error('Scan failed:', err);
      progressTextEl.textContent = 'Error: ' + (err?.message || String(err) || 'Unknown');

      if (progressBg) progressBg.classList.add('hidden');
      if (progressTextEl) progressTextEl.classList.add('hidden');
      
      btnScan.disabled = false;
      btnScan.textContent = 'Scan Libraries';
    }
  };

  // Event listeners
  btnScan.addEventListener('click', startScan);
  btnRecenter.addEventListener('click', recenterView);
  
  zoomInBtn.addEventListener('click', () => { svgEl.transition().duration(200).call(zoomBehavior.scaleBy, CONST.ZOOM_STEP) });
  zoomOutBtn.addEventListener('click', () => { svgEl.transition().duration(200).call(zoomBehavior.scaleBy, 1 / CONST.ZOOM_STEP) });

  // Close detail panel
  document.getElementById('close-detail').addEventListener('click', hideDetailPanel);
  
  document.getElementById('btn-install').addEventListener('click', async function() {
    if (!selectedNode) return;
    
    const name = selectedNode.name;
    try {
      const res = await fetch('/api/install/' + encodeURIComponent(name));
      const data = await res.json();
      
      let msg = "Install command:\n";
      msg += data.command || '(install not available for platform)';
    
      alert(msg);
    } catch(e) {
      console.error('Install error:', e);
      alert('Failed to get install command');
    }
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
    
    let d;
    const nodeDataId = actionEl.dataset.nodeId || actionEl.getAttribute('data-node-id');
    if (nodeDataId) {
      d = nodesData.find(n => n.id === nodeDataId);
    }
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
      if (d.x !== undefined && d.y !== undefined) {
        const width = canvasContainer.clientWidth;
        const height = canvasContainer.clientHeight;
        svgEl.transition().duration(500).call(zoomBehavior.transform, d3.zoomIdentity.translate(width/2 - d.x, height/2 - d.y).scale(currentZoom?.k || 1));
      }
    } else if (action === 'toggle') {
      d.disabled = !d.disabled;
      await renderGraph({ nodes: nodesData, edges: linksData }, lastSummary, lastSystemInfo);
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

  let searchDebounceTimer = null;

  searchInput.addEventListener('input', function(event) {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      searchQuery = event.target.value.trim().toLowerCase();
      renderGraph({ nodes: nodesData, edges: linksData }, lastSummary, lastSystemInfo);
    }, CONST.SEARCH_DEBOUNCE_MS);
  });

  // Filter checkboxes
  document.querySelectorAll('.filter-item input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', function() {
      nodeVisibility[this.dataset.cat] = this.checked;
      const visibleCats = new Set();
      document.querySelectorAll('.filter-item input[type="checkbox"]:checked').forEach(cbx => {
        visibleCats.add(cbx.dataset.cat);
      });

      nodesData.forEach(n => n.disabled = !visibleCats.has(n.category));
      renderGraph({ nodes: nodesData, edges: linksData }, lastSummary, lastSystemInfo);
    });
  });

  // Update system info immediately
  fetch('/api/info').then(res => res.json()).then(data => {
    renderSystemInfo(data);
    systemInfoSection.classList.remove('hidden');
  }).catch(() => {});

  // Sidebar toggle for mobile
  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebar-toggle');
  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
    });
  }

})();
