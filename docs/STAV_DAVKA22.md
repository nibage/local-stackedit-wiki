# Dávka 22 — prověření skutečné funkčnosti distribučního ZIPu

## Změna

- `tests/real-renderers-release-smoke.py`: automatizovaný Chromium test, čte soubory z finálního ZIPu, **všechny síťové požadavky směruje na lokální obsah** a odmítá cizí síťové požadavky.
- Zkontroluje dostupnost UMD API Mermaid a ABCjs a fyzické SVG z obou vestavěných self-testů.
- Navíc otevře přímo Markdown renderer a vyžaduje SVG pro kódové bloky `mermaid` a `abc`.
- `.github/workflows/offline-release.yml`: nainstaluje Playwright Chromium a spustí uvedený test ještě před zveřejněním artefaktu.
- Aktualizováno viditelné číslo dávky a identifikátor v diagnostice.

## Výsledky v tomto prostředí

- 80/80 dosavadních Node testů prošlo.
- Nový E2E test prošel s **testovacími simulovanými UMD knihovnami**; ověřuje tím testovací infrastrukturu a skutečnou integrační cestu, nikoli originální distribuce.
- Po vrácení původních placeholderů nový E2E test správně odmítne aktuální vývojový balíček a přísný audit se také nedokončí.
- Integrační test originálních Mermaid/ABCjs je nastaven pro GitHub Actions, ale nebyl zde spuštěn nad kompletními knihovnami.
- Spuštění `file://` v lokálním Chromiu je blokováno prostředím (`ERR_BLOCKED_BY_ADMINISTRATOR`), takže zůstává neověřené.

## Nedořešené

Originální Mermaid 8.9.2 a ABCjs 6.4.4 nejsou v tomto ZIPu; nelze proto označit aplikaci za hotové offline vydání. Editor `cledit` nenahrazuje současný CodeMirror.
