/* Offline editor adapter. CodeMirror 5 (MIT) is used as a temporary Markdown editing surface.
 * It can be replaced by StackEdit/cledit without changing the file-system bridge. */
(function (global) {
  'use strict';
  function make(textarea) {
    if (!global.CodeMirror) throw new Error('Chybí offline editor CodeMirror.');
    const cm = global.CodeMirror.fromTextArea(textarea, {
      mode: 'gfm', lineNumbers: true, lineWrapping: true, indentUnit: 2,
      tabSize: 2, indentWithTabs: false, readOnly: true,
      autofocus: false, viewportMargin: 12,
      extraKeys: {
        'Ctrl-B': () => format('bold'), 'Cmd-B': () => format('bold'),
        'Ctrl-I': () => format('italic'), 'Cmd-I': () => format('italic'),
        'Ctrl-F': editor => editor.execCommand('find'),
        'Cmd-F': editor => editor.execCommand('find'),
        'Tab': editor => editor.replaceSelection('  ', 'end'),
        'Shift-Tab': editor => editor.execCommand('indentLess')
      }
    });
    let suppressed = false;
    const listeners = new Set();
    cm.on('change', () => { if (!suppressed) for (const listener of listeners) listener(); });
    function wrap(prefix, suffix = prefix, placeholder = 'text') {
      const content = cm.getSelection() || placeholder;
      const from = cm.getCursor('from');
      cm.replaceSelection(prefix + content + suffix, 'around');
      cm.setSelection({ line: from.line, ch: from.ch + prefix.length },
        { line: from.line, ch: from.ch + prefix.length + content.length });
      cm.focus();
    }
    function prefixLine(prefix) {
      cm.operation(() => {
        const from = cm.getCursor('from'), to = cm.getCursor('to');
        for (let line = to.line; line >= from.line; line--) {
          if (line === to.line && to.ch === 0 && line > from.line) continue;
          cm.replaceRange(prefix, { line, ch: 0 });
        }
      });
      cm.focus();
    }
    function format(type) {
      if (cm.getOption('readOnly')) return;
      if (type === 'bold') wrap('**', '**', 'tučný text');
      else if (type === 'italic') wrap('*', '*', 'kurzíva');
      else if (type === 'code') wrap('`', '`', 'kód');
      else if (type === 'link') wrap('[', '](cesta.md)', 'odkaz');
      else if (type === 'heading') prefixLine('## ');
      else if (type === 'list') prefixLine('- ');
      else if (type === 'undo') cm.undo();
      else if (type === 'redo') cm.redo();
    }
    return {
      getValue: () => cm.getValue('\n'),
      setValue: value => { suppressed = true; try { cm.setValue(value); cm.clearHistory(); } finally { suppressed = false; } },
      setReadOnly: value => cm.setOption('readOnly', Boolean(value)),
      onChange: fn => listeners.add(fn),
      refresh: () => cm.refresh(),
      focus: () => cm.focus(),
      format,
      cm
    };
  }
  global.LocalWikiEditor = { make };
})(window);
