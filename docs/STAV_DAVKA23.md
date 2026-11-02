# Dávka 23 – ověřitelná offline instalace z npm archivu

Nově lze vytvořit plně offline distribuční ZIP **bez síťového přístupu na sestavovacím počítači**, pokud již máš čtyři originální soubory npm registru. Skript `tools/build-offline-release.py --cache-dir npm-cache` je použije místo stahování. Původní verifikace originálních archivu pomocí npm SHA-512, licence, kontrola API, a nezávislé cdnjs/SRIs SHA-512 pro Mermaid zůstávají beze změny. Není možné pokračovat při chybě nebo chybějícím souboru.

Podrobný návod v `docs/OFFLINE_SESTAVENI.md`. Při běžném používání aplikace nebude Python ani npm potřeba; jde výhradně o způsob sestavení.

## Ověření zde

- 80/80 testů aplikace (Node.js) – prošlo
- 10/10 testů sestavovače (Python) – prošlo
- `tests/batch17-smoke.py` – prošel (odkazy do sekcí)
- `tests/batch21-smoke.py` – prošel (import lokálních JS souborů se simulovanou distribucí)
- `tools/release-audit.py` – kontrola vývojové verze prošla
- **Přísný release audit musí selhat**, protože skutečné Mermaid a ABCjs v tomto ZIPu stále chybí.

## Nedokončené

- Funkční skutečné Mermaid a ABCjs originální knihovny (v archivu stále zástupné soubory)
- Originální StackEdit/cledit (editor je CodeMirror)
- Přímé otevření přes `file://` není ověřené v cílovém Chrome/Edge (místní Chromium ho odmítá pravidlem správce)

**Tato dávka není release candidate.** Neprováděli jsme plný smoke test skutečných rendererů, protože originální npm archivy ani distribuční JS se zde nepodařilo získat. Bez nich by tvrzení o plném offline vydání nebylo podložené.
