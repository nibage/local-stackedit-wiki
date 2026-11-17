/* Offline read-only JSON Canvas 1.0 graph. No dynamic HTML, remote URLs or writes. */
(function (global) {
  'use strict';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const PRESET = Object.freeze({
    '1':'#d45c63','2':'#d28a40','3':'#c6ad48',
    '4':'#4eaa80','5':'#4e9bb9','6':'#9c7cc9'
  });
  const LIMIT_NODES = 400, LIMIT_EDGES = 1000, PAD = 90;
  const VALID_SIDES = new Set(['top','right','bottom','left']);
  let instanceId = 0;

  function safeColor(value) {
    if (typeof value !== 'string') return '#718096';
    return PRESET[value] || (/^#[0-9a-f]{6}$/i.test(value) || /^#[0-9a-f]{3}$/i.test(value) ? value : '#718096');
  }
  function dimension(value, fallback, minimum, maximum) {
    return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
  }
  function cleanGraph(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid JSON Canvas root.');
    const inputNodes = Array.isArray(data.nodes) ? data.nodes : [];
    const inputEdges = Array.isArray(data.edges) ? data.edges : [];
    if (inputNodes.length > LIMIT_NODES || inputEdges.length > LIMIT_EDGES) {
      throw new Error('Canvas exceeds the safe preview limit of 400 nodes / 1000 edges.');
    }
    const nodes = [], byId = new Map();
    let skipped = 0;
    inputNodes.forEach(raw => {
      if (!raw || typeof raw !== 'object' || !['text','file','link','group'].includes(raw.type) ||
          typeof raw.id !== 'string' || !raw.id || byId.has(raw.id) ||
          ![raw.x,raw.y,raw.width,raw.height].every(Number.isFinite) ||
          raw.width <= 0 || raw.height <= 0) { skipped++; return; }
      const node = {
        id:raw.id, type:raw.type,
        x:dimension(raw.x, 0, -100000, 100000), y:dimension(raw.y, 0, -100000, 100000),
        width:dimension(raw.width, 250, 45, 2400), height:dimension(raw.height, 140, 35, 2400),
        color:safeColor(raw.color),
        text:typeof raw.text === 'string' ? raw.text.slice(0,20000) : '',
        file:typeof raw.file === 'string' ? raw.file.slice(0,800) : '',
        url:typeof raw.url === 'string' ? raw.url.slice(0,800) : '',
        label:typeof raw.label === 'string' ? raw.label.slice(0,200) : '',
        background:typeof raw.background === 'string' ? raw.background.slice(0,800) : ''
      };
      nodes.push(node); byId.set(node.id,node);
    });
    const edges = [];
    inputEdges.forEach(edge => {
      if (!edge || typeof edge !== 'object' || !byId.has(edge.fromNode) || !byId.has(edge.toNode)) {
        skipped++; return;
      }
      edges.push({
        from:byId.get(edge.fromNode), to:byId.get(edge.toNode),
        fromSide:VALID_SIDES.has(edge.fromSide) ? edge.fromSide : null,
        toSide:VALID_SIDES.has(edge.toSide) ? edge.toSide : null,
        fromArrow:edge.fromEnd === 'arrow',
        toArrow:edge.toEnd !== 'none',
        label:typeof edge.label === 'string' ? edge.label.slice(0,250) : '',
        color:safeColor(edge.color)
      });
    });
    return { nodes, edges, skipped, originals:{nodes:inputNodes.length, edges:inputEdges.length} };
  }
  function create(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = String(text);
    return el;
  }
  function svgElement(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs || {}).forEach(([name,value]) => node.setAttribute(name, String(value)));
    return node;
  }
  function canonicalPath(input) {
    // Canvas file paths are relative to the vault root, not the canvas itself.
    if (typeof input !== 'string' || !input || input.length > 800) return null;
    const path = input.replace(/\\/g,'/');
    if (path.startsWith('/') || path.includes('?') || path.includes('#') ||
        Array.from(path).some(char => char.charCodeAt(0) < 32) || /^[a-z]+:/i.test(path)) return null;
    const parts = path.split('/');
    if (parts.some(part => !part || part === '.' || part === '..')) return null;
    return parts.join('/');
  }
  function sideFor(from, to) {
    const dx = to.x + to.width/2 - (from.x + from.width/2);
    const dy = to.y + to.height/2 - (from.y + from.height/2);
    return Math.abs(dx) > Math.abs(dy) ? (dx >= 0 ? 'right':'left') : (dy >= 0 ? 'bottom':'top');
  }
  function connector(node, side) {
    const midX = node.x + node.width/2, midY = node.y + node.height/2;
    switch (side) {
      case 'top': return {x:midX,y:node.y,dx:0,dy:-1};
      case 'right': return {x:node.x+node.width,y:midY,dx:1,dy:0};
      case 'bottom': return {x:midX,y:node.y+node.height,dx:0,dy:1};
      default: return {x:node.x,y:midY,dx:-1,dy:0};
    }
  }

  function renderSafeMarkdown(target, markdown) {
    if (!global.marked || !global.LocalWikiRender?.sanitize) {
      target.textContent = markdown;
      return;
    }
    try {
      // Reuse the wiki's conservative Markdown sanitizer. Canvas cards are inert
      // previews: links do not navigate and embedded images never load remotely.
      const html = global.marked.parse(markdown,{gfm:true,breaks:true,headerIds:false,mangle:false});
      const fragment = global.LocalWikiRender.sanitize(html);
      fragment.querySelectorAll('a').forEach(link=>{
        const label = create('span','canvas-inert-link');
        while (link.firstChild) label.append(link.firstChild);
        link.replaceWith(label);
      });
      fragment.querySelectorAll('img').forEach(image=>{
        image.replaceWith(create('span','canvas-inert-link','[image reference]'));
      });
      target.append(fragment);
    } catch (_) { target.textContent = markdown; }
  }

  function render(input, options = {}) {
    const model = cleanGraph(input);
    const root = create('div','wiki-canvas-viewer');
    const info = create('p','canvas-summary',
      'JSON Canvas (read-only): '+model.originals.nodes+' nodes, '+model.originals.edges+' edges.');
    root.append(info);
    if (model.skipped) root.append(create('p','canvas-warning',
      model.skipped+' invalid or dangling elements were skipped without changing the file.'));
    const bar = create('div','canvas-controls');
    const viewport = create('div','canvas-viewport');
    viewport.tabIndex = 0;
    viewport.setAttribute('role','region');
    viewport.setAttribute('aria-label','Read-only canvas: drag empty space to pan; use toolbar buttons to zoom');
    const board = create('div','canvas-board');
    const connections = svgElement('svg',{class:'canvas-connections',xmlns:SVG_NS,'aria-hidden':'true'});
    const layers = create('div','canvas-cards');
    board.append(connections,layers);
    viewport.append(board);
    root.append(bar,viewport);
    if (!model.nodes.length) {
      viewport.append(create('p','canvas-empty','This canvas has no supported nodes.'));
    }
    // Compute bounding box across actual nodes, including negative coordinates.
    const smallestX = model.nodes.length ? Math.min(...model.nodes.map(n=>n.x)) : 0;
    const smallestY = model.nodes.length ? Math.min(...model.nodes.map(n=>n.y)) : 0;
    const maxX = model.nodes.length ? Math.max(...model.nodes.map(n=>n.x+n.width)) : 650;
    const maxY = model.nodes.length ? Math.max(...model.nodes.map(n=>n.y+n.height)) : 370;
    const width = Math.max(300, maxX-smallestX+2*PAD);
    const height = Math.max(220, maxY-smallestY+2*PAD);
    const dx = PAD-smallestX, dy = PAD-smallestY;
    const lookup = new Map();
    model.nodes.forEach(node => lookup.set(node.id,{...node,x:node.x+dx,y:node.y+dy}));
    board.style.width = width+'px'; board.style.height = height+'px';
    connections.setAttribute('width', String(width)); connections.setAttribute('height', String(height));
    connections.setAttribute('viewBox','0 0 '+width+' '+height);
    const defs = svgElement('defs');connections.append(defs);
    const prefix = 'wiki-canvas-'+(++instanceId)+'-';
    model.edges.forEach((edge,i)=>{
      const a = lookup.get(edge.from.id), b = lookup.get(edge.to.id);
      const aSide = edge.fromSide || sideFor(a,b);
      const bSide = edge.toSide || sideFor(b,a);
      const from = connector(a,aSide), to = connector(b,bSide);
      const distance = Math.hypot(from.x-to.x,from.y-to.y);
      const bend = Math.max(35,Math.min(180,distance*.38));
      const path = svgElement('path',{
        d:'M '+from.x+' '+from.y+' C '+(from.x+from.dx*bend)+' '+(from.y+from.dy*bend)+
          ' '+(to.x+to.dx*bend)+' '+(to.y+to.dy*bend)+' '+to.x+' '+to.y,
        fill:'none',stroke:edge.color,'stroke-width':2.5,'stroke-linecap':'round'
      });
      if (edge.toArrow || edge.fromArrow) {
        const id = prefix+'arrow-'+i;
        const marker = svgElement('marker',{id,viewBox:'0 0 10 10',refX:9,refY:5,
          markerWidth:6,markerHeight:6,orient:'auto-start-reverse'});
        marker.append(svgElement('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:edge.color}));
        defs.append(marker);
        if (edge.toArrow) path.setAttribute('marker-end','url(#'+id+')');
        if (edge.fromArrow) path.setAttribute('marker-start','url(#'+id+')');
      }
      connections.append(path);
      if (edge.label) {
        const label = svgElement('text',{
          x:(from.x+to.x)/2,y:(from.y+to.y)/2-9,'text-anchor':'middle',
          class:'canvas-edge-label'
        });
        label.textContent = edge.label;
        connections.append(label);
      }
    });
    const urls = [];
    let disposed = false;
    model.nodes.forEach(node=>{
      const p=lookup.get(node.id);
      const card=create('div','canvas-node');
      card.dataset.kind = node.type;
      card.style.left=p.x+'px'; card.style.top=p.y+'px';
      card.style.width=p.width+'px'; card.style.height=p.height+'px';
      card.style.setProperty('--canvas-accent',node.color);
      if (node.type === 'text') {
        const body = create('div','canvas-node-content');
        renderSafeMarkdown(body,node.text);
        card.append(body);
      } else if (node.type === 'group') {
        card.append(create('div','canvas-node-group-title',node.label || 'Group'));
      } else if (node.type === 'link') {
        card.append(create('div','canvas-node-kind','External link (not opened)'));
        card.append(create('div','canvas-node-content',node.url));
      } else if (node.type === 'file') {
        card.append(create('div','canvas-node-kind','Local file'));
        card.append(create('div','canvas-node-content',node.file));
        const path=canonicalPath(node.file);
        if (path && ['png','jpg','jpeg','gif','webp','bmp','avif','svg'].includes(path.split('.').pop().toLowerCase()) &&
            typeof options.readImage === 'function') {
          Promise.resolve().then(()=>options.readImage(path)).then(file=>{
            if (disposed || !file || !card.isConnected) return;
            const url=URL.createObjectURL(file); urls.push(url);
            const picture=create('img','canvas-node-image');
            picture.alt=path;picture.src=url;
            card.append(picture);
          }).catch(()=>{ /* a missing image is already represented by its file path */ });
        } else if (path && (/\.md$|\.markdown$/i.test(path)) && typeof options.readNote === 'function') {
          const excerpt=create('div','canvas-note-excerpt');
          excerpt.setAttribute('aria-label','Read-only Markdown note excerpt');
          excerpt.append(create('p','canvas-note-loading','Loading note excerpt…'));
          card.append(excerpt);
          Promise.resolve().then(()=>options.readNote(path)).then(source=>{
            if (disposed || !card.isConnected) return;
            excerpt.replaceChildren();
            if (typeof source !== 'string') {
              excerpt.append(create('span','canvas-note-missing','Note unavailable'));return;
            }
            const content=source.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
            const stripped=content.startsWith('---\n')?
              content.replace(/^---\n[\s\S]{0,10000}?\n(?:---|\.\.\.)\n/,''):content;
            renderSafeMarkdown(excerpt,stripped.slice(0,3500));
            if (stripped.length>3500) excerpt.append(create('p','canvas-note-truncated','Excerpt truncated'));
          }).catch(()=>{
            if (!disposed && card.isConnected)
              excerpt.replaceChildren(create('span','canvas-note-missing','Unable to read note'));
          });
        }
      }
      layers.append(card);
    });
    const state = {scale:1, x:0, y:0};
    function apply() {
      board.style.transform='translate('+state.x+'px,'+state.y+'px) scale('+state.scale+')';
      percent.textContent=Math.round(state.scale*100)+'%';
    }
    function zoom(factor) {
      const next = Math.max(.15,Math.min(3,state.scale*factor));
      const cx=viewport.clientWidth/2,cy=viewport.clientHeight/2;
      const worldX=(cx-state.x)/state.scale,worldY=(cy-state.y)/state.scale;
      state.scale=next;state.x=cx-worldX*next;state.y=cy-worldY*next;apply();
    }
    function fit() {
      const vw=viewport.clientWidth||800,vh=viewport.clientHeight||440;
      state.scale=Math.max(.15,Math.min(2,Math.min((vw-28)/width,(vh-28)/height)));
      state.x=(vw-width*state.scale)/2;state.y=(vh-height*state.scale)/2;apply();
    }
    function button(label,desc,action) {
      const el=create('button','canvas-control',label);el.type='button';el.title=desc;
      el.addEventListener('click',action);bar.append(el);return el;
    }
    button('−','Zoom out',()=>zoom(1/1.25));
    button('+','Zoom in',()=>zoom(1.25));
    button('Fit','Fit graph to the viewport',fit);
    button('100%','View graph at actual size',()=>{
      state.scale=1;state.x=18;state.y=18;apply();
    });
    const percent=create('span','canvas-zoom-status','100%');bar.append(percent);
    bar.append(create('span','canvas-hint','Drag empty space to pan · Ctrl+wheel to zoom · read-only'));
    let drag=null;
    viewport.addEventListener('pointerdown',e=>{
      if (e.button!==0 || e.target.closest('.canvas-node')) return;
      e.preventDefault();
      drag={id:e.pointerId,x:e.clientX,y:e.clientY,startX:state.x,startY:state.y};
      viewport.setPointerCapture(e.pointerId);
    });
    viewport.addEventListener('pointermove',e=>{
      if (!drag || drag.id!==e.pointerId) return;
      state.x=drag.startX+e.clientX-drag.x;
      state.y=drag.startY+e.clientY-drag.y;apply();
    });
    function endDrag(e){if (!drag || drag.id!==e.pointerId) return;
      drag=null;
      if (viewport.hasPointerCapture(e.pointerId)) viewport.releasePointerCapture(e.pointerId);
    }
    viewport.addEventListener('pointerup',endDrag);
    viewport.addEventListener('pointercancel',endDrag);
    viewport.addEventListener('wheel',e=>{
      if (!e.ctrlKey) return;
      e.preventDefault();zoom(e.deltaY<0?1.12:1/1.12);
    },{passive:false});
    viewport.addEventListener('keydown',e=>{
      const keys={ArrowLeft:[35,0],ArrowRight:[-35,0],ArrowUp:[0,35],ArrowDown:[0,-35]};
      if (keys[e.key]) {e.preventDefault();state.x+=keys[e.key][0];state.y+=keys[e.key][1];apply();}
      else if (e.key==='+' || e.key==='=') {e.preventDefault();zoom(1.25);}
      else if (e.key==='-') {e.preventDefault();zoom(1/1.25);}
      else if (e.key==='0' || e.key.toLowerCase()==='f') {e.preventDefault();fit();}
    });
    root.dispose=()=>{disposed=true;urls.forEach(url=>URL.revokeObjectURL(url));urls.length=0;};
    requestAnimationFrame(()=>{if (!disposed && root.isConnected) fit();});
    return root;
  }
  global.LocalWikiCanvas={render,cleanGraph,canonicalPath,safeColor};
})(window);
