# Dávka 15 – funkční zkouška volitelných offline rendererů

## Implementováno

- Přidán `src/renderer-selftest.js`. Kliknutí na **Renderery → Otestovat skutečné vykreslení** volá reálné veřejné API nainstalovaných knihoven (Mermaid `mermaidAPI.render`, ABCjs `renderAbc`) s pevně daným ukázkovým diagramem a jednoduchou notovou osnovou. Test nečte žádné uživatelské `.md` soubory.
- Každý z rendererů vrací **připraveno / chybí / chyba**. Výsledek **připraveno** vyžaduje skutečně vzniklý SVG element s grafickými částmi; samotná existence `window.mermaid` či `window.ABCJS` nestačí.
- Zkouška nezasahuje do aktuálně otevřené poznámky, neprovádí žádné diskové zápisy, nepoužívá síť a odstraní dočasné prvky v DOM. Při neodpovídajícím Mermaid renderu se zkouška ukončí po 6,5 s.
- Poslední stav testu (`ok`, `missing`, `failed`) se objeví v diagnostickém JSON. **Text chybových výpisů se do diagnostiky neexportuje**, aby neunikly cesty ani obsah.
- `index.html`, `assets/app.css`, `src/main.js`, `src/diagnostics.js`, `tools/verify-offline.py`, testy a číslo dávky aktualizovány.

## Testováno

- `node --test tests/*.test.cjs`: 64/64 úspěšných automatických testů.
- `python tests/batch15-smoke.py`: UI test chybějících knihoven a zkušební render přes simulovaná veřejná API, včetně kontroly vyčištění DOM, bez chyb JS.
- Regresní testy `batch07`, `batch10`, `batch11`, `batch13`, `batch14` v Chromium úspěšné.
- `python tools/verify-offline.py`: žádné chybějící soubory jádra; skutečné Mermaid a ABCjs **NEJSOU PŘIBALENÉ**.

## Pořád není splněno

1. **Mermaid a ABCjs nejsou v ZIPu jako skutečné distribuce.** Je možné je stáhnout přímo v aplikaci jednorázovým instalačním tlačítkem. Nová zkouška následně ověří jejich praktickou funkčnost. Zde byly použity testovací náhrady API; reálné distribuční soubory nebyly k dispozici.
2. **Původní editor StackEdit/`cledit` není integrován.** Aplikace stále využívá CodeMirror 5, marked a MathJax 2. Nesprávně ji označovat za fork originálního StackEditu.
3. **Spuštění dvojklikem přes `file://` je stále neověřené.** Zdejší testovací Chromium blokuje otevření lokálního souboru administrátorskou politikou. Finální Windows/Chrome/Edge test proběhne až s uživatelem.
4. Automatické testy přístupu ke složce používají simulované File System Access API; nejsou zárukou bezchybného zápisu na skutečný disk.

## Licence

Projekt nadále obsahuje pouze původní licence přibalených CodeMirror (MIT), marked (MIT) a MathJax (Apache-2.0). `src/renderer-selftest.js` je vlastní integrační kód. Nepřebírá knihovny ani autorské soubory Mermaid / ABCjs.
