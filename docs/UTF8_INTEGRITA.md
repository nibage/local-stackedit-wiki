# Dávka 10 – integrita zápisu a omezení

## Motivace

Dřívější `read()` používalo `File.text()`, které může vadné UTF-8 bajty nahradit znakem U+FFFD a při dekódování automaticky odstranit UTF-8 BOM. Původní ukládání kontrolovalo pouze velikost a `lastModified`. To je pro úpravy existující wiki rizikové.

## Změny

- Souborové `read()` a `readRaw()` nyní používají `file.arrayBuffer()` a `TextDecoder('utf-8', { fatal: true, ignoreBOM: true })`, takže chybné UTF-8 vyvolá chybu, nikoli tichou náhradu. `ignoreBOM:true` zachovává `U+FEFF` v dekódovaném textu, aby jej `readRaw()` použilo doslovně.
- `read()` vrací `hasBOM`, z textu pro editor však odstraní počáteční U+FEFF. UI přidá BOM při běžném ukládání zpět.
- `readRaw()` (pro opravu odkazů) zachová celé dekódované znění včetně BOM, a tedy nepřijde o původní značení.
- Otisk nyní kombinuje délku, poslední modifikaci, FNV-1a 32 bit a Adler-32. Před zápisem i přesunem se skutečný obsah znovu přečte.
- Při uložení se zachovává styl konců řádků normalizovaný při načítání.

## Zůstávající rizika

1. FNV/Adler nejsou kryptografické hashe. Tato kontrola odhaluje náhodné souběžné změny, není bezpečnostní autentizací proti úmyslnému útočníkovi.
2. Mezi ověřením a otevřením streamu pro zápis může jiný proces soubor změnit. File System Access API neposkytuje jednoduchý přenosný atomický compare-and-swap.
3. Aplikace záměrně předpokládá UTF-8. Soubory v CP1250/ISO-8859-2 musíš před úpravou převést externím programem. Soubor obsahující pouze ASCII bajty je kompatibilní s UTF-8.
4. Míchané konce řádků se při úpravě sjednotí podle detekovaného stylu; jde o starší chování aplikace. Plně bezeztrátová editace při smíšených LF/CRLF zatím není vyřešená.
5. Operace přesunu s opravou odkazů mění více souborů a nejsou atomické. Před prvním použitím na vlastní wiki potřebuješ zálohu.
6. Zápis přes `file://` nelze v místním testovacím sandboxu ověřit. Cílový Chrome/Edge bude vyžadovat výběr kořenové složky a povolení zápisu.

## Ověření

- `node --test tests/*.test.cjs` → 42/42
- `python tests/batch10-smoke.py` → uložení BOM+CRLF, záchyt externí změny stejně dlouhého souboru i zablokování chybného UTF-8.
- Regresní prohlížečové scénáře `ui-smoke.py`, `editor-smoke.py` a `batch04-smoke.py` až `batch09-smoke.py` prošly.
- Prohlížečové testy využívají simulované API, nikoli reálné OS oprávnění.
