# RC3 – oprava rozložení, motivů a izolace lokálních dat

## Opravené regrese

- RC2 vynechala v `index.html` `<link rel="stylesheet" href="assets/feedback-theme.css">`. Tento soubor obsahuje rozložení **tří** sloupců (sidebar / resizer / pracovní plocha) a styly světlého/tmavého motivu. Chybějící odkaz způsobil, že prohlížeč použil staré **dvousloupcové** grid pravidlo a třetí prvek (editor) odsunul pod postranní panel.
- Odkaz na CSS je obnoven. RC3 obsahuje test, který v Chromiu porovnává skutečné pozice a rozměry levého panelu a editoru a změny vypočítaných barev při přepnutí motivu.

## Izolace nastavení při `file://`

- Nový soubor `src/instance-scope.js` odvozuje identitu instance z **úplné URL právě otevřeného index.html**, bez fragmentu a parametrů.
- `localStorage` klíče pro motiv a šířku lišty jsou předponovány touto identitou. Uložený handle pro poslední wiki používá IndexedDB s názvem, který je rovněž unikátní pro tuto cestu.
- Staré globální hodnoty z RC2 nejsou čteny, migrovány ani mazány. Nejedná se o zásah do existujícího úložiště jiné aplikace.
- Dvě různé složky s kopií aplikace mají tedy oddělenou konfiguraci. Při aktualizaci **na téže cestě** se však konfigurace zachová, což je záměr.
- Toto logické oddělení klíčů/databází není kryptografická bezpečnostní izolace: skutečný režim přidělování originů pro `file://` řídí prohlížeč. Pro přísnou bezpečnostní izolaci používej samostatné profily Chromu.

## Ověření

- `node --test tests/*.test.cjs`
- `python tests/offline-release-build.test.py`
- `python tests/rc3-layout-storage-smoke.py`
- `python tests/rc2-ui-smoke.py`
- `python tests/ui-feedback-smoke.py`
- `python tests/real-renderers-release-smoke.py --root . --chromium /usr/bin/chromium`
- `python tools/release-audit.py --require-renderers`

**Chrome otevřený dvojklikem (`file://`) je stále potřeba ověřit na tvém PC**. Zdejší Chromium zakazuje navigaci na `file://` zásadou správce; automatizované browser testy používají lokálně obsloužené soubory bez externích požadavků.

## Před použitím

Rozbal RC3 do **nové, samostatné složky** a otevři `index.html` v Chromu. Očekávej, že se napoprvé neobnoví poslední wiki z jiné instalace – vyber `demo-wiki`. V režimu vedle sebe má být editor i náhled na celé pravé ploše, vedle levé lišty. Vyzkoušej světlý/tmavý/systémový motiv, roztažení lišty a otevření `demo-wiki/Diagramy/UML.md` či `demo-wiki/Diagramy/Noty.md`.
