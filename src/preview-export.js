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
  function copyStyle(source,target) {
    if (!(source instanceof Element) || !(target instanceof Element)) return;
    const css=getComputedStyle(source);
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
  async function build(preview,{title='Wiki preview'}={}) {
    if (!preview || !preview.isConnected) throw new Error('No rendered preview is available.');
    const cloned=preview.cloneNode(true);
    const originals=[preview,...preview.querySelectorAll('*')];
    const copies=[cloned,...cloned.querySelectorAll('*')];
    const budget={bytes:0},cache=new Map();
    for(let i=0;i<originals.length;i++){
      const original=originals[i],copy=copies[i];
      if (!(original instanceof Element) || !(copy instanceof Element)) continue;
      cleanUrls(copy);
      // Do not clone an untrusted stylesheet into a standalone HTML document.
      if (copy.localName!=='style') copyStyle(original,copy);
      await inlineMedia(original,copy,budget,cache);
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
    const color=getComputedStyle(preview).color || '#222';
    const background=getComputedStyle(preview).backgroundColor || '#fff';
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
      '@media print{@page{size:auto;margin:12mm;}'+
      'html,body{background:'+background+'!important;'+
      '-webkit-print-color-adjust:exact;print-color-adjust:exact;}'+
      '.wiki-export-preview{width:100%!important;max-width:100%!important;'+
      'padding:0!important;overflow:visible!important;}'+
      '.wiki-export-preview pre,.wiki-export-preview table{overflow:visible!important;}'+
      '.wiki-export-preview .visualization{break-inside:avoid;page-break-inside:avoid;}'+
      '.wiki-export-preview img,.wiki-export-preview svg{max-width:100%!important;}}'+
      '</style></head><body>\n'+
      '<main class="wiki-export-preview markdown-preview">'+cloned.innerHTML+
      '</main>\n</body></html>';
    return html;
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
  global.LocalWikiPreviewExport={build,downloadHtml,openPrintWindow,printHtml,fileName,escapeHtml};
})(window);
