# Dávka 11 – bezpečnost souběžných operací

## Opravené případy

- **Pomalé otevření dokumentu**: když uživatel mezitím klikne na jinou poznámku, starší asynchronní čtení nesmí znovu přepnout editor. Každému čtení se přiděluje generační token.
- **Úpravy při načítání**: pokud se po spuštění čtení změní obsah editoru, výsledek se nezapíše přes novější rozepsaný text.
- **Ukládání za běhu dalších editací**: před `await` se zachytí cesta, výchozí fingerprint, BOM, konce řádků a konkrétní verze textu. Po dokončení se *jen tato verze* prohlásí za uloženou. Novější změny zůstanou neuložené a tlačítko pro uložení se znovu aktivuje.
- **Ostatní diskové operace**: otevření/obnovení wiki, tvorba souboru/složky a přesun se nepřekrývají s ukládáním nebo s jinou takovou operací. Během přejmenování/obnovení je editor dočasně jen pro čtení.
- **Opakované načtení stejné poznámky**: `Načíst znovu` načítá z disku i při nezměněné cestě, po potvrzení zahodí rozpracovaný text. Starší implementace měnila cestu na `null` ještě před úspěšným čtením.
- **Zastaralé vykreslování**: při zavření dokumentu se zneplatní pozdější asynchronní výsledky renderování a načítání obrázků.

## Důležité hranice

- `operation-guard.js` je koordinátor operací **v jednom otevřeném okně aplikace**. Nejde o zámek souborů operačního systému ani o atomické ukládání. Otevřeš-li wiki paralelně v jiné aplikaci či jiném okně, ochranu proti běžným externím změnám poskytuje samostatné ověřování fingerprintu v `file-system.js`.
- Přesun s opravou odkazů mezi více soubory **není atomická transakce**. Udržuj zálohy.
- Spuštění přes `file://` na skutečném počítači stále nebylo ověřeno. Testy zde používají simulované rozhraní File System Access API.

## Testy

- `tests/operation-guard.test.cjs` – generační tokeny, výhradní operace, zneplatnění starého čtení, chybná uvolnění zámku.
- `tests/batch11-smoke.py` – dvě překrývající se čtení, pomalé ukládání, zamítnutí přepnutí během zápisu, novější změna textu během ukládání, druhé uložení, znovunačtení souboru.
- Regrese: `node --test tests/*.test.cjs` = 46/46 a deset scénářů `tests/*smoke.py` = 10/10.
