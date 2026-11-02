# Stav projektu po dávce 14

## Doložitelné změny

- Nový `src/recent-wiki.js`: výhradně dobrovolné uložení adresářového handle do IndexedDB, načtení, kontrola oprávnění a odstranění.
- `src/file-system.js`: možnost znovu připojit již vybraný adresář (`openExisting`).
- `index.html` + `src/main.js`: **Zapamatovat složku**, **Poslední wiki**, **Zapomenout**. Oprávnění k zápisu se nevyžaduje při načtení stránky, ale až po kliknutí.
- Rozšířené testy v `tests/recent-wiki.test.cjs` a `tests/batch14-smoke.py`.

## Výsledek testů

- `node --test tests/*.test.cjs`: **57/57**.
- `python tests/batch14-smoke.py`: úspěšný Chromium test s mock handle.
- `python tests/batch10-smoke.py`: úspěšný scénář integrity BOM, CRLF a externí změny.
- `python tests/batch13-smoke.py`: úspěšný scénář simulované instalace rendererů.
- `python tests/batch07-smoke.py`: úspěšný scénář přesouvání poznámek a přepisování odkazů.
- `python tools/verify-offline.py`: základní struktura OK; Mermaid a ABCjs **nejsou přibaleny**.

## Nenaplněné požadavky

- Originální StackEdit/`cledit` není integrován; editor stále využívá CodeMirror.
- Offline Mermaid a ABCjs nejsou přibalené. Uživatel je může po potvrzení jednorázově stáhnout instalačním tlačítkem a následně používat offline, ale skutečné oficiální distribuční soubory nebyly otestovány.
- Spouštění přes dvojklik (`file://`) není ověřeno; v tomto vývojovém Chromiu je `file://` blokováno politikou `ERR_BLOCKED_BY_ADMINISTRATOR`. Za určitých nastavení Chrome/Edge nemusí IndexedDB nebo File System Access API fungovat pro `file://`; je zachován režim přímého výběru a režim jen pro čtení.

## Bezpečnost

`FileSystemDirectoryHandle` je v prohlížeči uložen pouze po aktivním zaškrtnutí. Obsah wiki zůstává uložen na disku. Správa oprávnění náleží prohlížeči a nový přístup se bez uživatelského povolení neobnoví. Před prvním použitím na originální wiki doporučujeme zálohu.
