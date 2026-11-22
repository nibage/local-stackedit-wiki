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
    let fingerprint = options.fingerprint, selected = null, selectedEdge = null, connectFrom = null;
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
    // Reserve ONE fixed-height status row for both hint and exit choices.
    // Do not inject an extra row before the host footer: it caused a
    // vertical scrollbar to appear as soon as Preview/Close was clicked.
    meta.replaceChildren(summary,hint);
    // Exit decisions belong in a dedicated row above the Close/Preview
    // buttons, not in the narrow Canvas status line.
    if (options.confirmHost) options.confirmHost.insertBefore(warning,options.closeButton||null);
    else meta.append(warning);
    saveStack.append(message);

    function status(text) { message.textContent = text; }
    function clearExitChoice() {
      warning.hidden = true;
      previewButton?.classList.remove('canvas-exit-pending');
      options.closeButton?.classList.remove('canvas-exit-pending');
    }
    function refreshConnectionMode() {
      root.dataset.connecting = connectFrom ? 'true' : 'false';
      connectButton.classList.toggle('canvas-editor-connect-active',Boolean(connectFrom));
      root.querySelectorAll('.canvas-node').forEach(card=>{
        card.classList.toggle('canvas-connect-target',Boolean(connectFrom) && card.dataset.nodeId!==connectFrom);
        card.style.cursor=connectFrom?'pointer':'move';
      });
    }
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
        back:['M12 19l-7-7 7-7','M5 12h14'],
        forward:['M12 5l7 7-7 7','M19 12H5']
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
        if (draft.change(action))
          status('Canvas: ' + (draft.dirty ? 'unsaved changes' : 'saved'));
        clearExitChoice();
        render();
      } catch (error) { status(error.message); }
    }
    function question(messageText, action, trigger) {
      clearExitChoice();
      warning.replaceChildren();
      warning.setAttribute('role','group');
      warning.setAttribute('aria-label',messageText);
      const discard = make('button','canvas-control','Discard');
      const saveChanges = make('button','canvas-control canvas-confirm-save','Save');
      saveChanges.setAttribute('aria-label','Save changes');
      discard.type = saveChanges.type = 'button';
      discard.onclick = () => { clearExitChoice(); draft.discard(); action(); };
      saveChanges.onclick = async () => {
        if (await persist()) { clearExitChoice(); action(); }
      };
      warning.append(discard,saveChanges);
      warning.hidden = false;
      trigger?.classList.add('canvas-exit-pending');
      saveChanges.focus();
    }
    function leave() {
      if (saving) return;
      if (draft.dirty) question('Save or discard changes before preview.',() => options.onPreview(),previewButton);
      else options.onPreview();
    }
    function askClose() {
      if (saving) return false;
      if (draft.dirty) {
        question('Save or discard changes before closing.',() => options.onClose(),options.closeButton);
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
        connectFrom=null; refreshConnectionMode();
        status('Connection cancelled.');
        return;
      }
      if (!selected) { status('Select a source card first.'); return; }
      connectFrom = selected;
      refreshConnectionMode();
      status('Click another card to connect, or click Connect again to cancel.');
    });
    const undo = iconButton('Undo','undo',() => { if (draft.undo()) render(); });
    const redo = iconButton('Redo','redo',() => { if (draft.redo()) render(); });
    async function persist() {
      if (saving) return false;
      if (!draft.dirty) return true;
      saving = true; save.disabled = true;
      status('Checking source file and saving…');
      try {
        validate(draft.data);
        const result = await options.onSave(draft.data,fingerprint);
        fingerprint = result.fingerprint;
        draft.markSaved();
        status('Canvas saved safely.');
        return true;
      } catch (error) {
        status((error.code === 'EXTERNAL_CHANGE' ?
          'External modification detected. Reload the file before retrying. ' : 'Save failed: ') + error.message);
        return false;
      } finally { saving = false; refreshButtons(); }
    }
    const save = iconButton('Save canvas','save',()=>void persist());
    save.title='Save Canvas changes';
    // Preview belongs to the host dialog's action row next to "Insert into
    // note", not in the graph toolbar. The host inserts it in that row.
    const previewButton=iconButton('Back to preview','forward',leave);
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
      if (id) {selected = id; selectedEdge=null; render();}
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
    function selectConnection(index) {
      selectedEdge=index;
      selected=null;
      connectFrom=null;
      renderInspector();
      updateSelectionHighlights();
      refreshConnectionMode();
    }
    function updateSelectionHighlights() {
      root.querySelectorAll('.canvas-node').forEach(card=>
        card.classList.toggle('canvas-node-selected',selected===card.dataset.nodeId));
      root.querySelectorAll('.canvas-connections > path').forEach((path,index)=>{
        path.classList.toggle('canvas-edge-selected',index===selectedEdge);
        path.setAttribute('aria-selected',String(index===selectedEdge));
      });
    }
    function labeledChoice(container,label,values,value,onChange) {
      const wrap=make('label','canvas-editor-field',label);
      const select=make('select');
      for(const choice of values) {
        const option=make('option','',choice);option.value=choice;select.append(option);
      }
      select.value=value;
      select.addEventListener('change',()=>onChange(select.value));
      wrap.append(select);container.append(wrap);
      return wrap;
    }
    function renderInspector() {
      inspector.replaceChildren();
      const data=draft.data;
      if(selected && !data.nodes.some(node=>node.id===selected))selected=null;
      if(selectedEdge!==null && !data.edges[selectedEdge])selectedEdge=null;
      const node=data.nodes.find(item=>item.id===selected);
      const edge=selectedEdge===null?null:data.edges[selectedEdge];
      const properties=make('section','canvas-editor-inspector-properties');
      const top=make('div','canvas-editor-property-top');
      const grid=make('div','canvas-editor-properties-grid');
      if(node) {
        top.classList.add('canvas-node-property-top');
        const id=field(top,'id',node.id,value=>{
          const next=value.trim();
          if(!next || data.nodes.some(item=>item.id===next && item.id!==node.id)) {
            status('Card ID cannot be empty or duplicated.');return;
          }
          const old=node.id;
          selected=next;
          try {
            draft.change(doc=>{
              const target=doc.nodes.find(item=>item.id===old);
              target.id=next;
              for(const link of doc.edges) {
                if(link.fromNode===old)link.fromNode=next;
                if(link.toNode===old)link.toNode=next;
              }
            });
            clearExitChoice();render();
          } catch(error) {selected=old;status(error.message);}
        });
        id.classList.add('canvas-prop-id');
        const type=labeledChoice(top,'type',['text','file','link','group'],node.type,value=>
          change(doc=>{
            const target=doc.nodes.find(item=>item.id===node.id);
            target.type=value;
            if(value==='text' && typeof target.text!=='string')target.text='';
            if(value==='file' && typeof target.file!=='string')target.file='';
            if(value==='link' && typeof target.url!=='string')target.url='';
            if(value==='group' && typeof target.label!=='string')target.label='';
          }));
        type.classList.add('canvas-prop-type');
        const label=field(top,'label',node.label||'',value=>
          change(doc=>{const target=doc.nodes.find(item=>item.id===node.id);
            if(value)target.label=value;else delete target.label;
          }));
        label.classList.add('canvas-prop-label');
        const color=field(top,'color',node.color||'',value=>{
          if(value && !/^(?:[1-6]|#[0-9a-f]{3}|#[0-9a-f]{6})$/i.test(value)) {
            status('Use preset 1–6 or a hex color.');return;
          }
          change(doc=>{
            const target=doc.nodes.find(item=>item.id===node.id);
            if(value)target.color=value;else delete target.color;
          });
        });
        color.classList.add('canvas-prop-color');
        color.querySelector('input').maxLength=7;
        grid.classList.add('canvas-properties-'+node.type);
        if(node.type==='text')grid.classList.add('canvas-properties-multiline');
        for(const name of ['x','width','y','height'])numberField(grid,node,name);
        const property={text:'text',file:'file',link:'url'}[node.type];
        if(property) {
          const content=field(grid,property,node[property],value=>{
            if(property==='file' && value && !global.LocalWikiCanvas.canonicalPath(value)){
              status('File paths must stay inside the selected wiki folder.');return;
            }
            change(doc=>{doc.nodes.find(item=>item.id===node.id)[property]=value;});
          },property==='text');
          content.classList.add('canvas-prop-content');
        }
        properties.append(top,grid);
      } else if(edge) {
        top.classList.add('canvas-edge-property-top');
        const id=field(top,'id',edge.id||'',value=>{
          const next=value.trim();
          if(next && data.edges.some((e,index)=>index!==selectedEdge && e.id===next)){
            status('Connection ID must be unique.');return;
          }
          change(doc=>{
            if(next)doc.edges[selectedEdge].id=next;
            else delete doc.edges[selectedEdge].id;
          });
        });
        id.classList.add('canvas-prop-id');
        const label=field(top,'label',edge.label||'',value=>
          change(doc=>{doc.edges[selectedEdge].label=value;}));
        label.classList.add('canvas-prop-label');
        const color=field(top,'color',edge.color||'',value=>{
          if(value && !/^(?:[1-6]|#[0-9a-f]{3}|#[0-9a-f]{6})$/i.test(value)){
            status('Use preset 1–6 or a hex color.');return;
          }
          change(doc=>{if(value)doc.edges[selectedEdge].color=value;
            else delete doc.edges[selectedEdge].color;});
        });
        color.classList.add('canvas-prop-color');
        grid.classList.add('canvas-properties-edge');
        for(const [name,labelText] of [['fromNode','from'],['toNode','to']]){
          const fieldWrap=labeledChoice(grid,labelText,data.nodes.map(n=>n.id),edge[name],value=>
            change(doc=>{doc.edges[selectedEdge][name]=value;}));
          fieldWrap.classList.add('canvas-prop-'+labelText);
        }
        for(const [name,labelText] of [['fromSide','from side'],['toSide','to side']]){
          const fieldWrap=labeledChoice(grid,labelText,['','top','right','bottom','left'],edge[name]||'',value=>
            change(doc=>{if(value)doc.edges[selectedEdge][name]=value;
              else delete doc.edges[selectedEdge][name];}));
          fieldWrap.classList.add('canvas-prop-'+name);
        }
        properties.append(top,grid);
      } else {
        properties.append(make('strong','canvas-editor-inspector-heading','Card / connection:'));
        properties.append(make('p','canvas-editor-unselected',
          'Select a card or click a connection line to inspect it'));
      }
      const connections=make('section','canvas-editor-inspector-connections');
      connections.append(make('strong','canvas-editor-inspector-heading','Connections:'));
      const row=make('div','canvas-editor-connection-row');
      const available=data.edges.map((edge,index)=>({edge,index})).filter(({edge,index})=>
        selectedEdge!==null ? index===selectedEdge :
        !!selected && (edge.fromNode===selected || edge.toNode===selected));
      if(available.length){
        const select=make('select','canvas-editor-edge-list');
        select.setAttribute('aria-label','Choose a Canvas connection');
        if(selectedEdge===null){
          const empty=make('option','','Select connection…');
          empty.value='';select.append(empty);
        }
        available.forEach(({edge,index})=>{
          const item=make('option','',edge.fromNode+' → '+edge.toNode);
          item.value=String(index);
          item.title=(edge.id||'')+' · '+edge.fromNode+' → '+edge.toNode;
          select.append(item);
        });
        select.value=selectedEdge===null?'':String(selectedEdge);
        select.addEventListener('change',()=>{
          if(select.value!=='')selectConnection(Number(select.value));
        });
        const removeEdge=make('button','canvas-control canvas-delete-connection','Delete connection');
        removeEdge.type='button';
        removeEdge.onclick=()=>{
          const index=selectedEdge!==null?selectedEdge:Number(select.value);
          if(!Number.isInteger(index) || index<0)return;
          selectedEdge=null;
          change(doc=>{doc.edges.splice(index,1);});
        };
        removeEdge.disabled=selectedEdge===null;
        row.append(select,removeEdge);
      } else {
        row.append(make('span','canvas-editor-no-connections',
          selected?'No connections':edge?'No connection':'Select a card'));
        const inactive=make('button','canvas-control canvas-delete-connection','Delete connection');
        inactive.type='button';inactive.disabled=true;
        row.append(inactive);
      }
      connections.append(row);
      const removeCard=make('button','canvas-control canvas-editor-delete','Delete card');
      removeCard.type='button';
      removeCard.disabled=!node;
      removeCard.onclick=()=>{
        if(!selected)return;
        const id=selected;selected=null;selectedEdge=null;
        change(doc=>{
          doc.nodes=doc.nodes.filter(item=>item.id!==id);
          doc.edges=doc.edges.filter(link=>link.fromNode!==id && link.toNode!==id);
        });
      };
      connections.append(removeCard);
      if(edge){
        const back=make('button','canvas-control canvas-edge-back','Back to card');
        back.type='button';back.addEventListener('click',()=>{
          selected=data.nodes.some(n=>n.id===edge.fromNode)?edge.fromNode:null;
          selectedEdge=null;renderInspector();updateSelectionHighlights();
        });
        connections.append(back);
      }
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
          selectedEdge=null;
          updateSelectionHighlights();
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
            refreshConnectionMode();
            if (from!==node.id) change(doc=>{
              doc.edges.push({id:randomId('edge',doc.edges),fromNode:from,toNode:node.id,fromSide:'right',toSide:'left',toEnd:'arrow'});
            });
            else status('Choose a different target card.');
          } else {
            selected=selected===node.id?null:node.id;
            selectedEdge=null;
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
      viewer.querySelectorAll('.canvas-connections > path').forEach((line,index)=>{
        line.dataset.edgeIndex=String(index);
        line.setAttribute('role','button');
        line.setAttribute('tabindex','0');
        line.setAttribute('aria-label','Select connection '+data.edges[index].fromNode+' to '+data.edges[index].toNode);
        line.addEventListener('click',event=>{event.stopPropagation();selectConnection(index);});
        line.addEventListener('keydown',event=>{
          if(event.key==='Enter' || event.key===' '){
            event.preventDefault();event.stopPropagation();selectConnection(index);
          }
        });
      });
      const viewport=viewer.querySelector('.canvas-viewport');
      viewport.addEventListener('click',event=>{
        if(event.target.closest('.canvas-node'))return;
        if(!connectFrom&&(selected||selectedEdge!==null)){
          selected=null;selectedEdge=null;renderInspector();updateSelectionHighlights();}
      });
      renderInspector();
      refreshButtons();
      refreshConnectionMode();
      updateSelectionHighlights();
    }
    root.addEventListener('pointerdown',event=>{
      // Confirm buttons now live INSIDE the editor's status line: do not
      // dismiss their own click during the capture phase.
      if(!warning.hidden && !warning.contains(event.target))clearExitChoice();
    },true);
    root.addEventListener('input',()=>{ if(!warning.hidden) clearExitChoice(); },true);
    root.addEventListener('keydown',event=>{
      if(event.key==='Escape' && connectFrom) {
        event.preventDefault();connectFrom=null;refreshConnectionMode();
        status('Connection cancelled.');return;
      }
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
      dispose(){disposed=true;activeViewer?.dispose?.();previewButton.remove();warning.remove();clearExitChoice();}
    };
  }
  global.LocalWikiCanvasEditor={createDraft,validate,mount};
})(window);
