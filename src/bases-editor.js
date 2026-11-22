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
    const footer=create('div','bases-edit-footer');
    const message=create('p','bases-edit-message');
    message.setAttribute('role','status');
    const confirm=create('div','bases-edit-confirm');
    confirm.hidden=true;
    footer.append(message,confirm);
    root.append(note,toolbar,textarea,footer);
    // Keep exit decisions alongside the host's bottom buttons, not inside
    // the source editor viewport (which introduced a second scrolling row).
    if(options.confirmHost)options.confirmHost.insertBefore(
      confirm,options.closeButton||null);
    let fingerprint=options.fingerprint,disposed=false,saving=false,pendingTrigger=null;
    function button(label,cb){
      const el=create('button','canvas-control',label);
      el.type='button';el.addEventListener('click',cb);toolbar.append(el);return el;
    }
    function clearConfirm(){
      confirm.hidden=true;
      pendingTrigger?.classList.remove('asset-exit-pending');
      pendingTrigger=null;
    }
    async function persist(){
      if(saving)return false;
      if(!draft.dirty)return true;
      saving=true;
      save.disabled=true;
      message.textContent='Checking source file and saving Base YAML…';
      try {
        validate(draft.value);
        const result=await options.onSave(draft.value,fingerprint);
        fingerprint=result.fingerprint;
        draft.markSaved();
        message.textContent='Base YAML saved safely.';
        clearConfirm();
        return true;
      }catch(error){
        message.textContent=(error.code==='EXTERNAL_CHANGE'?
          'External modification detected. Nothing was overwritten: ':'Save failed: ')+error.message;
        return false;
      }finally{saving=false;refresh();}
    }
    const save=button('💾 Save changes',()=>void persist());
    save.classList.add('asset-footer-save');
    save.setAttribute('aria-label','Save changes');
    save.remove();
    function showConfirm(action,trigger){
      clearConfirm();
      const discard=create('button','canvas-control asset-confirm-discard','Discard');
      discard.type='button';
      discard.onclick=()=>{
        draft.discard();textarea.value=draft.value;
        clearConfirm();refresh();
        action?.();
      };
      const saveChanges=create('button','canvas-control asset-confirm-save','Save');
      saveChanges.setAttribute('aria-label','Save changes');
      saveChanges.type='button';
      saveChanges.onclick=async()=>{if(await persist())action?.();};
      confirm.replaceChildren(discard,saveChanges);
      confirm.hidden=false;
      pendingTrigger=trigger||null;
      pendingTrigger?.classList.add('asset-exit-pending');
      saveChanges.focus();
    }
    button('Discard',()=>{
      if(!draft.dirty){message.textContent='Nothing to discard.';return;}
      showConfirm(()=>{message.textContent='Unsaved changes discarded.';});
    });
    const preview=button('↪ Back to preview',()=>{
      if(draft.dirty)showConfirm(()=>options.onPreview?.(),preview);
      else options.onPreview?.();
    });
    preview.classList.add('asset-back-to-preview');
    preview.remove();
    function refresh(){
      save.disabled=saving||!draft.dirty;
      root.dataset.dirty=draft.dirty?'true':'false';
      if(!message.textContent||/^Base YAML · /.test(message.textContent))
        message.textContent='Base YAML · '+(draft.dirty?'unsaved changes':'no unsaved changes');
    }
    textarea.addEventListener('input',()=>{
      clearConfirm();
      try {draft.replace(textarea.value);message.textContent='';refresh();}
      catch(error){message.textContent=error.message;save.disabled=true;}
    });
    function requestClose(){
      if(saving)return false;
      if(draft.dirty){
        showConfirm(()=>options.onClose?.(),options.closeButton);
        return false;
      }
      return true;
    }
    refresh();
    return {
      root,requestClose,previewButton:preview,saveButton:save,
      get isDirty(){return draft.dirty;},
      dispose(){disposed=true;clearConfirm();preview.remove();save.remove();confirm.remove();},
      get disposed(){return disposed;}
    };
  }
  global.LocalWikiBasesEditor={createDraft,validate,mount};
})(window);
