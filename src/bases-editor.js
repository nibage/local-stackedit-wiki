/* Offline source-preserving Obsidian Bases YAML editor for the supported safe YAML subset. */
(function (global) {
  'use strict';
  const MAX_LENGTH=2*1024*1024;
  function createDraft(source) {
    if (typeof source!=='string' || source.length>MAX_LENGTH)
      throw new Error('Base source is not valid text or exceeds the editing limit.');
    let saved=source, value=source;
    return {
      get value(){return value;},
      get dirty(){return value!==saved;},
      replace(text){
        if (typeof text!=='string' || text.length>MAX_LENGTH)
          throw new Error('Base source exceeds the 2 MB limit.');
        value=text;
      },
      discard(){value=saved;},
      markSaved(){saved=value;}
    };
  }
  function validate(source) {
    if (typeof source!=='string' || source.length>MAX_LENGTH)
      throw new Error('Bases YAML exceeds the editing limit.');
    const data=global.LocalWikiBases.parseYaml(source);
    if (!data || typeof data!=='object' || Array.isArray(data))
      throw new Error('A .base file must contain a YAML mapping.');
    if (!Array.isArray(data.views)) throw new Error('A .base file must contain a views list.');
    if (!data.views.every(view=>view && typeof view==='object' && !Array.isArray(view)))
      throw new Error('Every Bases view must be a mapping.');
    return true;
  }
  function create(tag,cls,label){
    const el=document.createElement(tag);
    if(cls)el.className=cls;
    if(label!==undefined)el.textContent=label;
    return el;
  }
  function mount(source,options={}) {
    const draft=createDraft(source);
    validate(draft.value); // Unsupported/unsafe YAML must never be rewritten.
    const root=create('div','bases-source-editor');
    const note=create('p','bases-edit-note',
      'Edit the .base YAML source. Comments and unfamiliar keys are preserved as written. Only the safe supported YAML subset can be saved; Markdown note properties are not edited here.');
    const toolbar=create('div','bases-edit-toolbar');
    const textarea=create('textarea','bases-edit-text');
    textarea.setAttribute('aria-label','Edit Base YAML');
    textarea.setAttribute('spellcheck','false');
    textarea.value=source;
    const message=create('p','bases-edit-message');
    message.setAttribute('role','status');
    const confirm=create('div','bases-edit-confirm');
    confirm.hidden=true;
    root.append(note,toolbar,textarea,message,confirm);
    let fingerprint=options.fingerprint,disposed=false,saving=false;
    function button(label,cb){
      const el=create('button','canvas-control',label);
      el.type='button';el.addEventListener('click',cb);toolbar.append(el);return el;
    }
    const save=button('Save Base',async()=>{
      if(saving || !draft.dirty) return;
      saving=true;save.disabled=true;
      try {
        validate(draft.value);
        const result=await options.onSave(draft.value,fingerprint);
        fingerprint=result.fingerprint;
        draft.markSaved();
        message.textContent='Base YAML saved safely.';
        confirm.hidden=true;
      }catch(error){
        message.textContent=(error.code==='EXTERNAL_CHANGE'?'External modification detected. Nothing was overwritten: ':'Save failed: ')+error.message;
      }finally{saving=false;refresh();}
    });
    button('Discard',()=>{
      if(!draft.dirty){message.textContent='Nothing to discard.';return;}
      showConfirm('Discard all unsaved edits?',()=>{
        draft.discard();textarea.value=draft.value;refresh();
        message.textContent='Unsaved changes discarded.';
      });
    });
    button('Preview',()=>{
      if(draft.dirty) showConfirm('Discard unsaved changes and return to preview?',()=>{
        draft.discard();options.onPreview?.();
      });
      else options.onPreview?.();
    });
    function showConfirm(question,yes){
      confirm.replaceChildren(create('span','',question));
      const accept=create('button','canvas-control','Discard changes');
      accept.type='button';accept.onclick=()=>{confirm.hidden=true;yes();};
      const cancel=create('button','canvas-control','Keep editing');
      cancel.type='button';cancel.onclick=()=>{confirm.hidden=true;textarea.focus();};
      confirm.append(accept,cancel);confirm.hidden=false;cancel.focus();
    }
    function refresh(){
      save.disabled=saving || !draft.dirty;
      root.dataset.dirty=draft.dirty?'true':'false';
      if(!message.textContent || /^Base YAML · /.test(message.textContent))
        message.textContent='Base YAML · '+(draft.dirty?'unsaved changes':'no unsaved changes');
    }
    textarea.addEventListener('input',()=>{
      try {draft.replace(textarea.value);refresh();}
      catch(error){message.textContent=error.message;save.disabled=true;}
    });
    function requestClose(){
      if(saving) return false;
      if(draft.dirty){showConfirm('Discard unsaved Base YAML changes before closing?',()=>{
        draft.discard();options.onClose?.();
      });return false;}
      return true;
    }
    refresh();
    return {
      root,requestClose,
      get isDirty(){return draft.dirty;},
      dispose(){disposed=true;},
      get disposed(){return disposed;}
    };
  }
  global.LocalWikiBasesEditor={createDraft,validate,mount};
})(window);
