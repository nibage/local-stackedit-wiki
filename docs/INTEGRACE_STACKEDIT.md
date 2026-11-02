# Technický protokol: budoucí integrace původního StackEditu

## Co jsem ověřil přímo v GitHub repozitáři

Originální `benweet/stackedit` má v `package.json` verzi **5.15.4** a závislosti mimo jiné `vue@^2.5.16`, `vuex@^3.0.1`, `webpack@^2.6.1`, `node-sass@^4.0.0`, `katex@^0.13.0`, `mermaid@^8.9.2`, `abcjs@^5.2.0`, `markdown-it@^8.4.1` a `prismjs@^1.6.0`. K dnešnímu dni jsou to starší technologie a sestavení vyžaduje oddělenou pozornost; například `node-sass@4` je problematický na moderním Node 22.

Ve zdrojovém projektu jsou samostatné moduly:

| Cíl | Soubor originálu | Poznámka |
| --- | --- | --- |
| Markdown konverze | `src/services/markdownConversionSvc.js` | Používá markdown-it a extensionSvc. |
| KaTeX | `src/extensions/katexExtension.js` | `onSectionPreview` volá `katex.render()`. |
| Mermaid | `src/extensions/mermaidExtension.js` | `window.mermaid.mermaidAPI.render()`. |
| ABC noty | `src/extensions/abcExtension.js` | volá `renderAbc` na fenced code `abc`. |
| Registrace rozšíření | `src/extensions/index.js` | Importuje ABC, KaTeX a Mermaid současně. |
| Editor | `src/services/editorSvc.js` | cledit + Prism + konverzní služba, více interních vazeb. |
| Aktuální soubor | `src/store/file.js` | `currentId`, getter `current`. |
| Obsah souboru | `src/store/content.js` | aktuální obsah má ID `${fileId}/content`. |
| Průzkumník | `src/store/explorer.js` a `src/components/Explorer*.vue` | Strom se odvozuje z Vuex `folder/items`, `file/items`. |
| Práce s workspace | `src/services/workspaceSvc.js` | Vytváří a manipuluje interními soubory/složkami. |
| Lokální DB | `src/services/localDbSvc.js` | IndexedDB a transakční synchronizace. |

Zdroj: https://github.com/benweet/stackedit (repo, nikoli vendored v tomto ZIPu).

## Co je v dávce 2 skutečně hotové

`src/file-system.js` poskytuje abstrakci `openWritable()`, `openReadOnly()`, `read(path)`, `write(path, text, expectedFingerprint)`, `refresh()`, `readAsset(path)` a `getTree()`. Běží jako klasický skript z `file://` a nevytváří oddělenou databázi wiki. Je tak připravena vrstva pro propojení StackEditu s fyzickými soubory.

Navazující `src/renderer.js` je **dočasný nezávislý Markdown renderer**, nikoli původní StackEdit. Díky tomu může uživatel nyní testovat navigaci a souborové operace. Při integraci původního StackEditu bude renderer nahrazen službou markdownConversionSvc a jeho rozšířeními. Testy a FS vrstva zůstanou použitelné.

## Navržený postup skutečného forku (další dávky)

1. Získat plný zdrojový checkout a sestavit starší StackEdit se správnou kompatibilitou Node a bundleru. Ve zdejším prostředí není dostupné síťové stažení npm balíků / Git checkout, proto zatím sestavení nebylo možné provést. Neoznačovat meziverzi za fork.
2. Oddělit modul `localWikiFsSvc` jako adaptér k `src/file-system.js` a převádět reálný `path` na stabilní Vuex `fileId` / `folderId`. Stav souboru v `content` musí při editaci zůstat v editoru, ale zapisovat na disk jen přes řízenou save operaci. IndexedDB může uchovávat výhradně layout / editor state, nikoliv být zdrojem pravdy pro wiki.
3. Napojit výběr souboru přes `file/setCurrentId` a `content/patchCurrent` / odpovídající commit. Při otevření a přepnutí ověřit neuložené změny. Zablokovat nepřímé zápisy vyvolané autosynchronizací.
4. Upravit `Explorer.vue` a `ExplorerNode.vue` tak, aby jejich strom odpovídal lokálním cestám, ale zachovat Vue komponenty. Zatím zakázat drag-and-drop a delete, dokud není definována spolehlivá transakční sémantika přesouvání.
5. Z plného balíčku odstranit cloudy až poté, co základní čtení/zápis funguje; neodstranit `src/extensions/index.js`, `markdownConversionSvc.js`, CSS či assety rendererů.
6. Build musí používat relativní asset URL a žádné service worker / CDN / přihlašovací redirecty, které na `file://` nefungují. Ověřit offline dvouklikem v cílovém Chrome/Edge.

## Omezení a rizika

- `window.showDirectoryPicker()` vyžaduje podporovaný prohlížeč, zabezpečený kontext a akt uživatele. Oprávnění může být při každém otevření znovu vyžadováno.
- Ve `file://` může přísná politika prohlížeče blokovat ES moduly a `fetch()` sousedních souborů. Z tohoto důvodu je pilot sestaven jako **classic scripts**, ne ESM.
- V této iteraci je matematika vykreslena alternativním MathJax SVG. Při přechodu na původní StackEdit se obnoví jeho **KaTeX**, zachová se Mermaid a ABCjs. Není správné nyní tvrdit, že jsou již integrovány.
- Dostupnost a správnost `showDirectoryPicker()` z `file://` je třeba otestovat na konkrétním desktopovém systému, zdejší sandbox nedovoluje navigaci na `file://`.

## Dávka 3 – výsledky pokusu o integraci

Doplnili jsme `src/editor-adapter.js` jako výměnnou vrstvu mezi UI a editorem. Rozhraní: `getValue()`, `setValue()`, `setReadOnly()`, `onChange()`, `refresh()`, `focus()` a `format()`. Souborový adaptér v `src/file-system.js` zůstává beze změny. To snižuje riziko pozdější výměny za StackEdit `cledit` (nebude třeba měnit čtení/zápis ani sidebar).

Dávka 3 používá lokálně dostupný CodeMirror 5, **nikoli** komponenty skutečného StackEditu. Pro věrné zachování jeho preview engine i syntaxe diagramů je třeba získat `markdown-it` konfiguraci a upstream rozšíření včetně jejich runtime knihoven (`KaTeX`, `Mermaid`, `ABCjs`); propojení s původním Vuex a plný build zatím nepovažujeme za ověřené.

Sestavení původního projektu v tomto prostředí zůstalo blokované přístupem k registry.npmjs.org (`Could not resolve host`) a starými build závislostmi. Na dostupných zdrojácích jsme ověřili: `src/services/editorSvc.js` vytváří instanci `cledit`, používá `Prism` a `markdownConversionSvc`, jehož konverze závisí na extensionSvc. Samotné přesunutí `Editor.vue` by proto nebylo funkční.

## Dávka 5 – editor upstream nadále není připojen

Ověřena závislost upstream `src/services/editor/cledit/index.js` na dalších 8 modulech (zvýraznění, výběr, keystroke, undo, watcher aj.) a `cleditCore.js` na `diff-match-patch`, `turndown`, HTML sanitizéru a interním Vuex store. Naivní převzetí `Editor.vue` by nebylo funkční; balíčky nepřipojeny.

Doplněno `LocalWikiFS.createFile()` a `createDirectory()` s kontrolou jména, kolize a relativní cesty, náhradní UI `+ Poznámka` / `+ Složka`; jde o skutečné File System Access operace přes povolený adresář. Testy a UI adapter tak mohou později zůstat při výměně CodeMirror → cledit. Pro reálné převzetí upstream editoru musí být nejdříve dostupný kompletní checkout se správnými závislostmi, nebo nezávisle přebalené moduly cledit s licencemi.
