/* Render local PDF attachments into ordinary static images for offline HTML/PDF export.
 * Uses bundled Apache-2.0 PDF.js only while exporting. Exported files need no
 * plug-in, external network, JavaScript or PDF worker.
 */
(function(global){
  'use strict';
  const localScript=global.document.currentScript?.src||'';
  let libraryPromise=null;
  function loadScript(url){
    return new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src=url;
      script.onload=resolve;
      script.onerror=()=>reject(new Error('Bundled PDF renderer could not load.'));
      document.head.append(script);
    });
  }
  async function library(){
    if(global.pdfjsLib&&global.pdfjsWorker)return global.pdfjsLib;
    if(!libraryPromise)libraryPromise=(async()=>{
      const base=new URL('../vendor/pdfjs/',localScript||document.baseURI);
      if(!global.pdfjsLib)await loadScript(new URL('pdf.min.js',base).href);
      // Fake worker lets a file:// standalone installation work offline.
      if(!global.pdfjsWorker)await loadScript(new URL('pdf.worker.min.js',base).href);
      if(!global.pdfjsLib)throw new Error('Bundled PDF renderer is missing.');
      global.pdfjsLib.GlobalWorkerOptions.workerSrc=new URL('pdf.worker.min.js',base).href;
      return global.pdfjsLib;
    })().catch(error=>{libraryPromise=null;throw error;});
    return libraryPromise;
  }
  function replaceAsBlock(object,block){
    const wrapper=object.closest('.wiki-attachment-embed')||object;
    const paragraph=wrapper.closest('p');
    if(!paragraph){wrapper.replaceWith(block);return;}
    let direct=wrapper;
    while(direct.parentElement!==paragraph&&direct.parentElement)direct=direct.parentElement;
    if(direct.parentElement!==paragraph){wrapper.replaceWith(block);return;}
    const before=paragraph.cloneNode(false),after=paragraph.cloneNode(false);
    for(const p of [before,after]){
      p.style.setProperty('height','auto','important');
      p.style.setProperty('min-height','0','important');
    }
    let passed=false;
    for(const child of Array.from(paragraph.childNodes)){
      if(child===direct){passed=true;continue;}
      (passed?after:before).append(child);
    }
    const meaningful=p=>p.children.length||p.textContent.trim();
    paragraph.replaceWith(...(meaningful(before)?[before]:[]),block,
      ...(meaningful(after)?[after]:[]));
  }
  async function render(cloned,budget,{maxBytes=64*1024*1024}={}){
    const pdfs=Array.from(cloned.querySelectorAll('object[data]')).filter(el=>
      /^data:application\/pdf;base64,/i.test(el.getAttribute('data')||''));
    if(!pdfs.length)return;
    let pdfjs=null;
    try{pdfjs=await library();}catch(_){}
    for(const object of pdfs){
      const section=document.createElement('section');
      section.className='wiki-export-pdf-pages';
      section.style.cssText='display:block;width:100%;height:auto!important;'+
        'max-height:none!important;overflow:visible!important;margin:16px auto;';
      let pdf=null,error=null;
      try{
        if(!pdfjs)throw new Error('offline PDF renderer unavailable');
        const data=object.getAttribute('data');
        const bytes=Uint8Array.from(atob(data.slice(data.indexOf(',')+1)),c=>c.charCodeAt(0));
        pdf=await pdfjs.getDocument({data:bytes,isEvalSupported:false,disableFontFace:true}).promise;
        if(pdf.numPages>80)throw new Error('PDF contains more than 80 pages');
        for(let n=1;n<=pdf.numPages;n++){
          const page=await pdf.getPage(n);
          const size=page.getViewport({scale:1});
          const scale=Math.max(.1,Math.min(2,1100/size.width,1500/size.height));
          const viewport=page.getViewport({scale});
          const canvas=document.createElement('canvas');
          canvas.width=Math.ceil(viewport.width);
          canvas.height=Math.ceil(viewport.height);
          if(canvas.width*canvas.height>4500000)
            throw new Error('PDF page exceeds the pixel safety limit');
          const context=canvas.getContext('2d',{alpha:false});
          if(!context)throw new Error('PDF canvas is unavailable');
          await page.render({canvasContext:context,viewport,background:'#ffffff'}).promise;
          const image=document.createElement('img');
          image.src=canvas.toDataURL('image/jpeg',.90);
          image.alt='Embedded PDF · page '+n+' of '+pdf.numPages;
          image.style.cssText='display:block;max-width:100%;height:auto;'+
            'margin:0 auto 12px;break-inside:avoid-page;';
          const sizeBytes=Math.ceil(image.src.length*.75);
          if(budget.bytes+sizeBytes>maxBytes)throw new Error('PDF pages exceed the export size limit');
          budget.bytes+=sizeBytes;
          section.append(image);
          canvas.width=0;canvas.height=0;
        }
      }catch(e){error=e;}
      finally{try{await pdf?.destroy();}catch(_){}}
      if(error){
        section.replaceChildren();
        const note=document.createElement('p');
        note.textContent='Embedded PDF cannot be displayed in this HTML export ('+
          error.message+'). Open the original PDF from the wiki.';
        section.append(note);
      }
      replaceAsBlock(object,section);
    }
  }
  global.LocalWikiPdfExport={render};
})(window);
