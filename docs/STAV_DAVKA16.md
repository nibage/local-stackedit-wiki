# Dávka 16 – záložní zdroje offline rendererů

## Změna

Instalátor v `src/renderer-installer.js` používá dvě ověřené distribuční adresy stejné verze pro každý renderer:

- Mermaid 8.9.2: `cdnjs.cloudflare.com/ajax/libs/mermaid/8.9.2/mermaid.min.js`, záloha `cdn.jsdelivr.net/npm/mermaid@8.9.2/dist/mermaid.min.js`.
- ABCjs 6.4.4: `cdnjs.cloudflare.com/ajax/libs/abcjs/6.4.4/abcjs-basic-min.min.js`, záloha `cdn.jsdelivr.net/npm/abcjs@6.4.4/dist/abcjs-basic-min.js`.

Když první CDN vyhodí síťovou chybu, vrátí HTTP chybu nebo neplatnou odpověď, aplikace zkusí druhou. Oba soubory stáhne **před zápisem prvního z nich**, takže při selhání obou CDN zůstanou zástupné soubory beze změny. Kontrola ukládání a omezení pouze na složku aplikace zůstaly zachovány.

## Ověření

- `node --test tests/*.test.cjs`: **67/67 úspěšných testů**, včetně nových testů výpadku první CDN, chybných dat z první CDN a kompletního výpadku obou CDN.
- `python tests/batch13-smoke.py`: test instalačního tlačítka v Chromium prošel (simulované stažení).
- `python tests/batch15-smoke.py`: test dialogu / SVG renderování přes simulované API prošel.
- `python tools/verify-offline.py`: struktura balíčku je OK; explicitně hlásí, že skutečné knihovny Mermaid a ABCjs **nejsou přibalené**.

## Nevyřešené

- Skutečné distribuční soubory Mermaid/ABCjs se v tomto prostředí nepodařilo stáhnout a **nejsou v ZIPu**. Je nutné jednorázové stažení na počítači s internetem; reálné vykreslování zatím nebylo ověřeno.
- Editor je CodeMirror, nikoli původní StackEdit `cledit`.
- Cílové `file://` prostředí nedokážeme zde otestovat: nasazený Chromium vrací `ERR_BLOCKED_BY_ADMINISTRATOR` před načtením HTML.

Zůstává samostatnou prototypovou implementací; změna CDN neznamená implementaci ani sestavení původního StackEditu.
