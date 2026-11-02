# Testování po první zpětné vazbě

## Nové chování
- **Fulltext**: při otevření výsledku zůstává zvolený režim Náhled, Editor nebo Vedle sebe. V Náhledu se zvýrazní první viditelný výskyt prvního hledaného slova. Výskyt skrytý ve zdrojové Markdown syntaxi nemusí být v Náhledu viditelný.
- **Nová poznámka**: `/knowledge/pivo.md` je cesta od kořene právě otevřené wiki, nikoli od kořene disku. Při `/nova/podslozka/pivo.md` se nabídne vytvořit chybějící adresáře; bez potvrzení se nic nevytvoří. Zakázané jsou `..`, síťové cesty, rezervované adresáře a překrývání názvů. Pokud až později selže vytvoření souboru, může na disku zůstat nová prázdná složka.
- **Lišta**: tažením svislé hrany nastavíš šířku 190–520 px; dvojklik vrací 255 px. Klávesnice: šipky vlevo/vpravo, Home a End.
- **Vzhled**: Světlý / Tmavý / Podle systému; preference se ukládá do localStorage, pokud jej prohlížeč povoluje.

## Rozdíly mezi tlačítky
- **Otevřít složku**: přímý přístup k lokální wiki se čtením a zápisem, po potvrzení v Chromu.
- **Otevřít bez zápisu** (dříve Jen pro čtení): záložní výběr souborů prostřednictvím `webkitdirectory`; neumožňuje ukládání ani správu souborů. Nesouvisí s přepínačem Náhled.
- **Zapamatovat tuto wiki**: lze zaškrtnout před výběrem složky nebo přímo po něm; ukládá vybraný adresář do IndexedDB v tomto prohlížeči, nikoliv soubory.
- **Poslední wiki**: znovu otevře uložený adresář; Chrome může znovu žádat oprávnění. Záleží na podpoře úložiště pro konkrétní `file://` původ.
- **Zapomenout**: smaže uložený výběr, nikoliv soubory na disku.
- **Načíst znovu**: právě otevřenou poznámku přečte z disku znovu; vhodné po úpravě ve VS Code / Obsidianu. Může zahodit neuložené úpravy po potvrzení.
- **Obnovit strom**: znovu projde adresáře; vhodné po vytvoření, smazání nebo přejmenování souborů mimo aplikaci. Může zahodit neuložené úpravy po potvrzení.
- **Renderery**: diagnostika a pomocník pro Mermaid/ABCjs. Ještě nejsou v repozitáři jako plné offline distribuce. GitHub Actions vytváří ověřovaný kompletní ZIP.

## Doporučený test v Chrome
1. Otevři kořen **kopie** testovací wiki.
2. V režimu Náhled vyhledej známé slovo přes Fulltext a klikni na výsledek; zkontroluj, že zůstal náhled a je vidět zvýraznění.
3. Vytvoř `/nova/podslozka/test.md` a potvrď založení podsložek.
4. Změň motiv a šířku panelu, obnov stránku; volby by měly zůstat zachovány.
5. Zaškrtni Zapamatovat tuto wiki; obnov stránku a klikni na Poslední wiki. Znovu případně povol přístup.
6. Externě přidej `.md` a klikni Obnovit strom. Externě změň aktivní poznámku a klikni Načíst znovu.

**Poznámka:** Automatické testy prohlížeče používají simulované soubory. Reálná perzistence File System Access handle v lokálním Chrome vyžaduje uživatelský test.
