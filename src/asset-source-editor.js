/* Source-preserving, offline raw JSON Canvas / draw.io XML editor.
 * Unlike the visual editors this intentionally preserves original text,
 * comments (XML), whitespace and unfamiliar but safe document properties.
 */
(function(global){
  'use strict';
  const MAX_BYTES=2*1024*1024;
  function validate(text,kind){
    if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_BYTES)
      throw new Error('Source must be text smaller than 2 MB.');
    if(kind==='canvas'){
      let doc;
      try{doc=JSON.parse(text);}catch(error){throw new Error('Canvas JSON: '+error.message);}
      global.LocalWikiCanvasEditor.validate(doc);
    }else if(kind==='drawio'){
      global.LocalWikiDrawio.parseFile(text);
    }else throw new Error('Unsupported source editor kind.');
    return true;
  }
  function mount(source,{kind,fingerprint,onSave,onPreview,onClose}={}){
    validate(source,kind);
    const root=document.createElement('section');
    root.className='bases-source-editor asset-source-editor';
    const title=kind==='canvas'?'Canvas JSON':'draw.io XML';
    const hint=document.createElement('p');
    hint.className='bases-edit-note';
    hint.textContent='Edit the original '+title+' source. Changes are validated before saving. '+
      'Unknown supported fields are preserved, and external file changes are never overwritten.';
    const toolbar=document.createElement('div');
    toolbar.className='bases-edit-toolbar';
    const textarea=document.createElement('textarea');
    textarea.className='bases-edit-text';
    textarea.setAttribute('spellcheck','false');
    textarea.setAttribute('aria-label','Edit base '+title);
    textarea.value=source;
    const message=document.createElement('p');
    message.className='bases-edit-message';
    message.setAttribute('role','status');
    const confirm=document.createElement('div');
    confirm.className='bases-edit-confirm';confirm.hidden=true;
    root.append(hint,toolbar,textarea,message,confirm);
    let saved=source,disposed=false,saving=false,actualFingerprint=fingerprint;
    const dirty=()=>textarea.value!==saved;
    function button(label,fn){
      const el=document.createElement('button');
      el.type='button';el.className='canvas-control';
      el.textContent=label;el.addEventListener('click',fn);toolbar.append(el);
      return el;
    }
    function update(){
      root.dataset.dirty=dirty()?'true':'false';
      save.disabled=saving||!dirty();
      if(!message.textContent||message.textContent.startsWith(title+' · '))
        message.textContent=title+' · '+(dirty()?'unsaved changes':'no unsaved changes');
    }
    async function persist(){
      if(saving)return false;
      if(!dirty())return true;
      saving=true;update();message.textContent='Validating and saving '+title+'…';
      try{
        validate(textarea.value,kind);
        const result=await onSave(textarea.value,actualFingerprint);
        actualFingerprint=result.fingerprint;
        saved=textarea.value;
        confirm.hidden=true;
        message.textContent=title+' saved safely.';
        return true;
      }catch(error){
        message.textContent=(error.code==='EXTERNAL_CHANGE'?
          'External file change detected. Nothing overwritten: ':'Save failed: ')+error.message;
        return false;
      }finally{saving=false;update();}
    }
    const save=button('Save '+title,()=>void persist());
    function askBeforeLeaving(action){
      if(saving)return false;
      if(!dirty()){action();return true;}
      confirm.replaceChildren();
      const prompt=document.createElement('span');
      prompt.textContent='Save or discard unsaved '+title+' changes?';
      const discard=document.createElement('button');
      discard.type='button';discard.className='canvas-control';
      discard.textContent='Discard changes';
      discard.onclick=()=>{textarea.value=saved;update();confirm.hidden=true;action();};
      const saveExit=document.createElement('button');
      saveExit.type='button';saveExit.className='canvas-control asset-source-confirm-save';
      saveExit.textContent='Save changes';
      saveExit.onclick=async()=>{if(await persist())action();};
      const keep=document.createElement('button');
      keep.type='button';keep.className='canvas-control';
      keep.textContent='Keep editing';
      keep.onclick=()=>{confirm.hidden=true;textarea.focus();};
      confirm.append(prompt,discard,saveExit,keep);confirm.hidden=false;
      saveExit.focus();
      return false;
    }
    button('Discard',()=>{if(dirty())askBeforeLeaving(()=>{message.textContent='Unsaved changes discarded.';});});
    button('Preview',()=>{askBeforeLeaving(()=>onPreview?.());});
    textarea.addEventListener('input',()=>{confirm.hidden=true;message.textContent='';update();});
    update();
    return {
      root,validate,
      get isDirty(){return dirty();},
      requestClose(){
        if(saving)return false;
        if(!dirty())return true;
        askBeforeLeaving(()=>onClose?.());
        return false;
      },
      dispose(){disposed=true;},
      get disposed(){return disposed;}
    };
  }
  global.LocalWikiAssetSourceEditor={validate,mount};
})(window);
