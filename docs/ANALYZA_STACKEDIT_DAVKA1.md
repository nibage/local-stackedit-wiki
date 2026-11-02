# Dávka 1 — analýza originálního StackEditu

Datum analýzy: 2026-10-31. Repozitář: https://github.com/benweet/stackedit (větev master, verze v package.json: 5.15.4). Zdroje byly prohlédnuty na GitHubu, zdrojový strom **není** zatím přiložen v tomto testovacím ZIPu.

## Co musí zůstat

| Funkce | Originální soubor / balíček | Cíl |
|---|---|---|
| Markdown a náhled | `src/services/markdownConversionSvc.js`, `markdown-it` | zachovat |
| LaTeX / matematika | `src/extensions/katexExtension.js`, `katex` | zachovat (StackEdit používá **KaTeX**, nikoli MathJax) |
| UML, flowchart, sequence | `src/extensions/mermaidExtension.js`, `mermaid` | zachovat |
| Notová osnova | `src/extensions/abcExtension.js`, `abcjs` | zachovat |
| Zvýraznění kódu | `src/services/markdownConversionSvc.js`, `prismjs` | zachovat |
| Integrovaný editor | `src/components/Editor.vue`, `CodeEditor.vue`, `editorSvc.js` | zachovat |

Originální `src/extensions/index.js` importuje všechna uvedená rozšíření. Nesmíme je odstranit při pročišťování cloudových modulů.

## Co je třeba změnit

- `src/store/explorer.js`: dynamické uzly se vytvářejí z interních `folder/items`, `file/items`; zapsat metadate z lokálního stromu.
- `src/components/Explorer.vue`, `ExplorerNode.vue`: výběr souborů, aktualizace stromu, později operace se soubory.
- `src/services/workspaceSvc.js`: identita souboru, cesta, vytvoření/přejmenování/přesun/smazání.
- `src/services/localDbSvc.js`: původní IndexedDB. Není vhodné ji odstranit celou — uložení UI stavu a metadat by bylo lepší oddělit od zdrojového obsahu `.md` na disku.
- `src/services/syncSvc.js`, provider moduly: vyřadit až po dokončení lokálního režimu; ne zasahovat do Markdown rendererů.
- `src/components/Preview.vue`: zatím jen posoudit relativní odkazy a obrázky z lokální wiki.

## Technické omezení

- `file://` je podle MDN *potenciálně důvěryhodný* kontext, ale lokální soubory se při načítání přes `fetch()` a JS moduly běžně potýkají s origin/CORS pravidly.
- File System Access API (`showDirectoryPicker({ mode: 'readwrite' })`) je podporováno hlavně v Chromium; reálný zápis z `file://` je nutné ověřit v konkrétním prohlížeči.
- `<input type=file webkitdirectory>` je fallback, ale nezaručuje přímý zápis do zdrojových souborů.
- Původní build má Webpack 2, Vue 2 a `node-sass` 4 — při sestavování na moderním Node bude pravděpodobně potřeba starší kompatibilní prostředí nebo modernizace. **Build původního repozitáře zatím nebyl spuštěn.**
- `StackEdit` má licenci Apache-2.0; při distribuci upraveného zdrojového kódu zachovat licenci a příslušná oznámení.

## Pořadí dalšího vývoje

1. V cílovém Chrome/Edge ověřit otevření / uložení `.md` dvojklikem na `index.html` pomocí přiloženého FS bridge.
2. Připravit lokální sestavení skutečného zdrojového kódu StackEditu (ne náhradní Markdown editor).
3. Propojit FS bridge s `workspaceSvc` / Vuex; zachovat původní editor, preview a renderer extensiony.
4. Dopracovat lokální odkazy, obrázky, vytvoření/přejmenování souborů, index a externí změny.
5. Odstranit cloud UI, služby a závislosti, aniž by se poškodily původní renderery.

## Použité zdroje

- https://github.com/benweet/stackedit/blob/master/package.json
- https://github.com/benweet/stackedit/blob/master/src/extensions/index.js
- https://github.com/benweet/stackedit/blob/master/src/extensions/katexExtension.js
- https://github.com/benweet/stackedit/blob/master/src/extensions/mermaidExtension.js
- https://github.com/benweet/stackedit/blob/master/src/extensions/abcExtension.js
- https://github.com/benweet/stackedit/blob/master/src/services/workspaceSvc.js
- https://github.com/benweet/stackedit/blob/master/src/services/localDbSvc.js
- https://github.com/benweet/stackedit/blob/master/src/store/explorer.js
- https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts
- https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy
- https://developer.chrome.com/docs/capabilities/web-apis/file-system-access
