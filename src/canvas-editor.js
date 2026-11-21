/* Offline JSON Canvas editor. Draft mutations never touch disk until guarded Save. */
(function (global) {
  'use strict';
  const MAX_NODES = 400, MAX_EDGES = 1000, MAX_JSON = 2 * 1024 * 1024;
  const clone = value => JSON.parse(JSON.stringify(value));
  const encode = value => JSON.stringify(value);
  const validNumber = value => Number.isFinite(value) && Math.abs(value) <= 1000000;

  function validate(doc) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc) ||
        !Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) throw new Error('Canvas must contain nodes and edges arrays.');
    if (doc.nodes.length > MAX_NODES || doc.edges.length > MAX_EDGES) throw new Error('Canvas exceeds the editor safety limit.');
    const ids = new Set();
    for (const node of doc.nodes) {
      if (!node || typeof node !== 'object' || Array.isArray(node) ||
          typeof node.id !== 'string' || !node.id || ids.has(node.id) ||
          !['text','file','link','group'].includes(node.type) ||
          ![node.x,node.y,node.width,node.height].every(validNumber) ||
          node.width < 45 || node.height < 35) throw new Error('Invalid, unsupported or duplicate canvas node.');
      ids.add(node.id);
    }
    const edgeIds = new Set();
    for (const edge of doc.edges) {
      if (!edge || typeof edge !== 'object' || Array.isArray(edge) ||
          !ids.has(edge.fromNode) || !ids.has(edge.toNode) ||
          (edge.id !== undefined && (typeof edge.id !== 'string' || !edge.id || edgeIds.has(edge.id))))
        throw new Error('Invalid or dangling canvas connection.');
      if (edge.id) edgeIds.add(edge.id);
    }
    if (new TextEncoder().encode(encode(doc)).length > MAX_JSON) throw new Error('Canvas exceeds the 2 MB save limit.');
    return true;
  }

  function createDraft(input) {
    validate(input);
    let doc = clone(input);
    let saved = encode(doc), history = [saved], position = 0;
    return {
      get data() { return clone(doc); },
      get dirty() { return encode(doc) !== saved; },
      get canUndo() { return position > 0; },
      get canRedo() { return position < history.length - 1; },
      change(action) {
        const next = clone(doc);
        action(next);
        validate(next);
        const value = encode(next);
        if (value === encode(doc)) return false;
        history = history.slice(0, position + 1);
        history.push(value);
        if (history.length > 101) history.shift();
        position = history.length - 1;
        doc = next;
        return true;
      },
      undo() { if (position === 0) return false; doc = JSON.parse(history[--position]); return true; },
      redo() { if (position >= history.length - 1) return false; doc = JSON.parse(history[++position]); return true; },
      markSaved() { saved = encode(doc); },
      discard() { doc = JSON.parse(saved); history = [saved]; position = 0; }
    };
  }

  function make(tag, className, label) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (label !== undefined) element.textContent = label;
    return element;
  }

  function mount(input, options) {
    const draft = createDraft(input);
    let fingerprint = options.fingerprint, selected = null, connectFrom = null;
    let activeViewer = null, disposed = false, saving = false, drag = null;
    const root = make('section','canvas-editor');
    root.tabIndex = -1;
    const toolbar = make('div','canvas-editor-toolbar');
    const actions = make('div','canvas-editor-actions');
    const zoomControls = make('div','canvas-editor-zoom');
    const board = make('div','canvas-editor-board');
    const inspector = make('div','canvas-editor-inspector');
    const meta = make('div','canvas-editor-meta');
    const message = make('span','canvas-editor-message');
    const summary = make('span','canvas-editor-info-summary');
    const hint = make('span','canvas-editor-info-hint');
    message.setAttribute('role','status');
    meta.append(message,summary,hint);
    const warning = make('div','canvas-editor-confirm');
    const separator = make('span','canvas-editor-toolbar-separator');
    separator.setAttribute('aria-hidden','true');
    const saveStack = make('div','canvas-editor-save-stack');
    warning.hidden = true;
    toolbar.append(zoomControls,separator,actions,saveStack);
    root.append(toolbar,board,inspector,meta);
    meta.replaceChildren(summary,hint);
    saveStack.append(message);

    function status(text) { message.textContent = text; }
    function button(label, callback) {
      const b = make('button','canvas-control',label);
      b.type = 'button';
      b.addEventListener('click',callback);
      actions.append(b);
      return b;
    }
    function iconButton(label,name,callback) {
      const control=button(label,callback);
      control.classList.add('canvas-icon-button');
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('viewBox','0 0 24 24');
      svg.setAttribute('aria-hidden','true');
      svg.setAttribute('fill','none');
      svg.setAttribute('stroke','currentColor');
      svg.setAttribute('stroke-width','2');
      svg.setAttribute('stroke-linecap','round');
      svg.setAttribute('stroke-linejoin','round');
      const paths={
        undo:['M3 7v6h6','M3 13a9 9 0 1 0 2.6-6.4L3 9'],
        redo:['M21 7v6h-6','M21 13a9 9 0 1 1-2.6-6.4L21 9'],
        save:['M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z',
          'M17 21v-8H7v8','M7 3v5h8'],
        back:['M12 19l-7-7 7-7','M5 12h14']
      };
      for (const d of paths[name]||[]) {
        const path=document.createElementNS('http://www.w3.org/2000/svg','path');
        path.setAttribute('d',d);
        svg.append(path);
      }
      control.prepend(svg);
      return control;
    }
    function randomId(prefix, array) {
      let value;
      do {
        value = prefix + '-' + (global.crypto?.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2)));
      } while (array.some(item => item.id === value));
      return value;
    }
    function dismissQuestion() {
      warning.hidden=true;warning.replaceChildren();
      previewButton.classList.remove('canvas-exit-pending');
      options.closeButton?.classList.remove('canvas-exit-pending');
      delete warning.dataset.target;
    }
    function change(action) {
      if (saving || disposed) return;
      try {
        draft.change(action);
        dismissQuestion();
        render();
      } catch (error) { status(error.message); }
    }
    function question(messageText,action,trigger) {
      if(saving)return;
      dismissQuestion();
      warning.setAttribute('role','group');
      warning.setAttribute('aria-label',messageText);
      warning.dataset.target=trigger;
      previewButton.classList.toggle('canvas-exit-pending',trigger==='preview');
      options.closeButton?.classList.toggle('canvas-exit-pending',trigger==='close');
      const discard=make('button','canvas-control','Discard changes');
      const saveChanges=make('button','canvas-control canvas-confirm-save','Save changes');
      discard.type=saveChanges.type='button';
      discard.onclick=()=>{
        dismissQuestion();draft.discard();action();
      };
      saveChanges.onclick=async()=>{
        discard.disabled=true;saveChanges.disabled=true;
        if(await persistCanvas()){dismissQuestion();action();}
        else {discard.disabled=false;saveChanges.disabled=false;}
      };
      warning.append(discard,saveChanges);warning.hidden=false;
    }
    function leave() {
      if (draft.dirty) question('Save or discard changes before Preview.',() => options.onPreview(),'preview');
      else options.onPreview();
    }
    function askClose() {
      if(saving)return false;
      if(draft.dirty){
        question('Save or discard changes before Close.',()=>options.onClose(),'close');
        return false;
      }
      return true;
    }
    button('+ Text',() => addNode('text'));
    button('+ File',() => addNode('file'));
    button('+ Link',() => addNode('link'));
    button('+ Group',() => addNode('group'));
    const connectButton=button('Connect →',() => {
      if (connectFrom) {
        connectFrom=null;updateConnectionMode();
        status('Connection mode cancelled.');return;
      }
      if(!selected){status('Select a source card first.');return;}
      dismissQuestion();
      connectFrom=selected;updateConnectionMode();
      status('Click another card to connect it.');
    });
    connectButton.classList.add('canvas-connect-action');
    function updateConnectionMode(){
      root.dataset.connectActive=connectFrom?'true':'false';
      connectButton.setAttribute('aria-pressed',String(Boolean(connectFrom)));
      activeViewer?.querySelectorAll('.canvas-node').forEach(card=>
        card.classList.toggle('canvas-connect-source',card.dataset.nodeId===connectFrom));
    }
    const undo = iconButton('Undo','undo',() => { if (draft.undo()) render(); });
    const redo = iconButton('Redo','redo',() => { if (draft.redo()) render(); });
    async function persistCanvas(){
      if(saving)return false;
      if(!draft.dirty)return true;
      saving=true;save.disabled=true;
      status('Checking source file and saving…');
      try {
        validate(draft.data);
        const result=await options.onSave(draft.data,fingerprint);
        fingerprint=result.fingerprint;
        draft.markSaved();
        status('Canvas saved safely.');
        return true;
      }catch(error){
        status((error.code==='EXTERNAL_CHANGE'?
          'External modification detected. Reload before saving. ':'Save failed: ')+error.message);
        return false;
      }finally{saving=false;refreshButtons();}
    }
    const save=iconButton('Save canvas','save',async()=>{
      if(await persistCanvas())dismissQuestion();
    });
    // Preview belongs to the host dialog's action row next to "Insert into
    // note", not in the graph toolbar. The host inserts it in that row.
    const previewButton=iconButton('Preview','back',leave);
    previewButton.classList.add('canvas-preview-exit');
    previewButton.remove();
    saveStack.append(save);

    function refreshButtons() {
      undo.disabled = !draft.canUndo || saving;
      redo.disabled = !draft.canRedo || saving;
      save.disabled = !draft.dirty || saving;
      root.dataset.dirty = draft.dirty ? 'true' : 'false';
      if (!message.textContent || /^Canvas: /.test(message.textContent))
        status('Canvas: ' + (draft.dirty ? 'unsaved changes' : 'saved'));
    }

    function addNode(type) {
      let id;
      change(doc => {
        id = randomId('node',doc.nodes);
        const node = {id,type,x:0,y:0,width:type==='group'?440:260,height:type==='group'?300:160};
        if (type==='text') node.text = 'New note';
        if (type==='file') node.file = '';
        if (type==='link') node.url = '';
        if (type==='group') node.label = 'Group';
        doc.nodes.push(node);
      });
      if (id) {selected = id; render();}
    }

    function field(container, label, value, callback, multiline) {
      const wrap = make('label','canvas-editor-field',label);
      const el = make(multiline ? 'textarea':'input');
      el.value = value || '';
      if (!multiline) el.type = 'text';
      if (multiline) el.rows = 2;
      el.addEventListener('change',() => callback(el.value));
      wrap.append(el);
      container.append(wrap);
      return wrap;
    }
    function numberField(container,node,name) {
      const wrap=field(container,name,String(node[name]),value => {
        const num = Number(value);
        change(doc => {doc.nodes.find(n=>n.id===node.id)[name] = num;});
      });
      wrap.classList.add('canvas-prop-'+name);
      const input=wrap.querySelector('input');
      input.type='number';input.step='1';
      input.title=name+' (Canvas units)';
    }
    function renderInspector() {
      inspector.replaceChildren();
      const data=draft.data;
      const node=data.nodes.find(n=>n.id===selected);
      let removeCard=null;
      const properties=make('section','canvas-editor-inspector-properties');
      const heading=make('strong','canvas-editor-inspector-heading',
        node?node.type.toUpperCase()+':':'Card:');
      if (node) heading.title=node.id;
      if (!node) {
        properties.append(heading);
        properties.append(make('p','canvas-editor-unselected',
          'Select a card to edit · click it again to unselect'));
      } else {
        // Layout follows the supplied new.png: the selected type, a wide
        // FILE/LINK/GROUP field and compact COLOR share the top line. Geometry
        // occupies two short rows beneath it. TEXT has a larger two-row editor
        // alongside geometry instead of pretending that file nodes have text.
        const top=make('div','canvas-editor-property-top canvas-property-type-'+node.type);
        top.append(heading);
        const grid=make('div','canvas-editor-properties-grid canvas-properties-'+node.type+
          (node.type==='text'?' canvas-properties-multiline':''));
        for (const name of ['x','width','y','height']) numberField(grid,node,name);
        const property={text:'text',file:'file',link:'url',group:'label'}[node.type];
        const content=field(node.type==='text'?grid:top,property,node[property],value=>{
          if (property==='file' && value && !global.LocalWikiCanvas.canonicalPath(value)) {
            status('File paths must stay inside the selected wiki folder.'); return;
          }
          change(doc=>{doc.nodes.find(n=>n.id===node.id)[property]=value;});
        },property==='text');
        content.classList.add('canvas-prop-content');
        if (node.type!=='text') {
          // The FILE:/LINK:/GROUP: heading already identifies this field.
          // Avoid a second redundant lowercase label but keep its input named.
          content.firstChild.textContent='';
          content.querySelector('input')?.setAttribute('aria-label',
            {file:'Canvas file path',link:'Canvas link URL',group:'Canvas group label'}[node.type]);
        }
        const color=field(top,'color',node.color||'',value=>{
          if (value && !/^(?:[1-6]|#[0-9a-f]{3}|#[0-9a-f]{6})$/i.test(value)) {
            status('Use preset 1–6 or a hex color.'); return;
          }
          change(doc=>{
            const target=doc.nodes.find(n=>n.id===node.id);
            if(value)target.color=value;else delete target.color;
          });
        });
        color.classList.add('canvas-prop-color');
        color.querySelector('input').title='Preset 1–6 or hex (e.g. #1c87a6)';
        color.querySelector('input').maxLength=7;
        const remove=make('button','canvas-control canvas-editor-delete','Delete card');
        remove.type='button';
        remove.onclick=()=>{
          const id=selected;
          change(doc=>{
            doc.nodes=doc.nodes.filter(n=>n.id!==id);
            doc.edges=doc.edges.filter(edge=>edge.fromNode!==id && edge.toNode!==id);
          });
          selected=null;
          render();
        };
        removeCard=remove;
        properties.append(top,grid);
      }
      const connections=make('section','canvas-editor-inspector-connections');
      connections.append(make('strong','canvas-editor-inspector-heading','Connections:'));
      const row=make('div','canvas-editor-connection-row');
      if (data.edges.length) {
        const nodeLabel=id=>{
          const item=data.nodes.find(n=>n.id===id);
          if (!item) return id;
          const title={text:item.text,file:item.file,link:item.url,group:item.label}[item.type];
          const first=typeof title==='string'?title.split('\n')[0].trim():'';
          return (first||item.type).slice(0,130);
        };
        const select=make('select','canvas-editor-edge-list');
        select.setAttribute('aria-label','Choose a Canvas connection');
        data.edges.forEach((edge,index)=>{
          const item=make('option','',nodeLabel(edge.fromNode)+' → '+nodeLabel(edge.toNode));
          item.value=String(index);
          item.title=nodeLabel(edge.fromNode)+' → '+nodeLabel(edge.toNode);
          select.append(item);
        });
        const removeEdge=make('button','canvas-control canvas-delete-connection','Delete connection');
        removeEdge.type='button';
        removeEdge.onclick=()=>change(doc=>{doc.edges.splice(Number(select.value),1);});
        select.title=select.selectedOptions[0]?.title||'Canvas connection';
        select.addEventListener('change',()=>{
          select.title=select.selectedOptions[0]?.title||'Canvas connection';
        });
        row.append(select,removeEdge);
      } else {
        row.append(make('span','canvas-editor-no-connections','No connections'));
        const inactive=make('button','canvas-control canvas-delete-connection','Delete connection');
        inactive.type='button';inactive.disabled=true;
        row.append(inactive);
      }
      connections.append(row);
      if(removeCard)connections.append(removeCard);
      inspector.append(properties,connections);
    }

    function transformScale(viewer) {
      const boardElement = viewer.querySelector('.canvas-board');
      const match = /scale\(([\d.]+)\)/.exec(boardElement?.style.transform || '');
      return match ? (Number(match[1]) || 1) : 1;
    }
    function render() {
      if (disposed) return;
      const camera=activeViewer?.getCamera?.()||null;
      activeViewer?.dispose?.();
      const data=draft.data;
      const viewer=global.LocalWikiCanvas.render(data, {
        readImage:options.readImage,readNote:options.readNote,camera
      });
      activeViewer=viewer;
      // Put all explanatory text alongside "Attachments/example.canvas", not
      // in extra rows above the viewport.
      summary.textContent='JSON Canvas editor · '+data.nodes.length+' cards · '+
        data.edges.length+' connections';
      hint.textContent='Drag cards to move · corner to resize · Ctrl+wheel to zoom · select a card to edit';
      viewer.querySelector('.canvas-summary')?.remove();
      const zoomBar=viewer.querySelector('.canvas-controls');
      zoomBar.querySelector('.canvas-hint')?.remove();
      zoomControls.replaceChildren(zoomBar);
      const rendered=global.LocalWikiCanvas.cleanGraph(data).nodes;
      viewer.querySelectorAll('.canvas-node').forEach((card,index)=>{
        const node=rendered[index]; if (!node) return;
        card.dataset.nodeId=node.id;
        card.tabIndex=0;
        card.style.pointerEvents='auto';
        card.style.cursor='move';
        card.classList.toggle('canvas-node-selected',selected===node.id);
        let suppressClick=false;
        const updateSelected=()=>{
          viewer.querySelectorAll('.canvas-node').forEach(el=>
            el.classList.toggle('canvas-node-selected',el.dataset.nodeId===selected));
          renderInspector();
        };
        card.addEventListener('click',event=>{
          event.stopPropagation();
          if(event.target.closest('.canvas-editor-resize'))return;
          // Pointer selection happens on release. Do not toggle it a second
          // time in the click synthesized after pointerup/pointer capture.
          if(suppressClick){suppressClick=false;return;}
          if (connectFrom) {
            const from=connectFrom;connectFrom=null;updateConnectionMode();
            if (from!==node.id) change(doc=>{
              doc.edges.push({id:randomId('edge',doc.edges),fromNode:from,toNode:node.id,fromSide:'right',toSide:'left',toEnd:'arrow'});
            });
            else status('Choose a different target card.');
          } else {
            selected=selected===node.id?null:node.id;
            updateSelected();
          }
        });
        card.addEventListener('keydown',event=>{
          if (event.key==='Enter' || event.key===' ') {event.preventDefault();card.click();}
        });
        const resize=make('button','canvas-editor-resize','↘');
        resize.type='button';resize.title='Drag to resize card';
        card.append(resize);
        const begin=(event,kind)=>{
          if (event.button!==0 || saving || (connectFrom && kind==='move')) return;
          event.preventDefault();event.stopPropagation();
          const initiallySelected=selected===node.id;
          suppressClick=false;
          selected=node.id;
          updateSelected();
          const current=data.nodes.find(n=>n.id===node.id);
          drag={pointer:event.pointerId,element:event.currentTarget,kind,id:node.id,
            initiallySelected,
            startX:event.clientX,startY:event.clientY,x:current.x,y:current.y,
            width:current.width,height:current.height,scale:transformScale(viewer)};
          event.currentTarget.setPointerCapture(event.pointerId);
        };
        card.addEventListener('pointerdown',event=>{if (!event.target.closest('.canvas-editor-resize')) begin(event,'move');});
        resize.addEventListener('pointerdown',event=>begin(event,'resize'));
        const move=event=>{
          if (!drag || event.pointerId!==drag.pointer || drag.element!==event.currentTarget) return;
          event.stopPropagation();
          const dx=(event.clientX-drag.startX)/drag.scale,dy=(event.clientY-drag.startY)/drag.scale;
          if (drag.kind==='move') {
            viewer.updateNodeGeometry(node.id,{
              x:Math.max(-1000000,Math.min(1000000,drag.x+Math.round(dx))),
              y:Math.max(-1000000,Math.min(1000000,drag.y+Math.round(dy)))
            });
          } else {
            viewer.updateNodeGeometry(node.id,{
              width:Math.max(45,Math.min(1000000,drag.width+Math.round(dx))),
              height:Math.max(35,Math.min(1000000,drag.height+Math.round(dy)))
            });
          }
        };
        const finish=event=>{
          if (!drag || event.pointerId!==drag.pointer || drag.element!==event.currentTarget) return;
          const last=drag; drag=null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          if (event.type==='pointercancel') {
            viewer.updateNodeGeometry(last.id,{
              x:last.x,y:last.y,width:last.width,height:last.height
            });
            renderInspector();return;
          }
          const dx=Math.round((event.clientX-last.startX)/last.scale);
          const dy=Math.round((event.clientY-last.startY)/last.scale);
          if (!dx && !dy) {
            // Clicking the currently selected card unselects it; pointer
            // selection on another card still works and a grip click never
            // changes selection. Keyboard Enter/Space follow the click path.
            if(last.kind==='move' && !connectFrom) {
              selected=last.initiallySelected?null:last.id;
              suppressClick=true;
            }
            updateSelected();
            return;
          }
          suppressClick=true;
          change(doc=>{
            const n=doc.nodes.find(n=>n.id===last.id);
            if (last.kind==='move') {
              n.x=Math.max(-1000000,Math.min(1000000,last.x+dx));
              n.y=Math.max(-1000000,Math.min(1000000,last.y+dy));
            } else {
              n.width=Math.max(45,Math.min(1000000,last.width+dx));
              n.height=Math.max(35,Math.min(1000000,last.height+dy));
            }
          });
        };
        card.addEventListener('pointermove',move);
        resize.addEventListener('pointermove',move);
        card.addEventListener('pointerup',finish);
        resize.addEventListener('pointerup',finish);
        card.addEventListener('pointercancel',finish);
        resize.addEventListener('pointercancel',finish);
      });
      board.replaceChildren(viewer);
      const viewport=viewer.querySelector('.canvas-viewport');
      viewport.addEventListener('click',event=>{
        if(event.target.closest('.canvas-node'))return;
        if(!connectFrom&&selected){selected=null;renderInspector();
          viewer.querySelectorAll('.canvas-node').forEach(card=>
            card.classList.remove('canvas-node-selected'));}
      });
      renderInspector();
      refreshButtons();
      updateConnectionMode();
    }
    root.addEventListener('pointerdown',()=>{
      if(!warning.hidden)dismissQuestion();
    },{capture:true});
    root.addEventListener('input',()=>{
      if(!warning.hidden)dismissQuestion();
    });
    root.addEventListener('keydown',event=>{
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase()!=='z') return;
      event.preventDefault();
      if (event.shiftKey) {if (draft.redo()) render();}
      else {if (draft.undo()) render();}
    });
    render();
    return {
      root,
      meta,
      previewButton,
      confirmation:warning,
      get isDirty() {return draft.dirty;},
      requestClose:askClose,
      dispose(){
        dismissQuestion();disposed=true;
        activeViewer?.dispose?.();previewButton.remove();warning.remove();
      }
    };
  }
  global.LocalWikiCanvasEditor={createDraft,validate,mount};
})(window);
