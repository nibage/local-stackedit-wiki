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
    const board = make('div','canvas-editor-board');
    const inspector = make('div','canvas-editor-inspector');
    const message = make('p','canvas-editor-message');
    message.setAttribute('role','status');
    const warning = make('div','canvas-editor-confirm');
    warning.hidden = true;
    root.append(toolbar, message, warning, board, inspector);

    function status(text) { message.textContent = text; }
    function button(label, callback) {
      const b = make('button','canvas-control',label);
      b.type = 'button';
      b.addEventListener('click',callback);
      toolbar.append(b);
      return b;
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
      warning.replaceChildren(make('span','',messageText));
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
    const undo = button('Undo',() => { if (draft.undo()) render(); });
    const redo = button('Redo',() => { if (draft.redo()) render(); });
    const save = button('Save canvas',async () => {
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
    button('Preview',leave);

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
      if (multiline) el.rows = 4;
      el.addEventListener('change',() => callback(el.value));
      wrap.append(el);
      container.append(wrap);
    }
    function numberField(container,node,name) {
      field(container,name,String(node[name]),value => {
        const num = Number(value);
        change(doc => {doc.nodes.find(n=>n.id===node.id)[name] = num;});
      });
    }
    function renderInspector() {
      inspector.replaceChildren();
      const data = draft.data;
      const node = data.nodes.find(n=>n.id===selected);
      if (!node) {
        inspector.append(make('p','canvas-summary','Select a card to edit its properties, drag it to move, or drag its corner to resize.'));
      } else {
        inspector.append(make('strong','',node.type.toUpperCase() + ' · ' + node.id));
        for (const name of ['x','y','width','height']) numberField(inspector,node,name);
        const property = {text:'text',file:'file',link:'url',group:'label'}[node.type];
        field(inspector,property,node[property],value => {
          if (property==='file' && value && !global.LocalWikiCanvas.canonicalPath(value)) {
            status('File paths must stay inside the selected wiki folder.'); return;
          }
          change(doc=>{doc.nodes.find(n=>n.id===node.id)[property]=value;});
        },property==='text');
        field(inspector,'Color (1–6 or #RRGGBB)',node.color || '',value => {
          if (value && !/^(?:[1-6]|#[0-9a-f]{3}|#[0-9a-f]{6})$/i.test(value)) {
            status('Use preset 1–6 or a hex color.'); return;
          }
          change(doc=>{const n=doc.nodes.find(n=>n.id===node.id); if (value) n.color=value; else delete n.color;});
        });
        const remove = make('button','canvas-control','Delete card');
        remove.type = 'button';
        remove.onclick = () => {
          const id = selected;
          change(doc => {
            doc.nodes = doc.nodes.filter(n=>n.id!==id);
            doc.edges = doc.edges.filter(e=>e.fromNode!==id && e.toNode!==id);
          });
          selected = null;
          render();
        };
        inspector.append(remove);
      }
      if (data.edges.length) {
        const edgeTitle = make('strong','','Connections');
        inspector.append(edgeTitle);
        const select = make('select','canvas-editor-edge-list');
        data.edges.forEach((edge,index) => {
          const item = make('option','',edge.fromNode+' → '+edge.toNode);
          item.value = String(index);
          select.append(item);
        });
        const removeEdge = make('button','canvas-control','Delete connection');
        removeEdge.type='button';
        removeEdge.onclick=()=>change(doc=>{doc.edges.splice(Number(select.value),1);});
        inspector.append(select,removeEdge);
      }
    }

    function transformScale(viewer) {
      const boardElement = viewer.querySelector('.canvas-board');
      const match = /scale\(([\d.]+)\)/.exec(boardElement?.style.transform || '');
      return match ? (Number(match[1]) || 1) : 1;
    }
    function render() {
      if (disposed) return;
      activeViewer?.dispose?.();
      const data=draft.data;
      const viewer=global.LocalWikiCanvas.render(data, {
        readImage:options.readImage,readNote:options.readNote
      });
      activeViewer=viewer;
      viewer.querySelector('.canvas-summary').textContent =
        'JSON Canvas editor · ' + data.nodes.length + ' cards · ' + data.edges.length + ' connections';
      const hint=viewer.querySelector('.canvas-hint');
      if (hint) hint.textContent='Drag cards to move · corner to resize · Ctrl+wheel to zoom';
      const rendered=global.LocalWikiCanvas.cleanGraph(data).nodes;
      viewer.querySelectorAll('.canvas-node').forEach((card,index)=>{
        const node=rendered[index]; if (!node) return;
        card.dataset.nodeId=node.id;
        card.tabIndex=0;
        card.style.pointerEvents='auto';
        card.style.cursor='move';
        card.classList.toggle('canvas-node-selected',selected===node.id);
        card.addEventListener('click',event=>{
          event.stopPropagation();
          if (connectFrom) {
            const from=connectFrom;connectFrom=null;
            if (from!==node.id) change(doc=>{
              doc.edges.push({id:randomId('edge',doc.edges),fromNode:from,toNode:node.id,fromSide:'right',toSide:'left',toEnd:'arrow'});
            });
            else status('Choose a different target card.');
          } else {selected=node.id; renderInspector(); viewer.querySelectorAll('.canvas-node').forEach(el=>el.classList.toggle('canvas-node-selected',el.dataset.nodeId===selected));}
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
          selected=node.id;
          const current=data.nodes.find(n=>n.id===node.id);
          drag={pointer:event.pointerId,element:event.currentTarget,kind,id:node.id,
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
            card.style.left=(node.x + Math.round(dx))+'px';
            card.style.top=(node.y + Math.round(dy))+'px';
          } else {
            card.style.width=Math.max(45,drag.width+Math.round(dx))+'px';
            card.style.height=Math.max(35,drag.height+Math.round(dy))+'px';
          }
        };
        const finish=event=>{
          if (!drag || event.pointerId!==drag.pointer || drag.element!==event.currentTarget) return;
          const last=drag; drag=null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          const dx=Math.round((event.clientX-last.startX)/last.scale);
          const dy=Math.round((event.clientY-last.startY)/last.scale);
          if (!dx && !dy) {renderInspector();return;}
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
      get isDirty() {return draft.dirty;},
      requestClose:askClose,
      dispose(){disposed=true;activeViewer?.dispose?.();}
    };
  }
  global.LocalWikiCanvasEditor={createDraft,validate,mount};
})(window);
