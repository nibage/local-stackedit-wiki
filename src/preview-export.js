/* Self-contained offline export of the rendered preview, without reinterpreting Markdown. */
(function (global) {
  'use strict';
  const MAX_RESOURCE_BYTES = 32 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
  const RESOURCE_ATTRS = ['src','data','poster','href','xlink:href'];
  const REMOVE = [
    'script','iframe','frame','frameset','form','input','textarea','select',
    'button','link','meta','base','.diagram-export','.structured-embed-open',
    '.bases-toolbar','.bases-filter-panel'
  ].join(',');
  // The standalone exported HTML cannot refer back to assets/ CSS.
  // These rules match assets/preview-media-centering.css without changing
  // prose or table-cell alignment.
  const CENTER_MEDIA_STYLES =
    // Renderers may snapshot a narrower onscreen parent even when the HTML
    // export body has a wider reading column. Center in the *export* column,
    // not in that stale parent width.
    '.wiki-export-preview :is(.visualization,.wiki-attachment-embed,.wiki-bases-viewer,'+
    '.wiki-canvas-viewer,.wiki-drawio-viewer) {'+
    'box-sizing:border-box!important;width:100%!important;max-width:100%!important;}'+
    '.wiki-export-preview .visualization > svg,'+
    '.wiki-export-preview .wiki-drawio-viewer > svg,'+
    '.wiki-export-preview .wiki-export-pdf-pages > img {'+
    'display:block!important;max-width:100%!important;height:auto!important;'+
    'margin-left:auto!important;margin-right:auto!important;}'+
    '.wiki-export-preview p:has(> img:only-child) > img:only-child {'+
    'display:block!important;max-width:100%!important;height:auto!important;'+
    'margin-left:auto!important;margin-right:auto!important;}'+
    '.wiki-export-preview table:not(.bases-table) {'+
    'box-sizing:border-box!important;min-width:0!important;'+
    'width:max-content!important;max-width:100%!important;'+
    'margin-left:auto!important;margin-right:auto!important;overflow-x:auto!important;}'+
    '.wiki-export-preview .wiki-attachment-embed > :is(img,audio,video,object) {'+
    'display:block!important;max-width:100%!important;'+
    'margin-left:auto!important;margin-right:auto!important;}'+
    '.wiki-export-preview .wiki-attachment-embed > video {height:auto!important;}'+
    '.wiki-export-preview :is(.wiki-export-structured,.wiki-export-static-graph,'+
    '.wiki-export-pdf-pages) {margin-left:auto!important;margin-right:auto!important;}'+
    '.wiki-export-preview :is(.canvas-viewport,.drawio-viewport,.bases-table-scroll) {'+
    'margin-left:auto!important;margin-right:auto!important;}';
  // Print only: use the full A4 reading area while retaining a comfortable
  // editorial type size. HTML exports keep their unchanged screen layout.
  const PRINT_STYLES = `@page { size:A4; margin:10mm 11mm 12mm; }
@media print {
  html,body {
    background:#fff!important;color:#2b3035!important;
    font-family:Arial,"Helvetica Neue",Helvetica,sans-serif!important;
    -webkit-print-color-adjust:exact;print-color-adjust:exact;
  }
  .wiki-export-preview {
    display:block!important;box-sizing:border-box!important;
    width:100%!important;max-width:100%!important;
    min-height:0!important;height:auto!important;overflow:visible!important;
    margin:0 auto!important;padding:0!important;flex:none!important;
    background:#fff!important;color:#2b3035!important;
    font-family:Arial,"Helvetica Neue",Helvetica,sans-serif!important;
    font-size:16px!important;line-height:1.47!important;
  }
  .wiki-export-preview p,.wiki-export-preview h1,.wiki-export-preview h2,
  .wiki-export-preview h3,.wiki-export-preview h4,.wiki-export-preview h5,
  .wiki-export-preview h6,.wiki-export-preview ul,.wiki-export-preview ol,
  .wiki-export-preview li,.wiki-export-preview blockquote,
  .wiki-export-preview pre,.wiki-export-preview details {
    box-sizing:border-box!important;min-width:0!important;
    width:auto!important;max-width:100%!important;
  }
  .wiki-export-preview p,.wiki-export-preview li,.wiki-export-preview blockquote {
    font-size:16px!important;line-height:1.47!important;letter-spacing:normal!important;
  }
  .wiki-export-preview p {margin:0 0 .62em!important;orphans:3;widows:3;}
  .wiki-export-preview ul,.wiki-export-preview ol {
    padding-left:1.5em!important;margin:.22em 0 .72em!important;
  }
  .wiki-export-preview li { margin:.08em 0!important; }
  .wiki-export-preview h1,.wiki-export-preview h2,.wiki-export-preview h3,
  .wiki-export-preview h4,.wiki-export-preview h5,.wiki-export-preview h6 {
    font-family:Arial,"Helvetica Neue",Helvetica,sans-serif!important;
    color:#292e34!important;font-weight:700!important;line-height:1.22!important;
    border:0!important;border-bottom:1px solid #c9d0d8!important;
    padding:0 0 .19em!important;margin:.95em 0 .4em!important;
    break-after:avoid-page!important;page-break-after:avoid!important;
  }
  .wiki-export-preview h1 {font-size:27px!important;}
  .wiki-export-preview h2 {font-size:21px!important;}
  .wiki-export-preview h3 {font-size:18px!important;}
  .wiki-export-preview h4,.wiki-export-preview h5,.wiki-export-preview h6 {font-size:16px!important;}
  .wiki-export-preview>h1:first-child,.wiki-export-preview>h2:first-child {
    margin-top:0!important;
  }
  .wiki-export-preview hr {
    border:0!important;border-top:1px solid #c9d0d8!important;
    margin:.75em 0!important;box-shadow:none!important;
  }
  .wiki-export-preview a[href] {
    color:#1675aa!important;text-decoration:underline!important;
    overflow-wrap:anywhere!important;
  }
  .wiki-export-preview blockquote {
    color:#555!important;background:transparent!important;
    border-left:3px solid #cfd5da!important;
    padding:.1em .8em!important;margin:.4em 0 .65em!important;
  }
  .wiki-export-preview pre,.wiki-export-preview pre code {
    max-width:100%!important;white-space:pre-wrap!important;
    overflow-wrap:anywhere!important;word-break:break-word!important;
    overflow:visible!important;
    font-size:12px!important;line-height:1.4!important;
  }
  .wiki-export-preview pre {
    padding:8px 11px!important;margin:.4em 0 .75em!important;
    background:#f6f7f8!important;border:1px solid #e1e4e7!important;
  }
  .wiki-export-preview table {
    display:table!important;box-sizing:border-box!important;
    width:100%!important;max-width:100%!important;min-width:0!important;
    table-layout:auto!important;border-collapse:collapse!important;
    overflow:visible!important;break-inside:auto!important;
  }
  /* Center narrow Markdown tables, but keep wide tables within printable
     width and preserve repeated headings/row pagination on multiple pages. */
  .wiki-export-preview table:not(.bases-table) {
    box-sizing:border-box!important;min-width:0!important;
    width:fit-content!important;max-width:100%!important;
    margin-left:auto!important;margin-right:auto!important;
  }
  /* A nested no-wrap span can force a whole table wider than A4, even when
     td itself wraps. Printable tables must be allowed to break long content. */
  .wiki-export-preview table:not(.bases-table) :is(span,code,a,strong,em) {
    white-space:normal!important;overflow-wrap:anywhere!important;
    word-break:break-word!important;
  }
  .wiki-export-preview .bases-table {
    width:100%!important;margin-left:auto!important;margin-right:auto!important;
  }
  .wiki-export-preview thead {display:table-header-group!important;}
  .wiki-export-preview tfoot {display:table-footer-group!important;}
  .wiki-export-preview tr {break-inside:avoid-page!important;page-break-inside:avoid!important;}
  .wiki-export-preview th,.wiki-export-preview td {
    position:static!important;white-space:normal!important;
    max-width:none!important;overflow:visible!important;
    overflow-wrap:anywhere!important;word-break:break-word!important;
    padding:5px 8px!important;line-height:1.4!important;
    font-size:12px!important;vertical-align:top!important;
    border-bottom:1px solid #dfe4e8!important;
  }
  .wiki-export-preview th {
    background:#f1f3f5!important;color:#292e34!important;font-weight:700!important;
  }
  .wiki-export-preview .visualization,
  .wiki-export-preview .wiki-export-static-graph,
  .wiki-export-preview .wiki-export-structured,
  .wiki-export-preview .wiki-drawio-viewer,
  .wiki-export-preview .wiki-export-pdf-pages img {
    box-sizing:border-box!important;max-width:100%!important;
    overflow:visible!important;break-inside:avoid-page!important;
    page-break-inside:avoid!important;
  }
  .wiki-export-preview img,.wiki-export-preview svg {
    display:inline-block;max-width:100%!important;
    max-height:245mm!important;object-fit:contain!important;
    break-inside:avoid-page!important;page-break-inside:avoid!important;
  }
  .wiki-export-preview .wiki-export-pdf-pages img {display:block!important;margin:0 auto 8px!important;}
  .wiki-export-preview .wiki-bases-viewer,.wiki-export-preview .bases-table-scroll {
    height:auto!important;min-height:0!important;max-height:none!important;
    overflow:visible!important;
  }
  .wiki-export-preview .wiki-drawio-viewer svg,
  .wiki-export-preview .visualization svg {overflow:visible!important;}
  .wiki-export-preview .canvas-node {box-sizing:border-box!important;}
  .wiki-export-preview .MathJax_MathML {max-width:100%!important;}
}`;
  // Computed CSS retains the current theme and syntax highlighting, without
  // requiring relative stylesheets or active scripts in the exported document.
  const STYLES = [
    'display','position','box-sizing','visibility','opacity','color','background-color','background-image',
    'font-family','font-size','font-weight','font-style','font-variant','line-height','letter-spacing','word-spacing',
    'text-align','text-transform','text-decoration','text-decoration-color','text-shadow','white-space',
    'overflow-wrap','word-break','vertical-align','list-style-type','list-style-position',
    'margin-top','margin-right','margin-bottom','margin-left',
    'padding-top','padding-right','padding-bottom','padding-left',
    'border-top','border-right','border-bottom','border-left','border-radius',
    'width','height','min-width','max-width','min-height','max-height',
    'overflow-x','overflow-y','flex','flex-direction','flex-wrap','align-items','justify-content',
    'gap','column-gap','row-gap','grid-template-columns','grid-template-rows','grid-column','grid-row',
    'transform','transform-origin','left','right','top','bottom','z-index','box-shadow',
    'border-collapse','border-spacing','table-layout','object-fit','aspect-ratio',
    'fill','fill-opacity','stroke','stroke-width','stroke-dasharray','stroke-linecap','stroke-linejoin',
    'text-anchor','paint-order'
  ];
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g,character=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[character]);
  }
  function validTitle(title) {
    return String(title || 'Wiki preview').replace(/[\u0000-\u001f]/g,'').slice(0,160);
  }
  function fileName(path,extension) {
    let name = String(path || 'preview').split(/[\\/]/).pop().replace(/\.(?:md|markdown)$/i,'');
    name = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').trim().replace(/[.\s]+$/g,'');
    return (name.slice(0,110) || 'preview')+'.'+extension;
  }
  function isLocalResource(url) {
    return /^(?:blob:|data:)/i.test(url);
  }
  function isTrustedInlineReference(url) {
    return /^#[A-Za-z][\w.:-]*$/.test(url);
  }
  async function toDataUrl(url, budget) {
    if (/^data:/i.test(url)) {
      const approx = Math.ceil(url.length * .75);
      if (approx > MAX_RESOURCE_BYTES || budget.bytes+approx>MAX_TOTAL_BYTES)
        throw new Error('Embedded image or media exceeds the 32 MB per-file / 64 MB total export limit.');
      budget.bytes+=approx;
      return url;
    }
    if (!/^blob:/i.test(url)) throw new Error('A preview resource is not a local Blob and cannot be safely embedded.');
    const response=await fetch(url);
    if (!response.ok) throw new Error('A local preview resource could not be read for export.');
    const blob=await response.blob();
    if (blob.size>MAX_RESOURCE_BYTES || budget.bytes+blob.size>MAX_TOTAL_BYTES)
      throw new Error('The preview contains media exceeding the 32 MB per-file / 64 MB total export limit.');
    budget.bytes+=blob.size;
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(reader.result);
      reader.onerror=()=>reject(new Error('Could not encode a local preview resource.'));
      reader.readAsDataURL(blob);
    });
  }
  async function themeSnapshot(preview,theme) {
    // Create an off-screen same-origin document with the actual light-theme
    // stylesheets. Never change the application's selected theme or print dark
    // inline CSS values. No scripts are copied, no external hosts are allowed.
    const frame=document.createElement('iframe');
    frame.setAttribute('aria-hidden','true');
    frame.tabIndex=-1;
    frame.style.cssText='position:fixed;left:-200vw;top:0;opacity:0;'+
      'pointer-events:none;border:0;height:950px;width:'+
      Math.max(760,preview.clientWidth||900)+'px;';
    document.body.append(frame);
    try {
      const doc=frame.contentDocument;
      doc.documentElement.dataset.theme=theme==='light'?'light':
        (document.documentElement.dataset.theme||'light');
      for(const key of ['centered','wikiTextSize','lineNumbers'])
        if(document.documentElement.dataset[key]!==undefined)
          doc.documentElement.dataset[key]=document.documentElement.dataset[key];
      const size=document.documentElement.style.getPropertyValue('--wiki-user-text-size');
      if(size)doc.documentElement.style.setProperty('--wiki-user-text-size',size);
      const pending=[];
      for(const original of document.querySelectorAll('link[rel="stylesheet"],style')) {
        if (original.localName==='link') {
          // Mirror existing loaded CSSOM rules first. This is synchronous and
          // also works when the app is opened via file:// or setContent().
          try {
            const rules=Array.from(original.sheet?.cssRules||[]);
            if (rules.length) {
              const inline=doc.createElement('style');
              inline.textContent=rules.map(rule=>rule.cssText).join('\n');
              doc.head.append(inline);
              continue;
            }
          } catch (_) { /* Fall back to the original bundle-relative CSS link. */ }
          const relative=original.getAttribute('href')||'';
          // Only bundle-local relative stylesheets: never follow external URLs.
          if (!relative || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(relative))continue;
          let uri,base;
          try {base=new URL(document.baseURI);uri=new URL(relative,base);}catch(_){continue;}
          const allowed=uri.protocol==='file:'&&base.protocol==='file:'||
            uri.origin===base.origin&&/^https?:$/.test(uri.protocol);
          if(!allowed)continue;
          const sheet=doc.createElement('link');
          sheet.rel='stylesheet';sheet.href=uri.href;
          pending.push(new Promise(resolve=>{
            sheet.addEventListener('load',resolve,{once:true});
            sheet.addEventListener('error',resolve,{once:true});
          }));
          doc.head.append(sheet);
        } else {
          const style=doc.createElement('style');
          style.textContent=original.textContent;
          doc.head.append(style);
        }
      }
      // The print copy must be light even if a stylesheet cannot be cloned.
      // Force only the main preview palette, leaving light-theme typography,
      // diagrams and syntax styles inherited from the copied offline CSS.
      if(theme==='light'){
        const lightPalette=doc.createElement('style');
        lightPalette.textContent=':root[data-theme="light"]{color-scheme:light;'+
          '--panel:#fff;--panel-alt:#f7f8fa;--text:#252c34;--muted:#677182;--line:#d9dde2;}'+
          '[data-theme="light"] .markdown-preview{background:#fff!important;'+
          'color:#252c34!important;}';
        doc.head.append(lightPalette);
      }
      const wrapper=doc.createElement('section');
      wrapper.className='pane preview-pane';
      const light=doc.importNode(preview,true);
      wrapper.append(light);doc.body.append(wrapper);
      // CSS is loaded from the same offline bundle, not the network.
      await Promise.race([Promise.all(pending),new Promise(resolve=>setTimeout(resolve,2500))]);
      return {node:light,frame};
    } catch(error) {
      frame.remove();
      throw error;
    }
  }
  function copyStyle(source,target) {
    if (!source || !target || source.nodeType!==1 || target.nodeType!==1) return;
    const css=source.ownerDocument.defaultView.getComputedStyle(source);
    for(const name of STYLES) {
      const value=css.getPropertyValue(name);
      if (!value || value==='initial' || value==='normal' && name==='background-image') continue;
      // CSS URL sources should never cause a network fetch from exported HTML.
      if (/\burl\(\s*["']?(?!(?:#|data:))/i.test(value)) continue;
      target.style.setProperty(name,value);
    }
    // SVG graphs contain their own inline geometry and marker definitions.
  }
  // Keep safe wiki-relative document paths in exported standalone HTML.
  // The old filter deleted all paths except http/mailto/#, silently turning
  // Markdown hyperlinks into ordinary, unclickable text. A relative target
  // only resolves if the corresponding file is available next to the HTML.
  function safeDocumentHref(href) {
    const value=String(href||'').trim();
    if(!value || /[\\\x00-\x1f\x7f]/.test(value))return false;
    if (/^(?:https?:\/\/|mailto:|#)/i.test(value))return true;
    if(value.startsWith('//')||value.startsWith('/')||value.startsWith('\\'))return false;
    if(/^[a-z][a-z0-9+.-]*:/i.test(value))return false;
    return true; // relative Markdown, documents, safe query/fragment paths
  }
  function cleanUrls(element) {
    Array.from(element.attributes).forEach(attribute=>{
      const name=attribute.name.toLowerCase();
      if (name.startsWith('on') || name==='srcset' || name==='formaction' ||
          name==='autofocus' || name==='autoplay' || name==='contenteditable')
        element.removeAttribute(attribute.name);
    });
    if (element.matches('a')) {
      const href=element.getAttribute('href')||'';
      if (!safeDocumentHref(href)) element.removeAttribute('href');
      element.setAttribute('rel','noopener noreferrer');
      element.removeAttribute('target');
    }
  }
  async function inlineMedia(original,copy,budget,cache) {
    const tags=['img','audio','video','source','object','image'];
    if (!tags.includes(original.localName)) return;
    for (const attribute of RESOURCE_ATTRS) {
      if (!original.hasAttribute(attribute)) continue;
      const raw=original.getAttribute(attribute);
      if (!raw) continue;
      // HTML image/video sources and SVG image links must be vault-local Blobs
      // or already embedded data. Never fetch http(s), file paths or javascript:.
      const isMedia = attribute==='src' || attribute==='data' || attribute==='poster' ||
        (original.localName==='image' && attribute.endsWith('href'));
      if (!isMedia) continue;
      const resolved=original[attribute] && typeof original[attribute]==='string' ?
        original[attribute] : raw;
      const candidate=isLocalResource(raw)?raw:resolved;
      if (!isLocalResource(candidate)) {
        copy.removeAttribute(attribute);
        continue;
      }
      let data=cache.get(candidate);
      if (!data) {data=await toDataUrl(candidate,budget);cache.set(candidate,data);}
      copy.setAttribute(attribute,data);
    }
    if (copy.localName==='audio' || copy.localName==='video') {
      copy.removeAttribute('autoplay');copy.removeAttribute('loop');
      copy.removeAttribute('preload');
    }
  }
  // Exported copies have no wiki app to navigate links. Preserve safe
  // external URLs, and translate within-note heading links to PDF/HTML #ids.
  function normalizeDocumentLinks(root,title) {
    const headings=Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    // The editor assigns stable wiki-heading-* ids, which print to PDF as
    // actual internal destinations. Keep those ids rather than text-only TOC.
    headings.forEach((heading,index)=>{
      if(!heading.id) heading.id='wiki-export-heading-'+index;
    });
    function normalized(value) {
      try {value=decodeURIComponent(value);}catch(_){}
      return String(value).replace(/^#+/,'').normalize('NFC').trim().toLocaleLowerCase()
        .replace(/[\s_-]+/g,' ');
    }
    function toHeading(fragment) {
      const wanted=normalized(fragment);
      return headings.find(node=>normalized(node.id)===wanted ||
        normalized(node.textContent)===wanted)?.id || null;
    }
    for(const anchor of root.querySelectorAll('a[href]')) {
      const raw=anchor.getAttribute('href')||'';
      let target=null;
      if (raw.startsWith('#')) target=toHeading(raw.slice(1));
      if (/^wiki:/i.test(raw) || /^[^:#?]+\.md(?:arkdown)?#/i.test(raw)) {
        let spec=/^wiki:/i.test(raw)?raw.slice(5):raw;
        try {spec=decodeURIComponent(spec);}catch(_){}
        const split=spec.indexOf('#');
        const file=split>=0?spec.slice(0,split):spec;
        const section=split>=0?spec.slice(split+1):'';
        const page=String(title).replace(/\.(?:md|markdown)$/i,'');
        const name=file.split('/').pop().replace(/\.(?:md|markdown)$/i,'');
        if (section && (!file || normalized(name)===normalized(page)))
          target=toHeading(section);
      }
      if (target) anchor.setAttribute('href','#'+target);
      else if (raw.startsWith('#') || /^wiki:/i.test(raw)) anchor.removeAttribute('href');
      // Other wiki-relative Markdown hrefs are intentionally retained; PDF
      // within-document destinations above still use stable heading IDs.
    }
  }

  function flattenVisualsForDocument(cloned,theme,layoutWidth,visualMetrics) {
    // Existing preview viewers are interactive panning/zooming widgets. A
    // serialized HTML/PDF needs static geometry without the user's pan/zoom.
    // For HTML, use the actual preview width; for A4, fit the printable column.
    const maxWidth=theme==='light'?620:Math.max(760,layoutWidth||900);
    const maxHeight=theme==='light'?950:Infinity;
    const fit=(width,height)=>{
      const w=Number.isFinite(width)&&width>0?width:650;
      const h=Number.isFinite(height)&&height>0?height:400;
      return Math.min(1,maxWidth/w,maxHeight/h);
    };
    for(const viewer of cloned.querySelectorAll('.wiki-canvas-viewer')){
      const board=viewer.querySelector('.canvas-board');
      if(!board)continue;
      const w=parseFloat(board.style.width)||850,h=parseFloat(board.style.height)||500;
      const scale=fit(w,h);
      const outer=cloned.ownerDocument.createElement('div');
      outer.className='wiki-export-static-graph';
      outer.style.cssText='position:relative!important;box-sizing:border-box!important;'+
        'width:'+Math.ceil(w*scale)+'px!important;max-width:100%!important;'+
        'height:'+Math.ceil(h*scale)+'px!important;min-height:0!important;'+
        'overflow:visible!important;display:block!important;margin:0 auto 12px!important;';
      board.style.setProperty('position','absolute','important');
      board.style.setProperty('top','0','important');
      board.style.setProperty('left','0','important');
      board.style.setProperty('transform','scale('+scale+')','important');
      board.style.setProperty('transform-origin','0 0','important');
      board.classList.add('wiki-export-board');
      outer.append(board);
      viewer.replaceChildren(outer);
      viewer.style.cssText='display:block!important;width:100%!important;'+
        'max-width:100%!important;height:auto!important;min-height:0!important;'+
        'overflow:visible!important;break-inside:avoid;';
    }
    // draw.io uses a direct native SVG already. Export the current page SVG
    // without toolbar, viewport clipping or its interactive transform.
    for(const viewer of cloned.querySelectorAll('.wiki-drawio-viewer')){
      const svg=viewer.querySelector('.drawio-board svg');
      if(!svg)continue;
      viewer.replaceChildren(svg);
      viewer.style.cssText='display:block!important;max-width:100%!important;'+
        'width:100%!important;height:auto!important;overflow:visible!important;';
    }
    let diagramIndex=0;
    for(const svg of cloned.querySelectorAll(
      '.visualization svg, .wiki-drawio-viewer>svg')){
      // Do not alter Canvas connection-layer coordinates; scaling the entire
      // board retains pixel-perfect card positions and arrow endpoints.
      if(svg.closest('.wiki-export-static-graph'))continue;
      const box=svg.getAttribute('viewBox')?.split(/[\s,]+/).map(Number)||[];
      const pixels=value=>/^\s*\d+(?:\.\d+)?(?:px)?\s*$/i.test(value||'')?parseFloat(value):0;
      // Mermaid often writes width="100%". parseFloat("100%") == 100 is
      // NOT 100 actual pixels: it made diagrams tiny in HTML/PDF exports.
      // Measure the rendered preview SVG in the laid-out snapshot instead.
      const measured=svg.closest('.visualization')?visualMetrics[diagramIndex++]:null;
      const w=measured?.width||pixels(svg.getAttribute('width'))||box[2]||
        pixels(svg.style.width)||650;
      const h=measured?.height||pixels(svg.getAttribute('height'))||box[3]||
        pixels(svg.style.height)||400;
      const scale=fit(w,h);
      if(!svg.hasAttribute('viewBox')&&w>0&&h>0)
        svg.setAttribute('viewBox','0 0 '+w+' '+h);
      svg.setAttribute('width',String(Math.ceil(w*scale)));
      svg.setAttribute('height',String(Math.ceil(h*scale)));
      svg.style.setProperty('display','block','important');
      svg.style.setProperty('width',Math.ceil(w*scale)+'px','important');
      svg.style.setProperty('height',Math.ceil(h*scale)+'px','important');
      svg.style.setProperty('max-width','100%','important');
      svg.style.setProperty('overflow','visible','important');
      svg.style.setProperty('margin','0 auto 12px','important');
    }
    for(const area of cloned.querySelectorAll('.bases-table-scroll')){
      // The viewer itself inherits the *clipped onscreen viewport height*
      // (e.g. 513px for a 1525px table). Growing just the table causes later
      // Canvas/draw.io embeds to overlap its rows in standalone HTML.
      const viewer=area.closest('.wiki-bases-viewer');
      if(viewer) {
        viewer.style.setProperty('height','auto','important');
        viewer.style.setProperty('min-height','0','important');
        viewer.style.setProperty('max-height','none','important');
        viewer.style.setProperty('overflow','visible','important');
      }
      area.style.cssText='display:block!important;width:100%!important;'+
        'max-width:100%!important;height:auto!important;max-height:none!important;'+
        'overflow:visible!important;';
      for(const table of area.querySelectorAll('.bases-table')){
        table.style.cssText='width:100%!important;min-width:0!important;'+
          'max-width:100%!important;table-layout:auto!important;';
        table.querySelectorAll('col').forEach(col=>col.removeAttribute('style'));
      }
    }
  }
  async function build(preview,{title='Wiki preview',theme='current'}={}) {
    if (!preview || !preview.isConnected) throw new Error('No rendered preview is available.');
    // Always copy from a genuinely laid-out offscreen document, even in
    // Editor-only mode where the onscreen preview's width/height are zero.
    // This also avoids inheriting clipped scroll/viewport geometry.
    const snapshot=await themeSnapshot(preview,theme);
    const source=snapshot.node;
    try {
    const visualMetrics=Array.from(source.querySelectorAll('.visualization svg')).map(svg=>{
      const rect=svg.getBoundingClientRect();
      return {width:rect.width,height:rect.height};
    });
    const layoutWidth=Math.max(760,source.clientWidth||900);
    const cloned=source.cloneNode(true);
    normalizeDocumentLinks(cloned,title);
    const originals=[source,...source.querySelectorAll('*')];
    const copies=[cloned,...cloned.querySelectorAll('*')];
    const budget={bytes:0},cache=new Map();
    for(let i=0;i<originals.length;i++){
      const original=originals[i],copy=copies[i];
      if (!original || !copy || original.nodeType!==1 || copy.nodeType!==1) continue;
      cleanUrls(copy);
      // Do not clone an untrusted stylesheet into a standalone HTML document.
      if (copy.localName!=='style') copyStyle(original,copy);
      await inlineMedia(original,copy,budget,cache);
    }
    // Preserve pixels for genuine HTML canvas-based diagrams; HTML cloneNode
    // alone never copies a <canvas> bitmap. No external image requests.
    const originalCanvases=source.querySelectorAll('canvas');
    const exportedCanvases=cloned.querySelectorAll('canvas');
    for(let i=0;i<originalCanvases.length;i++){
      try {
        const original=originalCanvases[i],copy=exportedCanvases[i];
        if(!copy||!original.width||!original.height)continue;
        const img=cloned.ownerDocument.createElement('img');
        img.setAttribute('src',original.toDataURL('image/png'));
        img.setAttribute('alt','Rendered diagram');
        img.style.cssText=copy.style.cssText;
        copy.replaceWith(img);
      }catch(_){ /* Keep the non-raster canvas fallback if extraction is blocked. */ }
    }
    flattenVisualsForDocument(cloned,theme,layoutWidth,visualMetrics);
    if(global.LocalWikiPdfExport)
      await global.LocalWikiPdfExport.render(cloned,budget,{maxBytes:MAX_TOTAL_BYTES});
    // The live Markdown renderer nests structured attachment <span>s inside
    // <p>s. Its snapshot copied a fixed, scroll-viewport-sized height to BOTH
    // elements. Simply removing the grey span is not enough: the leftover <p>
    // stays ~580px tall and pushes the actual SVG below an empty rectangle.
    // Rebuild these as real block-level elements, never <p><section> (invalid
    // HTML which the standalone browser would silently reparent).
    for(const embed of Array.from(cloned.querySelectorAll('.wiki-structured-embed'))) {
      const visual=embed.querySelector('.wiki-canvas-viewer,.wiki-drawio-viewer,.wiki-bases-viewer');
      if(!visual)continue;
      const clean=cloned.ownerDocument.createElement('section');
      clean.className='wiki-export-structured';
      clean.style.cssText='display:block!important;position:relative!important;'+
        'box-sizing:border-box!important;width:100%!important;max-width:100%!important;'+
        'margin:14px auto!important;padding:0!important;'+
        'background:transparent!important;border:0!important;'+
        'height:auto!important;min-height:0!important;overflow:visible!important;';
      clean.append(visual);
      const paragraph=embed.parentElement;
      if(paragraph?.localName==='p') {
        const before=paragraph.cloneNode(false),after=paragraph.cloneNode(false);
        before.style.setProperty('height','auto','important');
        after.style.setProperty('height','auto','important');
        let passed=false;
        for(const node of Array.from(paragraph.childNodes)){
          if(node===embed){passed=true;continue;}
          (passed?after:before).append(node);
        }
        const meaningful=element=>element.children.length>0 ||
          Boolean(element.textContent.trim());
        const replacements=[];
        if(meaningful(before))replacements.push(before);
        replacements.push(clean);
        if(meaningful(after))replacements.push(after);
        paragraph.replaceWith(...replacements);
      } else {
        embed.replaceWith(clean);
      }
    }
    // Browsers may snapshot the closed <details> at zero intrinsic height.
    // Restore native disclosure behavior so YAML expands correctly offline.
    for(const details of cloned.querySelectorAll('details.obsidian-properties')){
      for(const key of ['height','max-height','min-height','overflow','overflow-x','overflow-y'])
        details.style.removeProperty(key);
      details.style.setProperty('height','auto','important');
      details.style.setProperty('overflow','visible','important');
      const summary=details.querySelector(':scope > summary');
      if(summary){
        summary.style.setProperty('display','list-item','important');
        summary.style.setProperty('height','auto','important');
        summary.style.setProperty('overflow','visible','important');
        summary.style.setProperty('cursor','pointer','important');
      }
      for(const content of details.querySelectorAll('pre')){
        content.style.setProperty('display','block','important');
        content.style.setProperty('height','auto','important');
        content.style.setProperty('max-height','none','important');
        content.style.setProperty('overflow','visible','important');
        content.style.setProperty('white-space','pre-wrap','important');
      }
    }
    // Bases uses buttons for interactive row navigation. Removing every
    // button from a standalone document erased the corresponding note names.
    // Keep their plain, non-interactive labels in exported tables.
    for(const button of cloned.querySelectorAll('.bases-open-note')){
      const label=cloned.ownerDocument.createElement('span');
      label.className='wiki-export-base-note';
      label.textContent=button.textContent;
      button.replaceWith(label);
    }
    if (theme==='light') {
      // Explicit final guarantee for the native PDF document, independent of
      // the source theme or any user-configured stylesheet load delays.
      cloned.style.setProperty('background-color','#fff','important');
      cloned.style.setProperty('color','#252c34','important');
    }
    cloned.querySelectorAll(REMOVE+',.drawio-tabs,.drawio-controls,.drawio-summary,'+
      '.bases-tabs,.bases-intro,.bases-status,.structured-embed-header,'+
      '.canvas-controls,.canvas-summary').forEach(node=>node.remove());
    // Reject remaining references that would require an external resource, while
    // preserving anchors, gradient markers and SVG clip-path IDs.
    for (const element of cloned.querySelectorAll('*')) {
      Array.from(element.attributes).forEach(attribute=>{
        const attr=attribute.name.toLowerCase(),value=attribute.value;
        if (attr.startsWith('on') || attr==='srcset' || attr==='autoplay') element.removeAttribute(attribute.name);
        if (RESOURCE_ATTRS.includes(attr) &&
            (attr!=='href' || element.localName!=='a') &&
            !isLocalResource(value) && !isTrustedInlineReference(value))
          element.removeAttribute(attribute.name);
      });
    }
    const renderedStyle=source.ownerDocument.defaultView.getComputedStyle(source);
    const color=renderedStyle.color || '#222';
    const background=renderedStyle.backgroundColor || '#fff';
    const width=Math.max(760,Math.round(source.clientWidth || source.getBoundingClientRect().width || 900));
    const name=validTitle(title);
    // Inline style snapshot is self-contained; no libraries, fonts, network or
    // scripts are referenced. Print-specific rules only remove viewport clipping.
    const html='<!doctype html>\n<html lang="cs"><head><meta charset="utf-8">'+
      '<meta name="viewport" content="width=device-width,initial-scale=1">'+
      '<meta name="referrer" content="no-referrer">'+
      '<title>'+escapeHtml(name)+'</title>\n<style>'+
      'html{background:'+background+';color:'+color+';}'+
      'body{margin:0;padding:0;background:'+background+';color:'+color+';'+
      'font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;}'+
      '.wiki-export-preview{margin:0 auto;max-width:100%;width:'+width+'px;'+
      'height:auto!important;min-height:0!important;overflow:visible!important;flex:none!important;}'+
      '.wiki-export-preview .visualization{overflow:visible!important;}'+
      '.wiki-export-preview .wiki-export-structured{background:transparent!important;'+
      'border:0!important;padding:0!important;overflow:visible!important;}'+
      '.wiki-export-preview details.obsidian-properties{height:auto!important;'+
      'max-height:none!important;overflow:visible!important;}'+
      '.wiki-export-preview details.obsidian-properties>summary{display:list-item!important;'+
      'height:auto!important;overflow:visible!important;cursor:pointer!important;}'+
      '.wiki-export-preview details.obsidian-properties pre{display:block!important;'+
      'height:auto!important;max-height:none!important;white-space:pre-wrap!important;'+
      'overflow:visible!important;}'+
      '.wiki-export-preview .wiki-bases-viewer{height:auto!important;'+
      'max-height:none!important;min-height:0!important;overflow:visible!important;}'+
      '.wiki-export-preview .wiki-export-pdf-pages{height:auto!important;'+
      'max-height:none!important;overflow:visible!important;}'+
      'img,svg{max-width:100%;}'+
      CENTER_MEDIA_STYLES+
      PRINT_STYLES+
      '</style></head><body>\n'+
      '<main class="wiki-export-preview markdown-preview" style="'+escapeHtml(cloned.style.cssText)+'">'+cloned.innerHTML+
      '</main>\n</body></html>';
    return html;
    } finally {snapshot.frame.remove();}
  }
  function waitForReady(preview,isPending=()=>false) {
    return new Promise((resolve,reject)=>{
      let quietSince=Date.now(),done=false;
      const observer=new MutationObserver(()=>{quietSince=Date.now();});
      const cleanup=()=>{if(done)return;done=true;observer.disconnect();clearInterval(timer);};
      const timer=setInterval(()=>{
        if (!preview.isConnected){cleanup();reject(new Error('The preview was closed during export.'));return;}
        const images=Array.from(preview.querySelectorAll('img'));
        const loading=images.some(image=>image.getAttribute('src') && !image.complete);
        const visualPending=!!preview.querySelector('[data-export-pending="true"],.drawio-loading,.canvas-note-loading');
        if (!loading && !visualPending && !isPending() && Date.now()-quietSince>=400) {
          cleanup();resolve();return;
        }
        if (Date.now()-start>=10000){
          cleanup();reject(new Error('The preview is still rendering. Wait for diagrams and images to finish, then try again.'));
        }
      },100);
      const start=Date.now();
      observer.observe(preview,{subtree:true,childList:true,attributes:true,
        attributeFilter:['src','style','width','height']});
    });
  }
  function downloadHtml(html,filename) {
    const blob=new Blob([html],{type:'text/html;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;link.download=filename;
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),15000);
  }
  function openPrintWindow(title='Preparing PDF preview…') {
    // Must open synchronously from the real click, before asynchronous
    // image/diagram serialization, to avoid browser popup blocking.
    const popup=global.open('','_blank');
    if (!popup) throw new Error('The browser blocked the preview window. Allow this popup and try again.');
    popup.document.open();
    popup.document.write('<!doctype html><html><head><title>'+escapeHtml(title)+'</title></head>'+
      '<body><p>Preparing the local document preview…</p></body></html>');
    popup.document.close();
    return popup;
  }
  function showHtmlPreview(html,popup,filename,onLocalLink) {
    if (!popup || popup.closed) throw new Error('The HTML preview tab was closed.');
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    // This toolbar exists only in the preview tab, not in the downloadable
    // standalone HTML. Download is a user-triggered link to a local Blob.
    const doc=popup.document;
    const toolbar=doc.createElement('nav');
    toolbar.setAttribute('aria-label','HTML preview actions');
    toolbar.className='wiki-html-preview-toolbar';
    const save=doc.createElement('a');
    save.textContent='Download HTML';
    save.download=filename;
    save.href=popup.URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));
    const close=doc.createElement('button');
    close.type='button';close.textContent='Close preview';
    close.addEventListener('click',()=>popup.close());
    toolbar.append(save,close);
    const style=doc.createElement('style');
    style.textContent='.wiki-html-preview-toolbar{position:sticky;top:0;z-index:10000;'+
      'display:flex;gap:10px;align-items:center;justify-content:flex-end;'+
      'padding:9px 16px;background:#f5f7f9;color:#252c34;border-bottom:1px solid #d9dde2;'+
      'font:13px system-ui,Arial,sans-serif}'+
      '.wiki-html-preview-toolbar a,.wiki-html-preview-toolbar button{'+
      'display:inline-flex;align-items:center;padding:7px 12px;'+
      'border:1px solid #58a36a;border-radius:6px;background:#fff;'+
      'color:#24372c;text-decoration:none;cursor:pointer;font:inherit}'+
      '@media print{.wiki-html-preview-toolbar{display:none!important}}';
    doc.head.append(style);
    doc.body.prepend(toolbar);
    // Only the live HTML preview tab can ask its opener to show another wiki
    // note. Downloaded HTML stays script-free and fully standalone. Relative
    // destinations still work there if the user keeps files alongside it.
    if(typeof onLocalLink==='function'){
      doc.body.addEventListener('click',event=>{
        const anchor=event.target.closest?.('a[href]');
        if(!anchor || !doc.body.contains(anchor))return;
        const href=anchor.getAttribute('href')||'';
        if(!safeDocumentHref(href)||href.startsWith('#')||
          /^(?:https?:\/\/|mailto:)/i.test(href))return;
        event.preventDefault();
        Promise.resolve().then(()=>onLocalLink(href)).catch(error=>{
          // Browser preview remains available even if a linked note is missing.
          const message=doc.createElement('span');
          message.setAttribute('role','status');
          message.textContent='Cannot open linked wiki note: '+error.message;
          toolbar.append(message);
        });
      });
    }
    popup.focus();
  }
  // A ready PDF preview is opened in its own tab without immediately running
  // window.print(). Chromium's modal print dialog can suspend other tabs in
  // the same browser process: the user invokes it only when they choose.
  async function showPdfPreview(html,popup) {
    if (!popup || popup.closed) throw new Error('The PDF preview tab was closed.');
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    const doc=popup.document;
    const controls=doc.createElement('nav');
    controls.className='wiki-pdf-preview-toolbar';
    controls.setAttribute('aria-label','PDF export actions');
    const message=doc.createElement('span');
    message.textContent='A4 print preview · ready to save as PDF';
    const print=doc.createElement('button');
    print.type='button';print.textContent='Print / Save PDF';
    const close=doc.createElement('button');
    close.type='button';close.textContent='Close preview';
    close.addEventListener('click',()=>popup.close());
    controls.append(message,print,close);
    print.disabled=true;
    message.textContent='Preparing PDF preview images…';
    const styles=doc.createElement('style');
    styles.textContent='.wiki-pdf-preview-toolbar{position:sticky;top:0;z-index:10000;'+
      'display:flex;gap:10px;align-items:center;justify-content:flex-end;'+
      'padding:10px 15px;background:#f5f7f9;border-bottom:1px solid #d9dde2;'+
      'font:13px system-ui,Arial,sans-serif;color:#2b3035}'+
      '.wiki-pdf-preview-toolbar span{margin-right:auto}'+
      '.wiki-pdf-preview-toolbar button{padding:7px 12px;border:1px solid #58a36a;'+
      'border-radius:6px;background:#fff;color:#26382c;font:inherit;cursor:pointer}'+
      '@media print{.wiki-pdf-preview-toolbar{display:none!important}}';
    doc.head.append(styles);
    doc.body.prepend(controls);
    // Wait for all inline images and fonts before enabling print. This retains
    // the old export's readiness guarantee without blocking the opener tab.
    const images=Array.from(doc.images);
    await Promise.all(images.map(img=>img.complete?Promise.resolve():
      new Promise(resolve=>{
        img.addEventListener('load',resolve,{once:true});
        img.addEventListener('error',resolve,{once:true});
      })));
    try{await doc.fonts.ready;}catch(_){}
    await new Promise(resolve=>popup.requestAnimationFrame(()=>
      popup.requestAnimationFrame(resolve)));
    if(popup.closed)return;
    print.disabled=false;
    message.textContent='A4 print preview · ready to save as PDF';
    print.addEventListener('click',()=>{
      if(!popup.closed){popup.focus();popup.print();}
    });
    // The print dialog is deliberately NOT auto-opened; keep the original
    // StackEdit tab interactive during PDF preparation and review.
    popup.focus();
  }
  async function printHtml(html,popup) {
    if (!popup || popup.closed) throw new Error('The PDF print window was closed.');
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    // Loaded local data images/SVG and native fonts must be ready before print.
    const images=Array.from(popup.document.images);
    await Promise.all(images.map(img=>img.complete?Promise.resolve():
      new Promise(resolve=>{
        img.addEventListener('load',resolve,{once:true});
        img.addEventListener('error',resolve,{once:true});
      })));
    try {await popup.document.fonts.ready;} catch(_){}
    // Chrome captures print layout at the start of print(); allow two layout
    // frames for intrinsic SVG dimensions and static Canvas graph sizing.
    await new Promise(resolve=>popup.requestAnimationFrame(()=>
      popup.requestAnimationFrame(resolve)));
    if (!popup.closed){popup.focus();popup.print();}
  }
  global.LocalWikiPreviewExport={build,downloadHtml,openPrintWindow,showHtmlPreview,showPdfPreview,printHtml,waitForReady,fileName,escapeHtml};
})(window);
