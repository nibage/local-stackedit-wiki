# Stav dávky 18 – ověření lokálního provozu a audit balíčku

**Hlavní změna:** Přidán samostatný `tools/test-file-access.html`. Otevři jej dvojklikem v Chrome nebo Edge, nikoli pomocí serveru, a vyber **pouze testovací složku** (např. přiloženou `demo-wiki`). Stránka předá prohlížeči přímý uživatelský požadavek na oprávnění, vytvoří náhodný soubor `.local-wiki-test-….tmp`, zapíše UTF-8 s CRLF, ověří jeho přečtení a soubor smaže. Neotevírá ostatní dokumenty, nepřepisuje žádný existující soubor a nevyžaduje síť. Pokud odstranění selže, zobrazí výslovné varování; výsledek lze uložit jako anonymizovaný JSON bez názvů či cest.

**Pozor:** Pokud prohlížeč nepovolí přístup nebo mazání dočasného souboru, může test zanechat soubor s předponou `.local-wiki-test-`; uživatel ho může ručně odstranit ze zvolené testovací složky. Pro ostrou wiki se test nepoužívá.

**Nový audit:** `python tools/release-audit.py` kontroluje odkazované lokální JS/CSS v `index.html`, samostatnost testovací stránky a syntax všech modulů `src/*.js` (pokud je dostupný Node.js). Přísnější `python tools/release-audit.py --require-renderers` odmítne považovat balíček za finální vydání, pokud chybí skutečné soubory Mermaid a ABCjs. Přítomnost podle velikosti stále neprokazuje jejich funkčnost; pro tu zůstává samostatný test v aplikaci.

**Ověřeno:** `node --test tests/*.test.cjs`, `python tests/batch18-file-access-smoke.py`, `python tools/release-audit.py`, vybrané starší prohlížečové scénáře. Test přístupu používal simulované handles; na tomto testovacím počítači je skutečný přístup k `file://` blokovaný administrátorským nastavením Chromia i s `--allow-file-access-from-files`.

**Nadále otevřeno:** (1) skutečná offline distribuce Mermaid a ABCjs – dosavadní `vendor` obsahuje placeholdery; knihovny lze jednorázově doplnit přes dialog Renderery; (2) originální `cledit` nebyl integrován (používá se CodeMirror); (3) test `file://` s opravdovým oprávněním je potřeba na cílovém Chrome/Edge. Aplikaci tedy stále označujeme jako vývojové vydání, nikoliv finální upravený StackEdit.
