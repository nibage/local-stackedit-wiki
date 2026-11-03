# Uživatelské testování – opravy podle zpětné vazby

Otevírej `index.html` dvojklikem v Chrome nebo Edge. Pro první zápis používej kopii wiki, nikoliv jedinou kopii důležitých poznámek.

## Vzhled a navigace

- **Vzhled**: Světlý / Tmavý / Podle systému. Volba se ukládá lokálně v prohlížeči (pokud prohlížeč úložiště dovolí).
- **Šířka panelu**: tažením úzkého pruhu vedle levé lišty; minimum 190 px, maximum 520 px. Dvojklik na pruh obnoví 255 px. Pomocí kláves `←` a `→` lze měnit šířku také z klávesnice.
- **Fulltext**: kliknutí na nalezený výsledek zachová aktuální režim Náhled / Editor / Vedle sebe. V Náhledu se vyhledá a zvýrazní první viditelný výskyt prvního hledaného slova. Výskyt ve zdrojové Markdown syntaxi (např. neviditelné URL) se v náhledu nemusí zobrazit.

## Vytváření poznámek

- `pivo.md` – nová poznámka v kořeni wiki.
- `/knowledge/pivo.md` – nová poznámka v existující podsložce `knowledge`.
- `/novaslozka/pivo.md` – pokud složka neexistuje, aplikace požádá o její založení. **Bez souhlasu se nevytvoří žádný nový adresář.**
- `/a/b/pivo.md` – po souhlasu vytvoří i několik chybějících podsložek.

Počáteční `/` znamená kořen **vybrané wiki**, nikoli kořen disku. `..`, UNC cesty a rezervované názvy zůstávají zakázané. Stávající soubory se nepřepisují. Pokud vytvoření souboru selže až po založení podsložek (například kvůli oprávněním), prázdné složky mohou zůstat a lze je případně odstranit ručně.

## Význam tlačítek

- **Otevřít složku**: vybere skutečný adresář a požádá Chrome/Edge o právo číst i zapisovat soubory.
- **Otevřít bez zápisu** (dříve Jen pro čtení): importuje seznam místních souborů pomocí fallback filepickeru; lze prohlížet Markdown, ale **nelze ukládat**. Není to režim Náhled; ten se zapíná tlačítkem vpravo nad dokumentem.
- **Zapamatovat tuto wiki**: pokud už je otevřena pro zápis, zaškrtnutí rovnou uloží výběr do IndexedDB; můžeš ji zaškrtnout i před prvním otevřením složky.
- **Poslední wiki**: znovu otevře uložený adresář po kliknutí; prohlížeč může požadovat nové schválení přístupu. Funguje pouze, pokud IndexedDB a handle persistence nejsou v Chrome blokovány (může záležet i na přesné cestě `file://`).
- **Zapomenout**: odstraní uložený výběr z prohlížeče, nezmění wiki na disku.
- **Načíst znovu**: znovu načte právě otevřenou poznámku z disku; typický případ: upravíš tutéž `.md` v Obsidianu/VS Code a chceš vidět nový obsah. Při neuložených změnách vyžaduje potvrzení jejich zahození.
- **Obnovit strom**: znovu projde všechny adresáře a objeví nově přidané, odstraněné nebo přesunuté soubory; typický případ: mimo aplikaci vytvoříš celou složku či nové poznámky. Taky vyžaduje potvrzení zahození neuložených změn.
- **Renderery**: diagnostika a jednorázové doplnění Mermaid / ABCjs. V plně offline distribuci z GitHub Actions mají být přibalené. Po úspěšném skutečném testu lze toto tlačítko odstranit nebo přesunout do nastavení.

## Ruční regresní test

1. Otevři kořen testovací wiki a otevři poznámku.
2. Zvol **Náhled**, přepni na **Fulltext**, vyhledej známé slovo a otevři výsledek. Náhled musí zůstat aktivní a slovo má být zvýrazněné, pokud je skutečně viditelné ve vykresleném Markdownu.
3. Vytvoř `/nova/podslozka/test.md`, potvrď založení chybějících podsložek. Ve stromu najdi novou poznámku.
4. Změň šířku panelu, přepni tmavý/světlý motiv, obnov stránku; volby by měly zůstat zachovány, pokud je povoleno localStorage.
5. Zaškrtni **Zapamatovat tuto wiki**, obnov stránku, klikni na **Poslední wiki**. Při žádosti Chrome znovu povol přístup.
6. Mimo aplikaci vytvoř nový `.md`; po **Obnovit strom** se má objevit. Mimo aplikaci změň obsah otevřené poznámky; po **Načíst znovu** se mají zobrazit nové změny.

**Neotestované v reálném Chrome:** uložení root handle po restartu prohlížeče v konkrétním `file://` původu; nutné ověřit uživatelem. Testy v Chromiu používají simulované handles.
