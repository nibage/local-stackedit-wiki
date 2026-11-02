/* Local-only technical diagnostics for reproducible final testing.
 * Deliberately does NOT include wiki filenames, file paths, document contents,
 * URL pathname or query, search queries, or local-storage contents.
 * Classic script: no network, imports, permissions, or backend required.
 */
(function (global) {
  'use strict';
  const VERSION = 'batch23';
  const bool = value => Boolean(value);
  const limitedCount = count => Number.isSafeInteger(count) && count >= 0 ? Math.min(count, 10000000) : null;
  function collect(context = {}) {
    const mermaid = global.LocalWikiDiagrams?.capabilities?.() || {};
    return {
      schema: 1,
      application: 'Local StackEdit Wiki',
      version: VERSION,
      environment: {
        protocol: global.location?.protocol || 'unknown:',
        secureContext: bool(global.isSecureContext),
        userAgent: String(global.navigator?.userAgent || '').slice(0, 300),
        showDirectoryPicker: typeof global.showDirectoryPicker === 'function',
        createWritable: bool(global.FileSystemFileHandle?.prototype?.createWritable),
        directoryInput: bool(global.document?.createElement?.('input')?.webkitdirectory !== undefined),
        textDecoderFatal: typeof global.TextDecoder === 'function'
      },
      libraries: {
        marked: typeof global.marked?.parse === 'function',
        codeMirror: typeof global.CodeMirror === 'function',
        mathJax: bool(global.MathJax?.Hub),
        mermaid: bool(mermaid.mermaid),
        abcjs: bool(mermaid.abc),
        smokeTest: (function () {
          const status = global.LocalWikiRendererSmoke?.lastStatus?.();
          const safe = value => ['ok', 'missing', 'failed'].includes(value) ? value : null;
          return status ? { mermaid: safe(status.mermaid), abc: safe(status.abc) } : null;
        })()
      },
      wiki: {
        mode: ['none', 'readonly', 'readwrite'].includes(context.mode) ? context.mode : 'none',
        files: limitedCount(context.count),
        indexed: limitedCount(context.indexed),
        unsavedEdits: bool(context.dirty),
        diskOperationInProgress: bool(context.busy)
      }
    };
  }
  function download(report) {
    const blob = new Blob([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `local-wiki-diagnostics-${VERSION}.json`;
    document.body.append(anchor);
    try { anchor.click(); }
    finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  global.LocalWikiDiagnostics = { collect, download, VERSION };
})(typeof window !== 'undefined' ? window : globalThis);
