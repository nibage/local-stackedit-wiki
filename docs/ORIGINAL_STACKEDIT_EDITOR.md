# Dávka 6 – výsledek pokusu o integraci upstream StackEdit editoru

**Stav:** originální `cledit` **zatím není součástí aplikace**. Implementace je nadále samostatný offline prohlížeč s CodeMirror 5 a MathJax 2. Netvrdit, že jde o fork StackEditu.

## Prověřené originální zdroje

Upstream: https://github.com/benweet/stackedit (Apache-2.0). Přímo byly přečteny:

- `src/services/editor/cledit/index.js`: načítá `cleditCore`, `cleditHighlighter`, `cleditKeystroke`, `cleditMarker`, `cleditSelectionMgr`, `cleditUndoMgr`, `cleditUtils`, `cleditWatcher` a `src/libs/clunderscore`.
- `src/services/editor/cledit/cleditCore.js`: používá `diff-match-patch`, `turndown/lib/turndown.browser.umd`, `src/libs/htmlSanitizer` a Vuex `src/store`.
- `src/services/editor/cledit/cleditUndoMgr.js`: rovněž vyžaduje `diff-match-patch`.
- `src/services/editorSvc.js`: navíc vyžaduje Prism, Markdown conversion/grammar, pagedown, sanitizaci a návazný Vuex stav, aby bylo možné použít původní zvýrazňování a live preview.
- `src/services/markdownConversionSvc.js`: Markdown-it + pluginy; částečně závislé na interních properties / extensionSvc.

Problém tedy není jen záměna jednoho `<textarea>`: originální cledit je modul s bohatými vzájemnými závislostmi a upstream rendererem. Bez kompletních npm balíčků / kompatibilního bundlu by nasazení bylo nefunkční.

## Co bylo reálně otestováno

`curl -I https://registry.npmjs.org/diff-match-patch` → `Could not resolve host: registry.npmjs.org`. Node.js je dostupný, síťové získání původních npm závislostí však v tomto prostředí není možné. Sestavení původního StackEditu není ověřené. Původní projekt také vyžaduje zastaralý build stack (`webpack@2`, `node-sass@4`), který nemusí fungovat s dostupným Node.js 22 bez úprav/izolované verze.

## Co zůstává přenositelné

`src/file-system.js` je oddělen od editoru a od rendereru. `src/editor-adapter.js` poskytuje `getValue`, `setValue`, `setReadOnly`, `onChange`, `refresh`, `focus`, `format`, takže je možná náhrada CodeMirror za funkční samostatně zabalený cledit/StackEdit build bez změn ukládání.

Dávka 6 přidává `renameFile`/přesun souboru do samotné souborové vrstvy (přímá lokální práce). Stejná operace bude použitelná i se skutečným editorovým forkem.

## Jak pokračovat k originálnímu forku

1. Získat kompletní upstream checkout a zamknout jeho staré závislosti v izolované build konfiguraci.
2. Sestavit originál a ověřit, že jeho vlastní editor a renderery skutečně fungují offline (včetně Mermaid + ABCjs + KaTeX).
3. Z jeho běžícího buildu bezpečně odstranit cloudové providers, připojit `LocalWikiFS` a zachovat lokální data jako jediný zdroj pravdy.
4. Vytvořit statický produkční build s relativními URL a otestovat jej při `file://` přímo v cílovém desktop Chrome/Edge.

Žádný z těchto bodů se v dávce 6 **neoznačuje za splněný**.
