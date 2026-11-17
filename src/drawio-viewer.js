/* Secure, offline, read-only diagrams.net XML viewer.
 * Handles mxGraphModel and compressed/uncompressed multi-page mxfile diagrams.
 * Deliberately renders core shapes only; never executes styles, links, HTML or URLs.
 */
(function (global) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const MAX_SOURCE = 2 * 1024 * 1024;
  const MAX_XML = 4 * 1024 * 1024;
  const MAX_PAGES = 32;
  const MAX_CELLS = 1200;
  const MAX_COORD = 100000;
  const MARGIN = 70;
  const SHAPES = new Set(['rectangle','ellipse','rhombus','diamond','hexagon','triangle','parallelogram',
    'cylinder','cloud','actor','text','roundRect','document']);
  const ELLIPSE = new Set(['ellipse','cloud','actor']);
  const HEAVY = new Set(['swimlane','table','image','stencil','mxgraph','uml','orgchart','mockup','bpmn']);
  let uid = 0;

  function node(tag, attributes = {}, content) {
    const element = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined && value !== null) element.setAttribute(key, String(value));
    }
    if (content !== undefined) element.textContent = String(content);
    return element;
  }
  function html(tag, className, content) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (content !== undefined) el.textContent = String(content);
    return el;
  }
  function requireSafeXml(xml) {
    if (typeof xml !== 'string' || xml.length > MAX_XML ||
        /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(xml))
      throw new Error('Invalid or unsafe diagram XML (size / DTD limit).');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('The diagram XML is malformed.');
    return doc.documentElement;
  }
  function parseFile(source) {
    if (typeof source !== 'string' || source.length > MAX_SOURCE)
      throw new Error('The .drawio file exceeds the 2 MB preview limit.');
    const root = requireSafeXml(source);
    if (root.localName === 'mxGraphModel') {
      return [{name:'Diagram', id:'single', xml:new XMLSerializer().serializeToString(root), compressed:false}];
    }
    if (root.localName !== 'mxfile') throw new Error('Expected mxfile or mxGraphModel XML.');
    const children = Array.from(root.children).filter(child=>child.localName === 'diagram');
    if (!children.length) throw new Error('No diagram pages were found.');
    if (children.length > MAX_PAGES) throw new Error('Preview limited to 32 diagram pages.');
    return children.map((page, i) => {
      const raw = Array.from(page.children).find(child=>child.localName === 'mxGraphModel');
      if (raw) return {
        id:page.getAttribute('id') || 'p'+i, name:page.getAttribute('name') || 'Page '+(i+1),
        xml:new XMLSerializer().serializeToString(raw), compressed:false
      };
      const encoded = page.textContent.trim();
      if (!encoded || encoded.length>MAX_SOURCE || !/^[a-z0-9+/=\s]+$/i.test(encoded))
        throw new Error('Invalid compressed page '+(i+1)+'.');
      return {id:page.getAttribute('id') || 'p'+i,name:page.getAttribute('name') || 'Page '+(i+1),
        encoded:encoded.replace(/\s/g,''),compressed:true};
    });
  }
  async function decodePage(page) {
    if (!page.compressed) return requireSafeXml(page.xml);
    if (!global.DecompressionStream) throw new Error('This browser does not support raw DEFLATE decompression.');
    const binary = atob(page.encoded);
    const input = Uint8Array.from(binary, char=>char.charCodeAt(0));
    let stream;
    try { stream = new Blob([input]).stream().pipeThrough(new DecompressionStream('deflate-raw')); }
    catch (_) { throw new Error('Raw DEFLATE is unsupported in this browser.'); }
    const reader = stream.getReader();
    const output = [];
    let total = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > MAX_XML) {
          void reader.cancel();
          throw new Error('Decompressed page exceeds the 4 MB safety limit.');
        }
        output.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const block of output) {bytes.set(block,offset);offset+=block.length;}
    let encoded;
    try {encoded = new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
    catch (_) {throw new Error('Compressed XML has invalid UTF-8.');}
    let xml;
    try {xml = decodeURIComponent(encoded);}
    catch (_) {throw new Error('Compressed XML has invalid URL encoding.');}
    return requireSafeXml(xml);
  }
  function styleMap(source) {
    const style = Object.create(null);
    for (const part of String(source||'').slice(0,5000).split(';')) {
      const at = part.indexOf('=');
      if (at > 0) {
        const key = part.slice(0,at);
        if (/^[a-zA-Z][\w.-]{0,50}$/.test(key)) style[key] = part.slice(at+1).slice(0,200);
      } else if (part && !style.shape && /^[a-zA-Z][\w.-]{0,50}$/.test(part)) {
        style.shape = part;
      }
    }
    return style;
  }
  function color(value,fallback) {
    if (typeof value !== 'string') return fallback;
    if (value === 'none') return 'none';
    if (/^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(value)) return value;
    return fallback;
  }
  function number(value,fallback=0,min=-MAX_COORD,max=MAX_COORD) {
    const x=Number(value);
    return Number.isFinite(x)?Math.min(max,Math.max(min,x)):fallback;
  }
  function label(value) {
    let text = String(value||'').slice(0,3000);
    // Convert common rich text formatting to inert text before setting textContent.
    text=text.replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi,'\n')
      .replace(/<[^>]*>/g,' ')
      .replace(/&#(x[\da-f]+|\d+);|&(amp|lt|gt|quot|apos|nbsp);/gi,(match,num,entity)=>{
        if (num) {
          const n=num[0].toLowerCase()==='x'?parseInt(num.slice(1),16):parseInt(num,10);
          return Number.isFinite(n)&&n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?
            String.fromCodePoint(n):' ';
        }
        return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[entity.toLowerCase()]||' ';
      });
    return text.replace(/\r/g,'').replace(/[ \t]+/g,' ').trim().slice(0,1000);
  }
  function modelFrom(root) {
    if (root.localName!=='mxGraphModel') throw new Error('Expected mxGraphModel inside page.');
    const layer = Array.from(root.children).find(c=>c.localName==='root');
    if (!layer) throw new Error('Missing mxGraphModel/root.');
    const nodes=[],edges=[],positions=new Map();
    const wrappers=Array.from(layer.children);
    if (wrappers.length>MAX_CELLS) throw new Error('The page exceeds 1200 diagram elements.');
    for(const item of wrappers) {
      const cell=item.localName==='mxCell'?item:
        Array.from(item.children).find(c=>c.localName==='mxCell');
      if (!cell) continue;
      const id=cell.getAttribute('id');
      if (!id || positions.has(id)) continue;
      const geo=Array.from(cell.children).find(e=>e.localName==='mxGeometry');
      const rawStyle=styleMap(cell.getAttribute('style'));
      const entry={
        id, parent:cell.getAttribute('parent'),
        vertex:cell.getAttribute('vertex')==='1',edge:cell.getAttribute('edge')==='1',
        source:cell.getAttribute('source'),target:cell.getAttribute('target'),
        value:label(item.getAttribute('label')||item.getAttribute('value')||cell.getAttribute('value')),
        style:rawStyle, geo, x:number(geo?.getAttribute('x')),y:number(geo?.getAttribute('y')),
        width:number(geo?.getAttribute('width'),0,0,4000),
        height:number(geo?.getAttribute('height'),0,0,4000)
      };
      positions.set(id,entry);
      if(entry.vertex) nodes.push(entry);
      if(entry.edge) edges.push(entry);
    }
    let complex=0;
    function absolute(entry, stack=new Set()) {
      if(entry.ax!==undefined) return;
      if(stack.has(entry.id)) return;
      stack.add(entry.id);
      let px=0,py=0;
      const parent=positions.get(entry.parent);
      if(parent && parent.vertex && !stack.has(parent.id)){
        absolute(parent,stack);
        px=parent.ax??0;py=parent.ay??0;
      }
      entry.ax=number(entry.x+px);entry.ay=number(entry.y+py);
      stack.delete(entry.id);
    }
    nodes.forEach(n=>absolute(n));
    for(const n of nodes) {
      const shape=n.style.shape||'rectangle';
      if(!['rectangle','ellipse','rhombus','diamond','hexagon','triangle','parallelogram','text'].includes(shape) || n.style.image || /^(?:mxgraph|stencil)/.test(shape)) complex++;
    }
    const bounds = nodes.length ? {
      left:Math.min(...nodes.map(n=>n.ax)),
      top:Math.min(...nodes.map(n=>n.ay)),
      right:Math.max(...nodes.map(n=>n.ax+n.width)),
      bottom:Math.max(...nodes.map(n=>n.ay+n.height))
    } : {left:0,top:0,right:700,bottom:420};
    return {nodes,edges,positions,complex,bounds};
  }
  function drawModel(model) {
    const {bounds} = model;
    const width=Math.max(340,bounds.right-bounds.left+2*MARGIN);
    const height=Math.max(240,bounds.bottom-bounds.top+2*MARGIN);
    const dx=MARGIN-bounds.left,dy=MARGIN-bounds.top;
    const root=node('svg',{xmlns:NS,width,height,viewBox:'0 0 '+width+' '+height,
      class:'drawio-graph',role:'img','aria-label':'Read-only draw.io diagram'});
    const defs=node('defs');root.append(defs);
    const edges=node('g',{class:'drawio-edges'}), shapes=node('g',{class:'drawio-shapes'});
    root.append(edges,shapes);
    const uidPrefix='drawio-'+(++uid)+'-';
    function center(p){return{x:p.ax+dx+p.width/2,y:p.ay+dy+p.height/2};}
    function boundary(cell, toward) {
      const midpoint=center(cell), vx=toward.x-midpoint.x, vy=toward.y-midpoint.y;
      if (!vx && !vy) return midpoint;
      const halfWidth=Math.max(1,cell.width/2), halfHeight=Math.max(1,cell.height/2);
      let ratio=1/Math.max(Math.abs(vx)/halfWidth,Math.abs(vy)/halfHeight);
      if(['ellipse','cloud','actor'].includes(cell.style.shape))
        ratio=1/Math.sqrt((vx/halfWidth)**2+(vy/halfHeight)**2);
      return {x:midpoint.x+vx*ratio,y:midpoint.y+vy*ratio};
    }
    function edgePoint(e,key) {
      if (!e.geo) return null;
      const point=Array.from(e.geo.children).find(p=>p.localName==='mxPoint'&&p.getAttribute('as')===key);
      return point?{x:number(point.getAttribute('x'))+dx,y:number(point.getAttribute('y'))+dy}:null;
    }
    model.edges.forEach((e,i)=>{
      const source=model.positions.get(e.source),target=model.positions.get(e.target);
      const points=Array.from(e.geo?.children||[])
        .filter(n=>n.localName==='Array'&&n.getAttribute('as')==='points')
        .flatMap(n=>Array.from(n.children))
        .filter(n=>n.localName==='mxPoint').slice(0,40)
        .map(n=>({x:number(n.getAttribute('x'))+dx,y:number(n.getAttribute('y'))+dy}));
      const fromFallback=edgePoint(e,'sourcePoint');
      const toFallback=edgePoint(e,'targetPoint');
      const first=points[0]||(target?.vertex?center(target):toFallback);
      const last=points.at(-1)||(source?.vertex?center(source):fromFallback);
      const a=source?.vertex && first?boundary(source,first):fromFallback;
      const b=target?.vertex && last?boundary(target,last):toFallback;
      if(!a||!b)return;
      let segments=[a,...points,b];
      if(!points.length && e.style.edgeStyle && /orthogonal|elbow/i.test(e.style.edgeStyle)) {
        const mid=(a.x+b.x)/2;
        segments=[a,{x:mid,y:a.y},{x:mid,y:b.y},b];
      }
      const d='M '+segments.map(p=>p.x+' '+p.y).join(' L ');
      const stroke=color(e.style.strokeColor,'#64748b');
      const path=node('path',{d,
        stroke,'stroke-width':number(e.style.strokeWidth,2,.5,12),
        'stroke-dasharray':e.style.dashed==='1'?'7 5':undefined,fill:'none'});
      if(e.style.endArrow!=='none'){
        const id=uidPrefix+i;
        const marker=node('marker',{id,markerWidth:8,markerHeight:8,refX:8,refY:4,
          orient:'auto',viewBox:'0 0 10 8'});
        marker.append(node('path',{d:'M0 0 L10 4 L0 8 z',fill:stroke}));
        defs.append(marker);
        path.setAttribute('marker-end','url(#'+id+')');
      }
      edges.append(path);
      if(e.value) {
        const txt=node('text',{x:(a.x+b.x)/2,y:(a.y+b.y)/2-8,
          'text-anchor':'middle',class:'drawio-edge-label'},e.value);
        edges.append(txt);
      }
    });
    for(const e of model.nodes){
      const x=e.ax+dx,y=e.ay+dy,w=e.width,h=e.height;
      if(w<2||h<2)continue;
      const style=e.style;
      const shape=style.shape||'rectangle';
      const fill=color(style.fillColor,'#e8f1ff');
      const stroke=color(style.strokeColor,'#64748b');
      const attr={fill,stroke,'stroke-width':number(style.strokeWidth,1.7,.5,10)};
      let graphic;
      if(shape==='ellipse'||ELLIPSE.has(shape)){
        graphic=node('ellipse',{cx:x+w/2,cy:y+h/2,rx:w/2,ry:h/2,...attr});
      } else if(shape==='rhombus'||shape==='diamond'){
        graphic=node('polygon',{points:(x+w/2)+','+y+' '+(x+w)+','+(y+h/2)+' '+(x+w/2)+','+(y+h)+' '+x+','+(y+h/2),...attr});
      } else if(shape==='hexagon'){
        graphic=node('polygon',{points:[x+w*.25+','+y,x+w*.75+','+y,x+w+','+(y+h/2),
          x+w*.75+','+(y+h),x+w*.25+','+(y+h),x+','+(y+h/2)].join(' '),...attr});
      } else if(shape==='triangle'){
        graphic=node('polygon',{points:(x+w/2)+','+y+' '+(x+w)+','+(y+h)+' '+x+','+(y+h),...attr});
      } else if(shape==='parallelogram'){
        graphic=node('polygon',{points:(x+w*.2)+','+y+' '+(x+w)+','+y+' '+(x+w*.8)+','+(y+h)+' '+x+','+(y+h),...attr});
      } else if(shape==='text'){
        graphic=node('rect',{x,y,width:w,height:h,fill:'none',stroke:'none'});
      } else {
        graphic=node('rect',{x,y,width:w,height:h,rx:style.rounded==='1'?Math.min(16,w*.1,h*.1):0,
          ry:style.rounded==='1'?Math.min(16,w*.1,h*.1):0,...attr});
      }
      const g=node('g',{class:'drawio-shape'});g.append(graphic);
      if(e.value){
        const lines=e.value.split('\n').slice(0,12);
        const fontSize=number(style.fontSize,13,8,32);
        const text=node('text',{x:x+w/2,y:y+h/2-((lines.length-1)*fontSize*1.18)/2,
          fill:color(style.fontColor,'#1f2937'), 'font-size':fontSize,
          'text-anchor':'middle','dominant-baseline':'middle',class:'drawio-label'});
        lines.forEach((line,j)=>text.append(node('tspan',{x:x+w/2,dy:j?fontSize*1.18:0},
          line.slice(0,120))));
        g.append(text);
      }
      shapes.append(g);
    }
    return {element:root,width,height};
  }
  function render(source) {
    const pages=parseFile(source);
    const root=html('div','wiki-drawio-viewer');
    const tabs=html('div','drawio-tabs');
    const summary=html('p','drawio-summary','diagrams.net · '+pages.length+' page'+(pages.length===1?'':'s')+' · read-only');
    const warning=html('p','drawio-warning');
    warning.hidden=true;
    const controls=html('div','drawio-controls');
    const viewport=html('div','drawio-viewport');
    viewport.setAttribute('role','region');
    viewport.setAttribute('aria-label','Read-only draw.io page; drag empty space to pan');
    viewport.tabIndex=0;
    const board=html('div','drawio-board');
    viewport.append(board);
    root.append(summary,tabs,warning,controls,viewport);
    const buttons=[],state={scale:1,x:0,y:0,width:600,height:400};
    let disposed=false,sequence=0,drag=null;
    function apply() {
      board.style.transform='translate('+state.x+'px,'+state.y+'px) scale('+state.scale+')';
      zoomLabel.textContent=Math.round(state.scale*100)+'%';
    }
    function fit(){
      const width=viewport.clientWidth||840,height=viewport.clientHeight||470;
      state.scale=Math.max(.12,Math.min(2,Math.min((width-28)/state.width,(height-28)/state.height)));
      state.x=(width-state.width*state.scale)/2;
      state.y=(height-state.height*state.scale)/2;apply();
    }
    function zoom(factor){
      const next=Math.max(.12,Math.min(4,state.scale*factor));
      const cx=viewport.clientWidth/2,cy=viewport.clientHeight/2;
      const wx=(cx-state.x)/state.scale,wy=(cy-state.y)/state.scale;
      state.scale=next;state.x=cx-wx*next;state.y=cy-wy*next;apply();
    }
    function button(text,label,callback){
      const el=html('button','drawio-control',text);el.type='button';el.title=label;
      el.addEventListener('click',callback);controls.append(el);return el;
    }
    button('−','Zoom out',()=>zoom(1/1.25));
    button('+','Zoom in',()=>zoom(1.25));
    button('Fit','Fit diagram to viewport',fit);
    button('100%','Show actual diagram size',()=>{state.scale=1;state.x=20;state.y=20;apply();});
    const zoomLabel=html('span','drawio-zoom','100%');controls.append(zoomLabel);
    controls.append(html('span','drawio-hint','Drag empty space to pan · Ctrl+wheel to zoom'));
    async function selectPage(index) {
      const seq=++sequence;
      buttons.forEach((b,i)=>b.setAttribute('aria-pressed',String(i===index)));
      warning.hidden=true;board.replaceChildren(html('p','drawio-loading','Loading diagram page…'));
      try {
        const graph=await decodePage(pages[index]);
        if(disposed||seq!==sequence)return;
        const model=modelFrom(graph);
        const drawing=drawModel(model);
        state.width=drawing.width;state.height=drawing.height;
        board.style.width=drawing.width+'px';board.style.height=drawing.height+'px';
        board.replaceChildren(drawing.element);
        if(model.complex){
          warning.textContent=model.complex+' complex / custom shapes are approximated. Open in diagrams.net for full visual fidelity.';
          warning.hidden=false;
        }
        requestAnimationFrame(()=>{if(!disposed&&seq===sequence&&root.isConnected)fit();});
      } catch(err) {
        if(disposed||seq!==sequence)return;
        board.replaceChildren(html('p','drawio-error','Unable to display this page: '+err.message));
      }
    }
    pages.forEach((page,i)=>{
      const tab=html('button','drawio-tab',page.name.slice(0,100));
      tab.type='button';tab.title=page.name;
      tab.addEventListener('click',()=>void selectPage(i));
      buttons.push(tab);tabs.append(tab);
    });
    viewport.addEventListener('pointerdown',e=>{
      if(e.button!==0 || e.target.closest('text')) return;
      e.preventDefault();
      drag={id:e.pointerId,x:e.clientX,y:e.clientY,startX:state.x,startY:state.y};
      viewport.setPointerCapture(e.pointerId);
    });
    viewport.addEventListener('pointermove',e=>{
      if(!drag||e.pointerId!==drag.id)return;
      state.x=drag.startX+e.clientX-drag.x;state.y=drag.startY+e.clientY-drag.y;apply();
    });
    const release=e=>{
      if(!drag||drag.id!==e.pointerId)return;
      drag=null;
      if(viewport.hasPointerCapture(e.pointerId))viewport.releasePointerCapture(e.pointerId);
    };
    viewport.addEventListener('pointerup',release);
    viewport.addEventListener('pointercancel',release);
    viewport.addEventListener('wheel',e=>{
      if(!e.ctrlKey)return;
      e.preventDefault();zoom(e.deltaY<0?1.15:1/1.15);
    },{passive:false});
    viewport.addEventListener('keydown',e=>{
      const offsets={ArrowLeft:[35,0],ArrowRight:[-35,0],ArrowUp:[0,35],ArrowDown:[0,-35]};
      if(offsets[e.key]) {e.preventDefault();state.x+=offsets[e.key][0];state.y+=offsets[e.key][1];apply();}
      else if(e.key==='+'||e.key==='='){e.preventDefault();zoom(1.25);}
      else if(e.key==='-'){e.preventDefault();zoom(1/1.25);}
      else if(e.key==='f'||e.key==='0'){e.preventDefault();fit();}
    });
    root.dispose=()=>{disposed=true;sequence++;};
    void selectPage(0);
    return root;
  }
  global.LocalWikiDrawio={parseFile,decodePage,modelFrom,styleMap,label,render};
})(window);
