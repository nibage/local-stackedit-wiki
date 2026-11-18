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
    toolbar.append(actions,separator,zoomControls,saveStack,warning);
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
    function change(action) {
      if (saving || disposed) return;
      try {
        draft.change(action);
        warning.hidden = true;
        render();
      } catch (error) { status(error.message); }
    }
    function question(messageText, action) {
      // Inline confirmation replaces the zoom controls; do not add a new
      // message row or move the centered dialog while a draft is unsaved.
      warning.replaceChildren();
      warning.setAttribute('role','group');
      warning.setAttribute('aria-label',messageText);
      const confirm = make('button','canvas-control','Discard changes');
      const cancel = make('button','canvas-control','Keep editing');
      confirm.type = cancel.type = 'button';
      confirm.onclick = () => { warning.hidden = true; draft.discard(); action(); };
      cancel.onclick = () => { warning.hidden = true; };
      warning.append(confirm,cancel);
      warning.hidden = false;
      cancel.focus();
    }
    function leave() {
      if (draft.dirty) question('Unsaved canvas changes will be lost.',() => options.onPreview());
      else options.onPreview();
    }
    function askClose() {
      if (saving) return false;
      if (draft.dirty) {
        question('Save your changes or discard them before closing.',() => options.onClose());
        return false;
      }
      return true;
    }
    button('+ Text',() => addNode('text'));
    button('+ File',() => addNode('file'));
    button('+ Link',() => addNode('link'));
    button('+ Group',() => addNode('group'));
    button('Connect →',() => {
      if (!selected) { status('Select a source card first.'); return; }
      connectFrom = selected;
      status('Click the target card to create a connection.');
    });
    const undo = iconButton('Undo','undo',() => { if (draft.undo()) render(); });
    const redo = iconButton('Redo','redo',() => { if (draft.redo()) render(); });
    const save = iconButton('Save canvas','save',async () => {
      if (saving || !draft.dirty) return;
      saving = true; save.disabled = true;
      status('Checking source file and saving…');
      try {
        validate(draft.data);
        const result = await options.onSave(draft.data,fingerprint);
        fingerprint = result.fingerprint;
        draft.markSaved();
        status('Canvas saved safely.');
        warning.hidden = true;
      } catch (error) {
        status((error.code === 'EXTERNAL_CHANGE' ?
          'External modification detected. Reload the file before retrying. ' : 'Save failed: ') + error.message);
      } finally { saving = false; refreshButtons(); }
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
        status('Canvas: ' + (draft.dirty ? 'unsaved changes' : 'saved') + ' · select a card to edit');
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
      properties.append(heading);
      if (!node) {
        properties.append(make('p','canvas-editor-unselected',
          'Select a card to edit · click it again to unselect'));
      } else {
        const grid=make('div','canvas-editor-properties-grid canvas-properties-'+node.type+
          (node.type==='text'?' canvas-properties-multiline':''));
        // Fixed two-row geometry grid. Every field uses a short, horizontal
        // label/input pair instead of four full-width vertically stacked fields.
        for (const name of ['x','width','y','height']) numberField(grid,node,name);
        const property={text:'text',file:'file',link:'url',group:'label'}[node.type];
        const content=field(grid,property,node[property],value=>{
          if (property==='file' && value && !global.LocalWikiCanvas.canonicalPath(value)) {
            status('File paths must stay inside the selected wiki folder.'); return;
          }
          change(doc=>{doc.nodes.find(n=>n.id===node.id)[property]=value;});
        },property==='text');
        content.classList.add('canvas-prop-content');
        const color=field(grid,'color',node.color||'',value=>{
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
        properties.append(grid);
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
          return (first||item.type).slice(0,28);
        };
        const select=make('select','canvas-editor-edge-list');
        select.setAttribute('aria-label','Choose a Canvas connection');
        data.edges.forEach((edge,index)=>{
          const item=make('option','',nodeLabel(edge.fromNode)+' → '+nodeLabel(edge.toNode));
          item.value=String(index);
          item.title=edge.fromNode+' → '+edge.toNode;
          select.append(item);
        });
        const removeEdge=make('button','canvas-control canvas-delete-connection','Delete connection');
        removeEdge.type='button';
        removeEdge.onclick=()=>change(doc=>{doc.edges.splice(Number(select.value),1);});
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
      hint.textContent='Drag cards to move · corner to resize · Ctrl+wheel to zoom';
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
            const from=connectFrom;connectFrom=null;
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
          if (event.button!==0 || saving) return;
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
    }
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
      get isDirty() {return draft.dirty;},
      requestClose:askClose,
      dispose(){disposed=true;activeViewer?.dispose?.();previewButton.remove();}
    };
  }
  global.LocalWikiCanvasEditor={createDraft,validate,mount};
})(window);
