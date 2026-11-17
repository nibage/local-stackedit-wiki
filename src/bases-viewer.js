/* Offline read-only Obsidian Bases table. Deliberately supports a safe YAML
   subset and a small allowlist of filters, never evaluates arbitrary formulas. */
(function (global) {
  'use strict';
  const MAX_FILES = 500, MAX_ROWS = 300, MAX_COLUMNS = 20, MAX_BASE_BYTES = 2 * 1024 * 1024;

  function scalar(input) {
    const value = input.trim();
    if (!value || value === 'null' || value === '~') return null;
    if (/^!|^&|^\*|^\||^>|^\{|^%/.test(value)) throw new Error('Unsupported YAML feature: ' + value.slice(0, 40));
    if ((value[0] === '"' && value.at(-1) === '"') ||
        (value[0] === "'" && value.at(-1) === "'")) {
      if (value[0] === "'") return value.slice(1, -1).replace(/''/g, "'");
      try { return JSON.parse(value); }
      catch (_) { return value.slice(1, -1).replace(/\\"/g, '"'); }
    }
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
    if (value === '[]') return [];
    if (value === '{}') return {};
    if (value.startsWith('[') && value.endsWith(']')) {
      const body = value.slice(1,-1);
      if (/[\[\]{}]/.test(body)) throw new Error('Nested flow YAML is not supported.');
      return body.trim() ? body.split(/,\s*/).map(scalar) : [];
    }
    return value;
  }
  function parseYaml(source) {
    if (typeof source !== 'string' || source.length > MAX_BASE_BYTES)
      throw new Error('YAML is too large for the safe viewer.');
    const lines = [];
    source.replace(/\r\n?/g, '\n').split('\n').forEach((raw, n) => {
      if (!raw.trim() || /^\s*#/.test(raw) || raw.trim() === '---' || raw.trim() === '...') return;
      if (/\t/.test(raw.slice(0, raw.length - raw.trimStart().length)))
        throw new Error('YAML indentation must use spaces (line ' + (n+1) + ').');
      const indent = raw.length - raw.trimStart().length;
      lines.push({indent, text:raw.trim(), line:n+1});
    });
    if (!lines.length) return {};
    let cursor = 0;
    function entry(text, indent, line) {
      const m = /^([^:]+?):(?:\s+(.*))?$/.exec(text);
      if (!m) throw new Error('Unsupported YAML mapping on line ' + line);
      const key = String(scalar(m[1].trim()));
      if (key === '__proto__' || key === 'constructor' || key === 'prototype')
        throw new Error('Unsafe YAML property.');
      if (m[2] === undefined || m[2] === '') {
        if (cursor < lines.length && lines[cursor].indent > indent) {
          const childIndent = lines[cursor].indent;
          return [key, parseBlock(childIndent)];
        }
        return [key, null];
      }
      return [key, scalar(m[2])];
    }
    function parseMap(indent, leading) {
      const result = Object.create(null);
      if (leading) {
        const [k,v] = entry(leading.text, indent, leading.line);
        result[k] = v;
      }
      while (cursor < lines.length && lines[cursor].indent === indent &&
             !lines[cursor].text.startsWith('- ')) {
        const line = lines[cursor++];
        const [k,v] = entry(line.text, indent, line.line);
        result[k] = v;
      }
      return result;
    }
    function parseArray(indent) {
      const arr = [];
      while (cursor < lines.length && lines[cursor].indent === indent &&
             /^-(?:\s|$)/.test(lines[cursor].text)) {
        const item = lines[cursor++], rest = item.text.slice(1).trim();
        if (!rest) {
          if (cursor < lines.length && lines[cursor].indent > indent)
            arr.push(parseBlock(lines[cursor].indent));
          else arr.push(null);
        } else if (/^[^:]+:\s*(?:.*)$/.test(rest) && !/^["']/.test(rest)) {
          arr.push(parseMap(indent+2, {text:rest,line:item.line}));
        } else {
          arr.push(scalar(rest));
        }
      }
      return arr;
    }
    function parseBlock(indent) {
      if (cursor >= lines.length || lines[cursor].indent < indent) return null;
      if (lines[cursor].indent !== indent) throw new Error('Invalid YAML indentation on line ' + lines[cursor].line);
      const result = /^-(?:\s|$)/.test(lines[cursor].text) ? parseArray(indent) : parseMap(indent);
      if (cursor < lines.length && lines[cursor].indent > indent)
        throw new Error('Unsupported nested YAML near line ' + lines[cursor].line);
      return result;
    }
    const result = parseBlock(lines[0].indent);
    if (cursor < lines.length) throw new Error('Unsupported YAML layout at line ' + lines[cursor].line);
    return result;
  }
  function readFrontmatter(text) {
    const normalized = String(text || '').slice(0,100000).replace(/\r\n?/g,'\n');
    if (!normalized.startsWith('---\n')) return {};
    const end = normalized.indexOf('\n---', 4);
    const alt = normalized.indexOf('\n...', 4);
    const finish = [end,alt].filter(x=>x>=0).sort((a,b)=>a-b)[0];
    if (finish === undefined) return {};
    const data = parseYaml(normalized.slice(4,finish));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  }
  function fileData(path, properties, body = '') {
    const segments = path.split('/');
    const filename = segments.pop();
    const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
    const tags = properties.tags || properties.tag || [];
    const tagArray = Array.isArray(tags) ? tags : String(tags).split(/[\s,]+/);
    const bodyTags = Array.from(String(body).matchAll(/(^|\s)#([\p{L}\p{N}_/-]+)/gu), m => m[2]);
    const tagSet = new Set([...tagArray, ...bodyTags].map(tag=>String(tag).replace(/^#/,'').toLowerCase()));
    return {path, name:filename.replace(/\.(md|markdown)$/i,''), folder:segments.join('/'),
      ext, props:properties, tags:tagSet};
  }
  function property(row, key) {
    if (key === 'file.name') return row.name;
    if (key === 'file.path') return row.path;
    if (key === 'file.folder') return row.folder;
    if (key === 'file.ext') return row.ext;
    if (key.startsWith('file.')) return null;
    const name = key.startsWith('note.') ? key.slice(5) : key;
    return Object.prototype.hasOwnProperty.call(row.props,name) ? row.props[name] : null;
  }
  function compare(a, op, b) {
    if (op === '==' || op === '===') return String(a ?? '') === String(b ?? '');
    if (op === '!=') return String(a ?? '') !== String(b ?? '');
    if (a == null || b == null) return false;
    const left = Number(a), right = Number(b);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    return op === '>' ? left > right : op === '>=' ? left >= right :
      op === '<' ? left < right : op === '<=' ? left <= right : false;
  }
  function filterFunction(spec) {
    if (spec === undefined || spec === null) return () => true;
    if (typeof spec === 'string') {
      const source = spec.trim();
      const inFolder = /^file\.inFolder\((["'])([^"']+)\1\)$/.exec(source);
      if (inFolder) return row => row.folder === inFolder[2] || row.folder.startsWith(inFolder[2]+'/');
      const tagged = /^file\.hasTag\((["'])([^"']+)\1\)$/.exec(source);
      if (tagged) return row => row.tags.has(tagged[2].replace(/^#/,'').toLowerCase());
      const c = /^((?:(?:note|file)\.)?[a-zA-Z_][\w.-]*)\s*(===|==|!=|>=|<=|>|<)\s*(.+)$/.exec(source);
      if (c) {
        if (c[1].startsWith('formula.') ||
            (c[1].startsWith('file.') && !['file.name','file.path','file.folder','file.ext'].includes(c[1])))
          throw new Error('Unsupported Bases filter property: ' + c[1]);
        const right = scalar(c[3]);
        if (!['string','number','boolean'].includes(typeof right))
          throw new Error('Unsupported filter value: ' + c[3]);
        return row => compare(property(row,c[1]),c[2],right);
      }
      throw new Error('Unsupported Bases filter: ' + source.slice(0,120));
    }
    if (typeof spec === 'object' && !Array.isArray(spec)) {
      const keys = Object.keys(spec);
      if (keys.length !== 1 || !['and','or','not'].includes(keys[0]))
        throw new Error('Unsupported Bases filter group.');
      const key = keys[0];
      if (!Array.isArray(spec[key])) throw new Error('Expected filter list in ' + key);
      const children = spec[key].map(filterFunction);
      if (key === 'and') return row => children.every(fn=>fn(row));
      if (key === 'or') return row => children.some(fn=>fn(row));
      return row => !children.some(fn=>fn(row));
    }
    throw new Error('Unsupported Bases filter type.');
  }
  function describeColumns(base, view, rows) {
    const named = Array.isArray(view.order) ? view.order.filter(x=>typeof x==='string' && x.length<100) : [];
    const auto = ['file.name',...new Set(rows.flatMap(row=>Object.keys(row.props).filter(k=>/^[\w.-]{1,60}$/.test(k)))).values()].slice(0,6);
    const keys = (named.length?named:auto).slice(0,MAX_COLUMNS);
    if (!keys.includes('file.name')) keys.unshift('file.name');
    return keys.slice(0,MAX_COLUMNS).map(key=>({
      key, title: base.properties && base.properties[key]?.displayName || (key === 'file.name' ? 'File' : key)
    }));
  }
  function text(tag, cls, content) {
    const el = document.createElement(tag);
    if (cls) el.className=cls;
    if (content !== undefined) el.textContent=String(content);
    return el;
  }
  function display(value) {
    if (value == null) return '—';
    if (Array.isArray(value)) return value.map(x=>String(x)).join(', ');
    if (typeof value==='object') return '[structured property]';
    return String(value);
  }
  // Temporary in-memory filters never modify the .base YAML or source notes.
  function applyTemporary(rows, rules, mode='and', negate=false) {
    if (!Array.isArray(rules) || rules.length > 8) throw new Error('At most eight temporary filters are supported.');
    if (!rules.length) return rows.slice();
    function match(row, rule) {
      if (!rule || typeof rule.key !== 'string' || rule.key.length > 100 ||
          !/^(?:file\.(?:name|path|folder|ext|tags)|(?:note\.)?[a-zA-Z_][\w.-]*)$/.test(rule.key) ||
          rule.key.startsWith('formula.')) return false;
      const actual=rule.key==='file.tags' ? Array.from(row.tags || []) : property(row,rule.key);
      const want=String(rule.value ?? '').slice(0,300);
      const shown=display(actual);
      switch (rule.op) {
        case 'contains': return shown.toLocaleLowerCase().includes(want.toLocaleLowerCase());
        case 'equals': return shown.toLocaleLowerCase()===want.toLocaleLowerCase();
        case 'notEquals': return shown.toLocaleLowerCase()!==want.toLocaleLowerCase();
        case 'greater': return actual != null && Number.isFinite(Number(actual)) &&
          Number.isFinite(Number(want)) && Number(actual)>Number(want);
        case 'less': return actual != null && Number.isFinite(Number(actual)) &&
          Number.isFinite(Number(want)) && Number(actual)<Number(want);
        case 'empty': return actual == null || actual==='' || (Array.isArray(actual)&&!actual.length);
        case 'notEmpty': return actual != null && actual!=='' && (!Array.isArray(actual)||actual.length>0);
        case 'tag': return row.tags && row.tags.has(want.replace(/^#/,'').toLocaleLowerCase());
        default: return false;
      }
    }
    return rows.filter(row=>{
      const matched=mode==='or' ? rules.some(rule=>match(row,rule)) : rules.every(rule=>match(row,rule));
      return negate ? !matched : matched;
    });
  }

  function render(source, files, options={}) {
    const model=parseYaml(source);
    if (!model || typeof model!=='object' || Array.isArray(model)) throw new Error('Base must be a YAML mapping.');
    const root=text('div','wiki-bases-viewer');
    const views=Array.isArray(model.views)?model.views.filter(v=>v && typeof v==='object' && v.type==='table'):[];
    root.append(text('p','bases-intro','Obsidian Bases · read-only Markdown data · temporary table controls'));
    if (!views.length) {root.append(text('p','bases-warning','No supported table views found. Other Bases layouts are not implemented.'));return root;}
    const tabs=text('div','bases-tabs');
    const toolbar=text('div','bases-toolbar');
    const filterPanel=text('div','bases-filter-panel');
    filterPanel.hidden=true;
    const status=text('p','bases-status');
    const warnings=text('div','bases-warnings');
    const area=text('div','bases-table-scroll');
    const header=text('div','bases-controls-row');
    header.append(tabs,toolbar);
    root.append(header,filterPanel,status,warnings,area);
    const sourceRows=files.slice(0,MAX_FILES);
    const totalFiles=Math.max(options.totalFiles||files.length,files.length);
    const viewButtons=[],viewStates=views.map(()=>({
      rules:[],mode:'and',negate:false,sort:null,widths:new Map()
    }));
    const availableKeys=[
      'file.name','file.path','file.folder','file.ext','file.tags',
      ...new Set(sourceRows.flatMap(row=>Object.keys(row.props||{}).filter(key=>/^[a-zA-Z_][\w.-]{0,60}$/.test(key))))
    ].slice(0,100);
    let disposed=false,active=0;
    const filterButton=text('button','bases-filter-toggle','Filter (temporary)');
    filterButton.type='button';
    const resetButton=text('button','bases-reset','Reset filters and sort');
    resetButton.type='button';
    toolbar.append(filterButton,resetButton);
    filterButton.addEventListener('click',()=>{
      filterPanel.hidden=!filterPanel.hidden;
      filterButton.setAttribute('aria-expanded',String(!filterPanel.hidden));
      if (!filterPanel.hidden) renderRules();
    });
    resetButton.addEventListener('click',()=>{
      const state=viewStates[active];
      state.rules=[];state.mode='and';state.negate=false;state.sort=null;
      renderRules();renderView(active);
    });

    function option(select,value,label) {
      const choice=text('option','',label);choice.value=value;select.append(choice);return choice;
    }
    function renderRules() {
      if (disposed) return;
      filterPanel.replaceChildren();
      const state=viewStates[active];
      const help=text('p','bases-filter-note','Filters here affect only this table session. They are not saved into the .base file or Markdown notes.');
      filterPanel.append(help);
      const ruleList=text('div','bases-filter-list');
      filterPanel.append(ruleList);
      const operatorList=[
        ['contains','contains'],['equals','equals'],['notEquals','does not equal'],
        ['greater','greater than (number)'],['less','less than (number)'],
        ['empty','is empty'],['notEmpty','is not empty'],['tag','has tag']
      ];
      state.rules.forEach((rule,index)=>{
        const row=text('div','bases-filter-rule');
        const key=text('select','bases-filter-key');
        key.setAttribute('aria-label','Filter property');
        availableKeys.forEach(k=>option(key,k,k));
        key.value=rule.key;
        key.addEventListener('change',()=>{rule.key=key.value;renderView(active);});
        const op=text('select','bases-filter-operator');
        op.setAttribute('aria-label','Filter comparison');
        operatorList.forEach(([value,label])=>option(op,value,label));
        op.value=rule.op;
        const value=text('input','bases-filter-value');
        value.type='text';value.maxLength=300;value.value=rule.value;
        value.setAttribute('aria-label','Filter value');
        value.hidden=rule.op==='empty'||rule.op==='notEmpty';
        op.addEventListener('change',()=>{
          rule.op=op.value;
          value.hidden=rule.op==='empty'||rule.op==='notEmpty';
          renderView(active);
        });
        value.addEventListener('input',()=>{rule.value=value.value;renderView(active);});
        const remove=text('button','bases-filter-remove','Remove');
        remove.type='button';remove.setAttribute('aria-label','Remove filter');
        remove.addEventListener('click',()=>{
          state.rules.splice(index,1);renderRules();renderView(active);
        });
        row.append(key,op,value,remove);ruleList.append(row);
      });
      const footer=text('div','bases-filter-footer');
      const add=text('button','bases-add-filter','+ Condition');
      add.type='button';add.disabled=state.rules.length>=8;
      add.addEventListener('click',()=>{
        state.rules.push({key:availableKeys[0]||'file.name',op:'contains',value:''});
        renderRules();renderView(active);
      });
      const combination=text('select','bases-filter-combination');
      combination.setAttribute('aria-label','Combine conditions');
      option(combination,'and','All conditions (AND)');
      option(combination,'or','Any condition (OR)');
      combination.value=state.mode;
      combination.addEventListener('change',()=>{state.mode=combination.value;renderView(active);});
      const negate=text('label','bases-filter-negate');
      const checkbox=text('input');checkbox.type='checkbox';checkbox.checked=state.negate;
      checkbox.addEventListener('change',()=>{state.negate=checkbox.checked;renderView(active);});
      negate.append(checkbox,text('span','','NOT'));
      footer.append(add,combination,negate);filterPanel.append(footer);
      filterButton.textContent='Filter'+(state.rules.length ? ' ('+state.rules.length+')':'')+' (temporary)';
    }

    function renderView(index) {
      if (disposed) return;
      active=index;
      viewButtons.forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));
      const view=views[index],state=viewStates[index],issues=[];
      warnings.replaceChildren();area.replaceChildren();
      if (totalFiles>MAX_FILES) issues.push('First '+MAX_FILES+' Markdown files only; '+(totalFiles-MAX_FILES)+' files were not scanned.');
      if (options.failedFiles) issues.push(options.failedFiles+' Markdown files could not be read.');
      if (Array.isArray(model.formulas)?model.formulas.length:Object.keys(model.formulas||{}).length)
        issues.push('Formula expressions are not evaluated; formula columns show unavailable values.');
      if (view.groupBy) issues.push('Grouping is not applied in this read-only preview.');
      try {
        const globalFilter=filterFunction(model.filters),localFilter=filterFunction(view.filters);
        const based=sourceRows.filter(row=>globalFilter(row)&&localFilter(row));
        let visible=applyTemporary(based,state.rules,state.mode,state.negate);
        if (state.sort) {
          const {key,direction}=state.sort;
          visible.sort((a,b)=>{
            const left=property(a,key),right=property(b,key);
            const result=String(left??'').localeCompare(String(right??''),'cs',{numeric:true});
            return result*(direction==='desc'?-1:1) || a.path.localeCompare(b.path,'cs');
          });
        } else if (Array.isArray(view.sort)) {
          const criteria=view.sort.filter(v=>v && typeof v.property==='string').slice(0,3);
          visible.sort((a,b)=>{
            for(const item of criteria) {
              const av=property(a,item.property),bv=property(b,item.property);
              const result=String(av??'').localeCompare(String(bv??''),'cs',{numeric:true});
              if(result) return /desc/i.test(item.direction||'')?-result:result;
            }
            return a.path.localeCompare(b.path,'cs');
          });
        } else visible.sort((a,b)=>a.path.localeCompare(b.path,'cs',{numeric:true}));
        const limit=Number.isInteger(view.limit)&&view.limit>0?Math.min(view.limit,MAX_ROWS):MAX_ROWS;
        const shown=visible.slice(0,limit),columns=describeColumns(model,view,shown);
        const table=text('table','bases-table');
        table.style.tableLayout='fixed';
        const colgroup=text('colgroup');
        const colSizes=columns.map(col=>state.widths.get(col.key)||180);
        const colElements=columns.map((col,i)=>{
          const el=text('col');el.style.width=colSizes[i]+'px';colgroup.append(el);return el;
        });
        const updateTableWidth=()=>{table.style.width=colSizes.reduce((sum,width)=>sum+width,0)+'px';};
        updateTableWidth();table.style.minWidth='100%';
        table.append(colgroup);
        const head=text('thead'),heading=text('tr');
        columns.forEach((col,i)=>{
          const header=text('th','bases-sortable-heading');
          header.setAttribute('scope','col');header.tabIndex=0;
          header.setAttribute('aria-label','Sort by '+col.title);
          header.setAttribute('aria-sort',state.sort?.key===col.key
            ? (state.sort.direction==='asc'?'ascending':'descending'):'none');
          header.append(text('span','bases-heading-label',col.title));
          header.addEventListener('click',event=>{
            if (event.target.closest('.bases-column-grip')) return;
            const old=state.sort;
            state.sort=old?.key!==col.key?{key:col.key,direction:'asc'}:
              old.direction==='asc'?{key:col.key,direction:'desc'}:null;
            renderView(active);
          });
          header.addEventListener('keydown',event=>{
            if (event.target!==header || !['Enter',' '].includes(event.key)) return;
            event.preventDefault();header.click();
          });
          const grip=text('span','bases-column-grip','⋮');
          grip.tabIndex=0;grip.setAttribute('role','separator');
          grip.setAttribute('aria-label','Resize column '+col.title);
          grip.setAttribute('aria-orientation','vertical');
          const applyWidth=number=>{
            const width=Math.min(700,Math.max(90,Math.round(number)));
            colSizes[i]=width;state.widths.set(col.key,width);
            colElements[i].style.width=width+'px';updateTableWidth();
          };
          let drag=null;
          grip.addEventListener('pointerdown',event=>{
            if (event.button!==0) return;
            event.preventDefault();event.stopPropagation();
            drag={id:event.pointerId,x:event.clientX,width:colSizes[i]};
            grip.setPointerCapture(event.pointerId);
          });
          grip.addEventListener('pointermove',event=>{
            if (!drag || drag.id!==event.pointerId) return;
            applyWidth(drag.width+event.clientX-drag.x);
          });
          const stop=event=>{
            if (!drag || drag.id!==event.pointerId) return;
            drag=null;if(grip.hasPointerCapture(event.pointerId))grip.releasePointerCapture(event.pointerId);
          };
          grip.addEventListener('pointerup',stop);
          grip.addEventListener('pointercancel',stop);
          grip.addEventListener('keydown',event=>{
            if (event.key==='ArrowLeft' || event.key==='ArrowRight') {
              event.preventDefault();event.stopPropagation();
              applyWidth(colSizes[i]+(event.key==='ArrowRight'?20:-20));
            }
          });
          grip.addEventListener('dblclick',event=>{
            event.preventDefault();event.stopPropagation();
            const chars=Math.max(col.title.length,...shown.map(row=>
              (col.key==='file.name'?row.name:display(property(row,col.key))).length));
            applyWidth(Math.min(700,Math.max(90,chars*8+36)));
          });
          header.append(grip);heading.append(header);
        });
        head.append(heading);table.append(head);
        const body=text('tbody');
        shown.forEach(row=>{
          const tr=text('tr');
          columns.forEach(col=>{
            const td=text('td');
            if(col.key==='file.name') {
              const button=text('button','bases-open-note',row.name);
              button.type='button';button.title=row.path;
              button.addEventListener('click',()=>options.onOpen?.(row.path));
              td.append(button);
            } else td.textContent=col.key.startsWith('formula.')?'—':display(property(row,col.key));
            tr.append(td);
          });
          body.append(tr);
        });
        table.append(body);area.append(table);
        status.textContent=shown.length+' of '+visible.length+' matching Markdown notes (scanned '+sourceRows.length+')'+
          (state.rules.length?' · '+state.rules.length+' temporary filter(s)':'')+'.';
        if (visible.length>shown.length) issues.push('Showing first '+shown.length+' matches.');
      } catch(error) {
        status.textContent='Results withheld: unsupported filter.';
        issues.push(error.message+' No rows are displayed to avoid misleading results.');
      }
      issues.forEach(message=>warnings.append(text('p','bases-warning',message)));
    }

    views.forEach((view,i)=>{
      const button=text('button','bases-tab',view.name||'Table '+(i+1));button.type='button';
      button.addEventListener('click',()=>{renderView(i);renderRules();});tabs.append(button);viewButtons.push(button);
    });
    renderRules();
    renderView(0);
    root.dispose=()=>{disposed=true;};
    return root;
  }
  global.LocalWikiBases={parseYaml,readFrontmatter,fileData,filterFunction,applyTemporary,property,render};
})(window);
