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
  async function lightThemeSnapshot(preview) {
    // Create an off-screen same-origin document with the actual light-theme
    // stylesheets. Never change the application's selected theme or print dark
    // inline CSS values. No scripts are copied, no external hosts are allowed.
    const frame=document.createElement('iframe');
    frame.setAttribute('aria-hidden','true');
    frame.tabIndex=-1;
    frame.style.cssText='position:fixed;left:-200vw;top:0;opacity:0;'+
      'pointer-events:none;border:0;height:30px;width:'+
      Math.max(320,preview.clientWidth||780)+'px;';
    document.body.append(frame);
    try {
      const doc=frame.contentDocument;
      doc.documentElement.dataset.theme='light';
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
      const lightPalette=doc.createElement('style');
      lightPalette.textContent=':root[data-theme="light"]{color-scheme:light;'+
        '--panel:#fff;--panel-alt:#f7f8fa;--text:#252c34;--muted:#677182;--line:#d9dde2;}'+
        '[data-theme="light"] .markdown-preview{background:#fff!important;'+
        'color:#252c34!important;}';
      doc.head.append(lightPalette);
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
  function cleanUrls(element) {
    Array.from(element.attributes).forEach(attribute=>{
      const name=attribute.name.toLowerCase();
      if (name.startsWith('on') || name==='srcset' || name==='formaction' ||
          name==='autofocus' || name==='autoplay' || name==='contenteditable')
        element.removeAttribute(attribute.name);
    });
    if (element.matches('a')) {
      const href=element.getAttribute('href')||'';
      if (!/^(?:https?:\/\/|mailto:|#)/i.test(href)) element.removeAttribute('href');
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
      if (/^wiki:/i.test(raw)) {
        let spec=raw.slice(5);
        try {spec=decodeURIComponent(spec);}catch(_){}
        const split=spec.indexOf('#');
        const file=split>=0?spec.slice(0,split):spec;
        const section=split>=0?spec.slice(split+1):'';
        const page=String(title).replace(/\.(?:md|markdown)$/i,'');
        if (section && (!file || normalized(file.replace(/\.(?:md|markdown)$/i,''))===normalized(page)))
          target=toHeading(section);
      }
      if (target) anchor.setAttribute('href','#'+target);
      else if (raw.startsWith('#') || /^wiki:/i.test(raw)) anchor.removeAttribute('href');
    }
  }
  async function build(preview,{title='Wiki preview',theme='current'}={}) {
    if (!preview || !preview.isConnected) throw new Error('No rendered preview is available.');
    const light=theme==='light'?await lightThemeSnapshot(preview):null;
    const source=light?.node||preview;
    try {
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
    if (theme==='light') {
      // Explicit final guarantee for the native PDF document, independent of
      // the source theme or any user-configured stylesheet load delays.
      cloned.style.setProperty('background-color','#fff','important');
      cloned.style.setProperty('color','#252c34','important');
    }
    cloned.querySelectorAll(REMOVE).forEach(node=>node.remove());
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
    const width=Math.max(320,Math.round(preview.clientWidth || preview.getBoundingClientRect().width || 780));
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
      'img,svg{max-width:100%;}'+
      /* StackEdit-like printed article: centred ~470pt reading column,
         12pt body text and generous headings. Inline snapshots use fixed
         computed values, so printed typography must override them. */
      '@media print{@page{size:A4;margin:12mm 17mm 17mm;}'+
      'html,body{background:#fff!important;color:#333!important;'+
      'font-family:Arial,"Helvetica Neue",sans-serif!important;'+
      '-webkit-print-color-adjust:exact;print-color-adjust:exact;}'+
      '.wiki-export-preview{box-sizing:border-box!important;display:block!important;'+
      'width:100%!important;max-width:470pt!important;margin:0 auto!important;'+
      'padding:0!important;height:auto!important;min-height:0!important;'+
      'overflow:visible!important;flex:none!important;'+
      'background:#fff!important;color:#333!important;'+
      'font-family:Arial,"Helvetica Neue",sans-serif!important;'+
      'font-size:16px!important;line-height:1.72!important;}'+
      '.wiki-export-preview p,.wiki-export-preview li,.wiki-export-preview blockquote{'+
      'font-size:16px!important;line-height:1.72!important;letter-spacing:normal!important;}'+
      '.wiki-export-preview p{margin:0 0 1.25em!important;}'+
      '.wiki-export-preview ul,.wiki-export-preview ol{margin:0 0 1.35em!important;'+
      'padding-left:1.8em!important;}'+
      '.wiki-export-preview h1,.wiki-export-preview h2,.wiki-export-preview h3,'+
      '.wiki-export-preview h4,.wiki-export-preview h5,.wiki-export-preview h6{'+
      'font-family:Arial,"Helvetica Neue",sans-serif!important;color:#333!important;'+
      'font-weight:700!important;line-height:1.25!important;'+
      'margin:1.85em 0 .76em!important;padding-bottom:.27em!important;'+
      'border-bottom:1px solid #d9d9d9!important;break-after:avoid;}'+
      '.wiki-export-preview h1{font-size:30px!important;}'+
      '.wiki-export-preview h2{font-size:25px!important;}'+
      '.wiki-export-preview>h1:first-child,.wiki-export-preview>h2:first-child{margin-top:0!important;}'+
      '.wiki-export-preview h1,.wiki-export-preview h2{margin-bottom:1.25em!important;}'+
      '.wiki-export-preview h3{font-size:21px!important;}'+
      '.wiki-export-preview h4,.wiki-export-preview h5{font-size:18px!important;}'+
      '.wiki-export-preview a[href]{color:#247fb9!important;text-decoration:underline!important;}'+
      '.wiki-export-preview blockquote{background:transparent!important;'+
      'border-left:4px solid #dedede!important;color:#666!important;'+
      'padding:.15em 1.1em!important;}'+
      '.wiki-export-preview pre{font-size:13px!important;line-height:1.5!important;'+
      'white-space:pre-wrap!important;overflow:visible!important;'+
      'background:#f6f6f6!important;border-color:#ddd!important;}'+
      '.wiki-export-preview table{display:table!important;max-width:100%!important;'+
      'width:auto!important;overflow:visible!important;break-inside:auto;}'+
      '.wiki-export-preview tr{break-inside:avoid;}'+
      '.wiki-export-preview th{background:#f4f4f4!important;color:#333!important;}'+
      '.wiki-export-preview .visualization{overflow:visible!important;'+
      'break-inside:avoid;page-break-inside:avoid;}'+
      '.wiki-export-preview img,.wiki-export-preview svg{max-width:100%!important;'+
      'height:auto;break-inside:avoid;page-break-inside:avoid;}'+
      '.wiki-export-preview .MathJax_MathML{max-width:100%!important;}'+
      '}'+
      '</style></head><body>\n'+
      '<main class="wiki-export-preview markdown-preview" style="'+escapeHtml(cloned.style.cssText)+'">'+cloned.innerHTML+
      '</main>\n</body></html>';
    return html;
    } finally {if (light) light.frame.remove();}
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
        if (!loading && !isPending() && Date.now()-quietSince>=400) {
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
  function openPrintWindow() {
    // Must open synchronously from the real click, before asynchronous
    // image/diagram serialization, to avoid browser popup blocking.
    const popup=global.open('','_blank');
    if (!popup) throw new Error('The browser blocked the print window. Allow this popup and try again.');
    popup.document.open();
    popup.document.write('<!doctype html><html><head><title>Preparing PDF preview…</title></head>'+
      '<body><p>Preparing the printable preview…</p></body></html>');
    popup.document.close();
    return popup;
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
    if (!popup.closed){popup.focus();popup.print();}
  }
  global.LocalWikiPreviewExport={build,downloadHtml,openPrintWindow,printHtml,waitForReady,fileName,escapeHtml};
})(window);
