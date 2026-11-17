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
  function render(source, files, options={}) {
    const model=parseYaml(source);
    if (!model || typeof model!=='object' || Array.isArray(model)) throw new Error('Base must be a YAML mapping.');
    const root=text('div','wiki-bases-viewer');
    const views=Array.isArray(model.views)?model.views.filter(v=>v && typeof v==='object' && v.type==='table'):[];
    root.append(text('p','bases-intro','Obsidian Bases · read-only table over local Markdown frontmatter'));
    if (!views.length) {root.append(text('p','bases-warning','No supported table views found. Other Bases layouts are not implemented.'));return root;}
    const tabs=text('div','bases-tabs');
    const status=text('p','bases-status');
    const warnings=text('div','bases-warnings');
    const area=text('div','bases-table-scroll');
    root.append(tabs,status,warnings,area);
    const sourceRows=files.slice(0,MAX_FILES);
    const totalFiles=Math.max(options.totalFiles||files.length,files.length);
    const viewButtons=[];
    let disposed=false,active=0;
    const renderView=(index)=>{
      if (disposed) return;
      active=index;
      viewButtons.forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));
      const view=views[index],issues=[];
      warnings.replaceChildren();area.replaceChildren();
      if (totalFiles>MAX_FILES) issues.push('First '+MAX_FILES+' Markdown files only; '+(totalFiles-MAX_FILES)+' files were not scanned.');
      if (options.failedFiles) issues.push(options.failedFiles+' Markdown files could not be read.');
      if (Array.isArray(model.formulas)?model.formulas.length:Object.keys(model.formulas||{}).length)
        issues.push('Formula expressions are not evaluated; formula columns show unavailable values.');
      if (view.groupBy) issues.push('Grouping is not applied in this read-only preview.');
      if (view.type!=='table') issues.push('Unsupported view type.');
      try {
        const globalFilter=filterFunction(model.filters), localFilter=filterFunction(view.filters);
        let visible=sourceRows.filter(row=>globalFilter(row)&&localFilter(row));
        if (Array.isArray(view.sort)) {
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
        const shown=visible.slice(0,limit);
        const columns=describeColumns(model,view,shown);
        const table=text('table','bases-table');
        const head=text('thead'),heading=text('tr');
        columns.forEach(col=>heading.append(text('th','',col.title)));
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
        status.textContent=shown.length+' of '+visible.length+' matching Markdown notes (scanned '+sourceRows.length+').';
        if (visible.length>shown.length) issues.push('Showing first '+shown.length+' matches.');
      } catch(error) {
        status.textContent='Results withheld: unsupported filter.';
        issues.push(error.message+' No rows are displayed to avoid misleading results.');
      }
      issues.forEach(message=>warnings.append(text('p','bases-warning',message)));
    };
    views.forEach((view,i)=>{
      const button=text('button','bases-tab',view.name||'Table '+(i+1));button.type='button';
      button.addEventListener('click',()=>renderView(i));tabs.append(button);viewButtons.push(button);
    });
    renderView(0);
    root.dispose=()=>{disposed=true;};
    return root;
  }
  global.LocalWikiBases={parseYaml,readFrontmatter,fileData,filterFunction,property,render};
})(window);
