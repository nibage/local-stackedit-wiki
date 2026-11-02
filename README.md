# Local StackEdit Wiki – dávka 23

**Novinka: alternativní sestavení kompletní distribuce ze čtyř předem stažených oficiálních npm souborů, bez přístupu sestavovacího počítače k internetu.** Viz `docs/OFFLINE_SESTAVENI.md`. Výstup prochází beze změny kontrolou npm SHA-512, nezávislým Mermaid SHA-512 a přísným auditem. GitHub Actions online režim zůstává zachován.

**Pozor:** samotný tento vývojový ZIP **stále obsahuje pouze zástupné JS soubory Mermaid/ABCjs**. Offline sestavení vyžaduje originální npm metadata a tarbally, které v tomto prostředí nemám k dispozici. Proto jsem neprovedl skutečný test vykreslení obou knihoven a projekt zatím není finálním vydáním. Originální editor StackEditu `cledit` také stále není integrován (používá se CodeMirror). Skutečné otevření `file://` na Edge/Chrome čeká na závěrečné uživatelské ověření.

---

# Local StackEdit Wiki – dávka 22

**Novinka: povinný skutečný prohlížečový smoke test offline rendererů pro vydání přes GitHub Actions.** Nástroj `tests/real-renderers-release-smoke.py` rozbalí distribuční ZIP do dočasné složky, načte jej v Chromiu bez HTTP serveru a bez externí sítě a spustí skutečný Mermaid i ABCjs. Testuje samostatný self-test **a také jejich použití v běžném Markdown náhledu**. Pokud některý renderer nevygeneruje SVG, vydání selže a workflow ZIP neuveřejní jako artefakt.

**Omezení:** tento vývojový ZIP stále neobsahuje obě knihovny — v `vendor/` jsou zástupné soubory. Proto přísný audit správně selže. Pro získání kompletního distribučního ZIPu je nutné spustit `.github/workflows/offline-release.yml` v repozitáři s rozbalenými zdrojovými kódy; workflow stáhne oficiální npm balíčky, ověří jejich kontrolní součty, sestaví ZIP, nainstaluje Chromium a **až po reálném vykreslovacím testu** nahraje výsledek. Zdejší prostředí nemá přístup k npm/CDN, takže zatím nemohu tvrdit, že tímto testem oficiální renderery prošly.

Pokud máš Playwright a lokálně již sestavený plný ZIP, test lze spustit také:

```bash
python tests/real-renderers-release-smoke.py --zip local-stackedit-wiki-offline.zip
```

Pro vývoj je možné uvést `--chromium /usr/bin/chromium`. Test se řídí úplně lokálně uloženými assety, blokuje veškeré externí HTTP požadavky a nemění žádnou wiki. **Samotné použití `file://` zůstává neověřené** a na vlastním zařízení je bude třeba otestovat; test používá izolované načtení HTML a lokální obsluhu souborů.

Původní editor `cledit` stále není integrován; praktická aplikace používá CodeMirror, marked a MathJax. Další funkce a historické poznámky zůstávají uvedeny níže.

---

# Local StackEdit Wiki – dávka 21

**Nově: offline import oficiálních rendererů z lokálních JS souborů.** V dialogu **Renderery** je možné vybrat již stažené soubory `mermaid.min.js` a `abcjs-basic-min.js` (případně `abcjs-basic-min.min.js`) a kliknout na **Uložit vybrané JS offline**. Aplikace vyžádá přístup pouze ke své vlastní složce s `index.html`, nikoli k tvé wiki. Oba soubory ověří ještě před zápisem, Mermaid podle pevného SHA-512. Při selhání nedojde k částečné instalaci; při selhání zápisu se pokusí o obnovu původních dat.

Pro získání souborů při prvotní instalaci je potřeba internet na počítači, ze kterého je stahuješ (ne během běhu wiki). Oficiální zdroje:
- Mermaid 8.9.2: https://cdnjs.cloudflare.com/ajax/libs/mermaid/8.9.2/mermaid.min.js
- ABCjs 6.4.4: https://cdn.jsdelivr.net/npm/abcjs@6.4.4/dist/abcjs-basic-min.js

**Stav vydání:** v tomto ZIPu jsou stále jen *placeholdery* Mermaid a ABCjs, proto přísný release audit neprojde. Skutečný `cledit`/StackEdit není integrován (CodeMirror + MathJax). Dvojklik `file://` ještě nebyl ověřen na skutečném Chrome/Edge. **Není to finální vydání.**

**Testy:** `node --test tests/*.test.cjs`, `python tests/offline-release-build.test.py`, `python tools/release-audit.py`. Pro zkoušky zápisu používej kopii wiki.

---

# Local StackEdit Wiki – dávka 20

**Nově:** automatický a kontrolovaný sestavovač plně offline distribuce `tools/build-offline-release.py`. Z originálních npm balíčků se správnými SHA-512 otisky dokáže vytvořit ZIP obsahující skutečné Mermaid 8.9.2 a ABCjs 6.4.4 včetně licencí, bez stahování při běžném používání. Kontrola release nyní vyžaduje kontrolní manifest a skutečný Mermaid SHA-512. Volitelně lze sestavit ZIP na GitHub Actions (`.github/workflows/offline-release.yml`). Podrobný popis a omezení najdeš v `docs/STAV_DAVKA20.md`.

**Pozor:** Tento konkrétní vývojový ZIP stále **neobsahuje** skutečné Mermaid a ABCjs distribuční soubory, protože sestavovací prostředí neumí kontaktovat npm registr. Finální plně offline ZIP vznikne až spuštěním sestavovače v prostředí s internetem. Aplikace zatím používá CodeMirror (nikoli originální StackEdit/cledit). Otevření přes `file://` zůstává neověřené na cílovém Chrome/Edge.

**Testy:** `node --test tests/*.test.cjs` a `python tests/offline-release-build.test.py`. Striktní audit `python tools/release-audit.py --require-renderers` na této *vývojové* verzi záměrně selže a tím brání nesprávnému označení za hotový release. Pro první test na reálných `.md` souborech používej kopii wiki.

---

# Local StackEdit Wiki – dávka 19

V této dávce je zpřísněn **instalátor skutečných offline rendererů**. Tato verze ještě NEOBSAHUJE samotné soubory Mermaid a ABCjs; aplikace je umí volitelně instalovat po povolení přístupu ke složce aplikace. Nikdy si nepřivlastňuje přístup ke složce wiki kvůli instalaci.

**Změny:**
- Mermaid 8.9.2 se při stažení i při rozpoznání již nainstalovaného souboru ověřuje pomocí SHA-512 hash publikovaného v [cdnjs/SRIs](https://github.com/cdnjs/SRIs/blob/master/mermaid/8.9.2.json). Při neshodě instalace končí chybou.
- U obou knihoven kontrolujeme kromě velikosti i přítomnost očekávaného API. U ABCjs se zatím nejedná o kryptografické ověření původu; balíček používá pouze verzi 6.4.4 a HTTPS.
- Pokud dojde k chybě při ukládání druhé knihovny, instalátor se pokusí obnovit původní soubory obou knihoven a nahlásí případné neúplné obnovení. Není to atomická transakce souborového systému.
- Diagnostické JSON má označení `batch19`.

**Ověření:** `node --test tests/*.test.cjs`, `python tools/release-audit.py`; přísná kontrola `python tools/release-audit.py --require-renderers` má stále selhat. Otevírání přes `file://` nebylo v tomto prostředí reálně otestováno. Pro první použití na vlastní wiki doporučujeme její zálohu.

**Důležité:** Není to originální fork StackEditu. Editor používá CodeMirror a matematika MathJax, ne `cledit` a KaTeX. Renderer Mermaid/ABCjs se bez skutečných knihoven nebude vykreslovat.

---

# Local StackEdit Wiki – dávka 18

**Nově:** samostatná offline diagnostika dvojkliku `tools/test-file-access.html` a přísnější audit distribučních souborů `tools/release-audit.py`. Diagnostika testuje přístup k testovací složce, vytvoření, čtení, zápis a odstranění dočasného souboru. Otevírej ji pouze s testovací složkou, nikdy s originální wiki. Je dostupná také odkazem z dialogu **Renderery**. Podrobnosti: `docs/STAV_DAVKA18.md`.

**Vývojová kontrola:** `node --test tests/*.test.cjs`, `python tests/batch18-file-access-smoke.py`, `python tools/release-audit.py`. Přísný `python tools/release-audit.py --require-renderers` má v této dávce úmyslně selhat: skutečné knihovny Mermaid/ABCjs dosud nejsou v ZIPu. Zůstávají jednorázově doplnitelné prostřednictvím aplikace.

**Není finálním forkem StackEditu.** Editor je nadále CodeMirror, matematika MathJax. Reálný dvojklik přes `file://` není v tomto vývojovém prostředí ověřitelný. Uživatelský test proběhne až po dokončení hlavních částí projektu. Vlastní wiki doporučujeme před prvním zápisem zazálohovat.

---

# Local StackEdit Wiki – dávka 17

**Nově:** opravena navigace po interních odkazech na nadpisy. Fungují běžné Markdown odkazy `[text](Cesta.md#nadpis)` a odkazy Obsidianu `[[Poznámka#Nadpis]]` i `[[#Nadpis]]` v právě otevřené poznámce. Navigace nepřepisuje Markdown soubory; při nenalezeném nadpisu vypíše upozornění. Duplicitní názvy souborů nejsou automaticky rozpoznávány odhadem. Ukázky: `demo-wiki/index.md` a `demo-wiki/Programovani/Python.md`.

**Ověření:** `node --test tests/*.test.cjs`, `python tests/batch17-smoke.py` a `python tools/verify-offline.py`. Cílové spuštění dvojklikem přes `file://` zde zůstává zablokované zásadou testovacího prohlížeče; prohlížečové scénáře stále používají simulované soubory.

**Nadále nehotovo:** tento projekt používá CodeMirror + marked + MathJax, **nikoli editor StackEdit `cledit`**. Skutečné distribuce Mermaid 8.9.2 a ABCjs 6.4.4 nejsou přibalené, lze je jednorázově doplnit přes tlačítko **Renderery**. Reálné vykreslování s nimi zatím není ověřeno. Proto dávka 17 není finální vydání a vlastní wiki zatím zkoušej jen se zálohou.

---

# Local StackEdit Wiki – dávka 16

**Nově:** Jednorázový instalátor Mermaid 8.9.2 a ABCjs 6.4.4 umí použít záložní CDN, pokud první zdroj nefunguje nebo vrátí neplatný obsah. Obě knihovny se stáhnou před zahájením zápisu; úplný výpadek sítě nemění žádné soubory. Podrobnosti: `docs/STAV_DAVKA16.md`.

**Ověřeno:** 67/67 automatických testů; prohlížečové scénáře dávky 13 a 15; kontrola struktury. **Stále nedokončeno:** skutečné JS distribuce Mermaid a ABCjs v ZIPu, originální `cledit`, ověření `file://`. Aplikace používá CodeMirror + MathJax, nikoli původní StackEdit.

---

# Local StackEdit Wiki – dávka 15

**Nově:** v dialogu **Renderery** je tlačítko **Otestovat skutečné vykreslení**. Oproti pouhé kontrole, zda existuje JS knihovna, vykreslí malý zkušební Mermaid flowchart a ABC notovou osnovu. Výsledek zobrazí jako OK / chybí / selhalo, bez čtení nebo změn poznámek. Poslední stav testu lze připojit ke zprávě o chybě přes **Uložit diagnostiku JSON**; report obsahuje jen kódy stavů, nikoli text chyby či obsah wiki. Dokumentace: `docs/STAV_DAVKA15.md`.

**Důležité:** oficiální Mermaid/ABCjs **nejsou v ZIPu přibalené**; po jednorázovém doinstalování je lze ověřit tímto testem. Původní StackEdit `cledit` není integrován (používá se CodeMirror), spuštění přes `file://` nebylo možné otestovat ve vývojovém Chromium. Uživatel bude finální build testovat až po dokončení.

**Ověřeno:** 64/64 Node testů, nové UI Chromium + regresní scénáře 7/10/11/13/14. Skutečné distribuce nejsou testem s mock API nahrazovány ani vydávány za hotové.

---

# Local StackEdit Wiki – dávka 14

**Nově:** volitelné zapamatování poslední složky v IndexedDB. Otevři wiki s předem zaškrtnutým **Zapamatovat složku**; příště použij **Poslední wiki**. Prohlížeč může opět vyžadovat povolení. **Zapomenout** odstraní pouze uložený výběr; podrobnosti viz `docs/ULOZENA_SLOZKA.md`.

**Nadále nehotové:** originální StackEdit/`cledit` a skutečné přibalené Mermaid/ABCjs. `file://` test na uživatelově PC dosud chybí.

# Local StackEdit Wiki – dávka 13

**Kompletní vývojová meziverze pro Chrome / Edge.** Jde o samostatný Markdown editor, nikoli o fork StackEditu. Editor je CodeMirror 5 a matematika MathJax 2. Cílový režim je otevření `index.html` dvojklikem; ten zatím nebylo možné ověřit na skutečném desktopu.

## Nově v dávce 13: jednorázové doplnění skutečných offline rendererů přímo z prohlížeče

Předchozí dávky obsahovaly pouze adaptéry pro Mermaid/ABCjs a *placeholder* soubory. Teď lze v dialogu **Renderery → Doplnit offline renderery…** skutečné distribuce stáhnout do složky aplikace. Žádný server, npm ani PowerShell není potřeba; pro jednorázové stažení je však potřeba internet. Běžný běh aplikace žádné síťové požadavky neprovádí.

1. Rozbal tento ZIP do vlastní složky, ideálně mimo wiki (např. `LocalStackEditWiki/`).
2. Otevři `index.html` v Chrome nebo Edge, klikni na **Renderery → Doplnit offline renderery…**.
3. Vyber právě tuto složku aplikace (tu, která obsahuje `index.html` a `vendor/`), **nikoli složku své wiki**. Povol zápis.
4. Aplikace přes HTTPS stáhne **Mermaid 8.9.2** a **ABCjs 6.4.4**, zkontroluje základní parametry a zapíše přesně dva JS soubory do `vendor/`. Při síťové chybě se před stažením obou balíčků nic nezapisuje. Po uložení proběhne kontrola shody bajtů.
5. Obnov stránku (`Ctrl+R`) a v **Renderery** ověř, že Mermaid i ABCjs jsou skutečně dostupné. Od té doby běží offline; vyzkoušet lze `demo-wiki/Diagramy-a-noty.md`.

**Důležitá omezení:** Nynější ZIP **stále neobsahuje** skutečné distribuce obou knihoven; instalátor je získá až na počítači uživatele. Dosavadní testy používají náhradní CDN odpovědi / simulované veřejné API, nikoli skutečné stažené bundly. Kontrola velikosti a bajtové shody **není kryptografické ověření původu**. Stahování důvěřuje HTTPS a cdnjs. Instalátor nečte ani neupravuje soubory wiki. V případě nedostupnosti internetu jsou nadále k dispozici jednorázové skripty `tools/download-renderers.ps1` a `.sh` nebo ruční umístění oficiálních JS souborů.

Zachované funkce: reálný strom Markdown souborů, čtení/ukládání se zachováním UTF-8 BOM a CRLF/LF, detekce externích změn, tvorba souborů a složek, přesouvání poznámek s pokusem o opravu odkazů, vyhledávání, backlinks, Obsidian syntaxe a matematika.

**Před prvním zápisem do vlastní wiki ji zazálohuj.** Doporučujeme na závěrečném testu nejprve zkusit `demo-wiki`. V tomto prostředí nelze otestovat skutečný `file://` přístup ani reálné CDN soubory. Uživatel zamýšlí testovat až po dokončení; meziverze nevyžaduje průběžné zkoušení.

## Testy

- `node --test tests/*.test.cjs` – včetně instalačních scénářů: úspěch, nesprávná složka, síťové selhání bez změn, zabránění přepsání nainstalované knihovny, neplatná odpověď a selhání zápisu.
- `python tests/batch13-smoke.py` – Chromium simulující výběr složky a stažení obou JS souborů.
- `python tools/verify-offline.py` – kontrola adresářové struktury a zjištění přítomnosti skutečných rendererů. Ve výchozím ZIPu chybějí, takže nástroj to správně oznámí.

## Licence

Jádro této meziverze používá CodeMirror (MIT), marked (MIT), MathJax (Apache-2.0). Oficiální Mermaid a ABCjs jsou MIT, budou získány uživatelem přímo z CDN; příslušná licenční oznámení se musí zachovat. StackEdit samotný je Apache-2.0, jeho zdrojový kód zatím není součástí aplikace. Podrobnosti o rendererech v `docs/RENDERERY.md`, stav vývoje v `docs/STAV_PROJEKTU.md`.

---

# Local StackEdit Wiki – dávka 12

**Offline prototyp pro Chrome/Edge; stále NENÍ originální fork StackEditu.** Tato verze navazuje na dávku 11. Aplikace je určena pro dvojklik na `index.html` s ručním povolením přístupu ke složce wiki. Skutečné spuštění přes `file://` na cílovém PC zatím nebylo ověřeno.

## Novinky dávky 12 – diagnostika offline balíčku

Tato dávka **nezahrnuje původní StackEdit ani skutečné knihovny Mermaid/ABCjs**. Ověřil jsem v oficiálních zdrojích použité verze a adresy distribučních souborů, ale jejich přenesení do sestavovacího prostředí se nepodařilo. Knihovny lze doplnit pomocí již přiložených skriptů `tools/download-renderers.ps1` a `.sh` na počítači s přístupem na internet. Není třeba nic instalovat; jde o jednorázové stažení JS souborů přímo do `vendor/`.

- V dialogu **Renderery** je nové tlačítko **Uložit diagnostiku JSON**. Soubor obsahuje podporu File System Access API, dostupnost vykreslovacích knihoven, typ protokolu (`file:`/`https:`) a pouze počty a stav práce s wiki; **neobsahuje obsah souborů, jejich názvy ani jejich cesty**. Je to příprava pro závěrečné hlášení bugů.
- Samostatný ověřovač `tools/verify-offline.py` používá jen Python standardní knihovnu a zkontroluje, zda se do ZIPu dostaly povinné JS/CSS soubory a lokální skripty odkazované z `index.html`. Rozlišuje chybějící Mermaid/ABCjs od hlavního jádra.
- Nové testy jsou `tests/diagnostics.test.cjs` a `tests/batch12-smoke.py`. Stav po dávce 12: **48 automatických testů a 11 prohlížečových scénářů prošlo**.
- **Dvojklik na `index.html` zůstává neověřený** na cílovém desktopu (správcovská politika zdejšího Chromium zakazuje `file://`). Testování souborového přístupu používá simulace.

---

## Novinky dávky 11 – bezpečnost během asynchronních operací

- Rychlé přepínání poznámek: opožděný výsledek starého čtení nepřepíše novější otevřený dokument.
- Pomalé ukládání: zapisuje se **snímek textu z okamžiku stisku Uložit**. Pokud mezitím dál píšeš, tvůj novější text zůstává v editoru jako neuložený.
- Během ukládání se nepovolí přejít na jiný soubor nebo spustit další diskovou operaci; při přesunu, vytváření a obnovení se editor dočasně uzamkne proti editaci.
- Opravena funkce **Načíst znovu** pro aktuální dokument a zneplatnění opožděných renderů při zavření poznámky.
- Nové testy: **46/46 automatických** a **10/10 Chromium scénářů** (File System Access API simulováno, nikoli reálný disk).

**Otevřené problémy:** Nepodařilo se přibalit skutečné knihovny Mermaid a ABCjs (síť v sestavovacím prostředí je nedostupná), originální StackEdit/`cledit` se stále nepodařilo sestavit. Knihovny lze dodatečně získat jednorázovými skripty v `tools/`, ale nejsou dosud otestované na skutečném buildu. Jde nadále o **samostatný editor CodeMirror + marked + MathJax**, ne o hotovou úpravu originálního StackEditu. Podrobnosti o nové ochraně: `docs/SOUBEZNE_OPERACE.md`.

---

## Novinky dávky 10 – integrita souborů při editaci

- **UTF-8 BOM:** při běžném otevření se nezobrazuje v editoru, ale zapisuje se zpět při uložení. Při automatickém přejmenování a aktualizaci odkazů se nadále zachovává i původní sekvence bajtů tam, kde se text nemění.
- **CRLF/LF:** běžný editor pracuje interně s LF, při uložení obnoví typ konců řádků ze zdrojového souboru (včetně kombinace s BOM).
- **Vadné UTF-8:** soubory s chybnými bajty se neotevřou k editaci a nepřevádějí se potichu na náhradní znaky `�`. Zůstávají na disku nezměněné; uživatel musí jejich kódování opravit vhodným nástrojem mimo aplikaci.
- **Kontrola externí změny:** porovnání velikosti a času bylo rozšířeno o dva obsahové kontrolní součty. Zachytí tak i běžnou změnu stejné délky se stejným časem modifikace (např. některé synchronizační nástroje). Toto **není kryptografická garance** a kontrola není atomická vůči souběžným OS změnám během zápisu.
- Nové automatické testy a prohlížečový test simulují BOM/CRLF, vadné kódování a externí přepsání souboru. **42/42 Node testů** a **9/9 prohlížečových scénářů v Chromiu** prošlo; FSA je v prohlížečových testech simulované.

Původní editor StackEditu (`cledit`) ani skutečné UMD buildy Mermaid a ABCjs se v této dávce nepodařilo přibalit. Stávající CodeMirror a MathJax zůstávají funkční. Jejich nahrazení originály by vyžadovalo další závislosti, jejichž získání a sestavení je ve zdejším prostředí blokováno. Je to otevřená část cíle, nikoli hotová funkce.

**Zásadní omezení:** práce s více soubory (zejména přesouvání s přepisem odkazů) není transakční. Používej zálohu wiki, dokud nebude dokončena závěrečná kontrola na tvém počítači. Podrobné změny a bezpečnostní hranice v `docs/UTF8_INTEGRITA.md`.

---


**Funkční offline prototyp pro Chrome/Edge, stále NENÍ fork originálního StackEditu.** Navazuje na dávku 7 a zachovává adresářový strom, přímé čtení a ukládání, CodeMirror editor a Markdown+MathJax náhled.

## Spuštění

1. Rozbal celý archiv do libovolné složky.
2. Zkus dvojklik na `index.html` v **Chrome nebo Edge**. Pro běžné použití není určen žádný backend, účet ani HTTP server.
3. Klikni na **Otevřít složku** a vyber nejdříve přiloženou `demo-wiki`; povol přístup k souborům. Původní soubory se upraví až stisknutím **Uložit** / Ctrl+S.
4. V levém panelu přepni mezi **Soubory**, **Fulltext** a **Odkazy**.

Oprávnění a načítání z `file://` stále musí být potvrzeno v reálném desktop Chrome/Edge. Zdejší sandbox tuto URL blokuje ještě před spuštěním aplikace. Vývojové testy používají simulovaný souborový systém.

## Novinky dávky 9 – robustnější vykreslování Mermaid / ABCjs

**Tato dávka nepřibaluje skutečné runtime knihovny Mermaid a ABCjs.** V prostředí používaném pro sestavení nebyl dostupný jejich oficiální distribuční balíček. V ZIPu proto zůstávají přiznané zástupné soubory, nikoli náhražka předstírající skutečné vykreslování. Pro aktivaci lze jednorázově použít skripty v `tools/` (viz `docs/RENDERERY.md`).

- Tlačítko **Renderery** zobrazuje, zda jsou Markdown, MathJax, Mermaid a ABCjs opravdu načtené. Jen přítomnost `.js` souboru nestačí.
- Adaptér vykresluje kódové bloky `mermaid` a `abc` pomocí jejich skutečných rozhraní UMD, pokud knihovny existují; jinak ponechá plný původní zdrojový kód a ukáže vysvětlení.
- V obou typech vykreslených bloků se zobrazí **Uložit SVG** pro export diagramu/notového zápisu. Nedotýká se Markdown souboru.
- SVG se před vložením zbaví skriptů, vnořeného aktivního obsahu a nebezpečných externích atributů. Některé exotické vizuální prvky mohou kvůli této filtraci ztratit vzhled.
- Zpracování asynchronních výsledků Mermaid brání vložení zastaralého SVG po přepnutí poznámky. Chybové stavy neodstraňují zdrojový blok. Stav nahoře rozlišuje rozpracované, hotové, chybějící a chybné diagramy.
- `demo-wiki/Diagramy-a-noty.md` obsahuje ukázky Mermaid flowchartu, sequence diagramu a ABC notového zápisu.

**Testy v dávce 9:** 37 automatických Node testů a 8 prohlížečových testů v Chromiu (nový `tests/batch09-smoke.py`). Nový test ověřuje stavy chybějících knihoven, diagnostiku, simulované API Mermaid/ABCjs, export, čištění SVG a asynchronní výsledky. **Nejde o ověření skutečné knihovny Mermaid/ABCjs ani přístupu k souborům přes `file://`.** Uživatelské spuštění dvojklikem ověříme na závěr vývoje.

**Cíl projektu:** ještě nejsme hotovi. Původní StackEdit/cledit ani jeho KaTeX pipeline nejsou integrovány; používáme CodeMirror, marked a MathJax. Více ve `docs/STAV_PROJEKTU.md`.

## Novinky dávky 8 – kompatibilita s Obsidian Markdownem

- **Obsidian callouty** typu `> [!note]`, `> [!tip]`, `> [!warning]` a dalších běžných typů. Podporované je i skládání `> [!warning]- Nadpis` (zavřené) a `> [!note]+ Nadpis` (otevřené). Zobrazují se jako samostatné bloky s jednoduchým barevným odlišením. Zdroj `.md` se nemění.
- **Obrázkové embeds**: `![[schema.png]]`, `![[obrazky/schema.png|300]]`. Aplikace rozpozná běžné lokální formáty PNG, JPG, GIF, WebP, BMP a AVIF; zkouší cestu vedle dokumentu, od kořene a nakonec jednoznačný název. Při dvou stejně pojmenovaných obrázcích v různých složkách nebude nejednoznačný basename hádat. Volitelnou šířku 32–1600 px přizpůsobí dostupnému prostoru.
- **YAML frontmatter** na začátku poznámky (`---` ... `---`) se v náhledu objeví jako rozbalovací panel „Vlastnosti poznámky (YAML)“. Zobrazuje se **doslovný text metadat**, neparsuje ani nemění YAML hodnoty. Editor zachovává celý původní zdroj.
- Speciální syntaxe se neexpanduje uvnitř běžných fenced a inline kódových bloků. Zpracování nebezpečného HTML stále prochází sanitizací.
- Nová ukázková poznámka `demo-wiki/Obsidian-formaty.md` dovoluje rychlé ověření všech tří funkcí.

**Co dávka 8 nedělá:** neprovádí vložení jiné celé `.md` poznámky jako transkluzi `![[Poznámka]]`, nemění soubory při renderování, nepodporuje SVG obrázky, nepřidává parser celé YAML specifikace ani všechny nestandardní Obsidian pluginy. Výstup některých Markdown konstrukcí se může lišit od Obsidianu.

**Testy:** `node --test tests/*.test.cjs` = **37/37**, a 7/7 prohlížečových testovacích scénářů v Chromiu, včetně nového `python tests/batch08-smoke.py`. Stejně jako v minulých dávkách je FS API v prohlížečových testech simulované; přímé otevření přes `file://` testovací prostředí blokuje (`ERR_BLOCKED_BY_ADMINISTRATOR`).

**Stav plánu:** stále jde o lehkou **samostatnou aplikaci**, ne o upravený StackEdit. Zachovává CodeMirror 5, marked a MathJax 2; originální StackEdit/cledit integrován není. Mermaid a ABCjs jsou nadále volitelné a do ZIPu zatím nejsou přibalené jejich runtime knihovny. Dávka 8 nemění požadavek na offline spuštění dvojklikem a oprávnění k otevřené složce.

## Novinky dávky 7 – oprava odkazů při přesunu

Při použití **Přejmenovat / přesunout** aplikace nejprve přečte snapshot všech dostupných Markdown dokumentů v povoleném kořeni wiki (bez odesílání dat). Před změnou zobrazí plán: počet nalezených odkazů k přepsání, počet dotčených souborů a ukázku jejich názvů. **Teprve po potvrzení** začne měnit soubory.

- Upravuje **příchozí odkazy** na přesouvanou poznámku i **odchozí relativní odkazy uvnitř přesouvané poznámky**. Pokud odkaz po přesunu stále funguje, ponechá jeho zápis beze změny.
- Podporuje běžné Markdown odkazy `[text](poznamka.md#kotva)`, jejich volitelné titulky, jednoduché reference `[id]: poznamka.md`, Obsidian odkazy `[[Poznamka]]`, `[[Slozka/Poznamka#Nadpis|Popisek]]`. Zachovává kotvy a aliasy.
- Needituje odkazy **uvnitř Markdown code fences a inline code**, externí odkazy ani obrázky. Vyhledává jen odkazy na `.md` / `.markdown` soubory, které dokáže **jednoznačně** propojit s konkrétní existující poznámkou.
- U upravených textů zachovává původní **CRLF/LF, případnou UTF-8 BOM**, a ostatní text mimo nahrazovaný odkaz. Pro plán čte UTF-8 striktně: neplatné bajty přeruší operaci dříve, než dojde ke změně souborů.
- Před samotným přesunem znovu ověří všechny původní soubory proti snapshotu; před každým zápisem ověřuje změny na disku. Pokud některý zápis selže, **pokusí se** upravené soubory a přesun vrátit. Pokud automatické obnovení není možné (např. souběžná externí editace, nedostatečná oprávnění), oznámí problém a nepřepisuje novější obsah.

### Důležitá omezení a bezpečnost

- **Nejde o atomickou transakci přes více souborů.** Pokud například systém spadne během změn, opravy mohou zůstat částečně dokončené. **Před přesouváním v reálné wiki vytvoř zálohu**; pro první pokus použij `demo-wiki`.
- Automatika **nepokrývá** složité Markdown reference, dynamické odkazy, Obsidian embeds na obrázky, YAML frontmatter, relativní odkazy v HTML či cesty uvnitř neobvyklých syntaktických konstrukcí. Nejednoznačné `[[wiki]]` odkazy neodhaduje. Po přejmenování u velmi složité wiki doporučujeme vyhledat starý název v **Fulltextu**.
- Záměrně **nepřepisuje** odkaz, který funguje bez úpravy (např. `[[Python]]`, je-li název i po přesunu jednoznačný).
- Přejmenování cílové složky ani hromadné přesuny celých adresářů zatím nejsou podporovány.
- Pouze **Chrome / Edge**. Skutečný přístup přes `file://` nadále musíš potvrdit na svém desktopu.

### Rychlý pokus v `demo-wiki`

1. Otevři `demo-wiki` pro **čtení + zápis** a v levém stromu otevři `Programovani/Python.md`.
2. Přes `Přejmenovat / přesunout` zadej `Programovani/PythonNova.md`.
3. Potvrzovací dialog ukáže odkazy v `index.md`, které se mají upravit. Po dokončení otevři `index.md` a ověř, že Markdown odkaz i Obsidian odkaz zůstávají funkční.
4. Ověř změny přímo na disku v souborech `demo-wiki/index.md` a `demo-wiki/Programovani/PythonNova.md`.

**Testy:** `node --test tests/*.test.cjs` = **32/32**; testy `tests/link-migration-disk.test.cjs` pokrývají úspěšný zápis, externí změny i rollback; `python tests/batch07-smoke.py` = úspěšný prohlížečový test aktualizace odkazů. Historické testy `ui-smoke.py`, `editor-smoke.py`, `batch04-smoke.py`, `batch05-smoke.py`, `batch06-smoke.py` také prošly. Všechny prohlížečové scénáře používají simulovaný File System Access API, nikoli skutečné oprávnění `file://`.

**StackEdit stav:** Aplikace stále používá **CodeMirror 5 + marked + MathJax 2**, nikoli originální StackEdit/`cledit`. Mermaid a ABCjs lze zapojit volitelně, samotné oficiální distribuční knihovny zde nejsou přibalené. Cílem zůstává kompatibilita a offline běh; sestavení skutečného forku zatím nebylo dokončeno.

## Novinky dávky 6 – přesun a přejmenování souboru

- Po otevření zapisovatelné wiki a `.md` dokumentu se aktivuje tlačítko **Přejmenovat / přesunout** nad editorem.
- Zadej novou **relativní cestu** vzhledem ke kořeni wiki, například `Poznamky/JineJmeno.md` nebo `Programovani/JineJmeno.md`. Cílová složka musí existovat.
- **Historicky v dávce 6** se pouze varovalo, že odkazy v jiných dokumentech se nemění. **Od dávky 7** se jednoznačně rozpoznané odkazy po potvrzení opravují; podrobnosti a omezení jsou výše.
- Přesun nejprve kopíruje a kontroluje **původní bajty souboru** (včetně UTF-8 BOM a CRLF), teprve po jejich ověření odstraní původní cestu. Kontroluje také kolize názvů, neplatné či rezervované cesty, chybějící cílovou složku a externí změnu zdroje. Neuložený text v editoru blokuje přesun, dokud jej neuložíš nebo nezahodíš.
- **Není to atomická transakce.** Při chybě odstranění zdroje nebo jeho souběžné změně mohou zůstat dvě kopie, aby se předešlo ztrátě dat. Po neúspěchu vždy zkontroluj stav složky. Souběžné vytvoření stejného cílového souboru jinou aplikací v okamžiku přesunu není pomocí dostupného API dokonale vyloučeno; pro první pokusy používej výhradně záložní/testovací wiki.
- Přejmenování či přesun **adresářů** zatím není podporováno. Oprava podporovaných relativních a Obsidian odkazů přibyla v dávce 7 (viz výše).

**Testy:** `node --test tests/*.test.cjs` = 22/22; `python tests/batch06-smoke.py` = nový prohlížečový scénář přesunu aktivního souboru. Testy používají simulované File System Access API, nikoli skutečné oprávnění z `file://`.

**Stav originálního StackEditu:** stále se ho nepodařilo sestavit ani integrovat. Podrobný průzkum osmi editorových modulů, závislostí a překážek je v `docs/ORIGINAL_STACKEDIT_EDITOR.md`. Plný fork dosud nevznikl. Zachován CodeMirror 5 + MathJax 2, Mermaid/ABCjs stále jen volitelné knihovny (nepřibalené).

## Novinky dávky 5 – skutečné vytváření souborů a složek

- V panelu **Soubory** jsou dvě tlačítka: **+ Poznámka** a **+ Složka**. Fungují jen v režimu **Čtení + zápis**, tedy po schválení `showDirectoryPicker()` v Chromu/Edge.
- Při vytváření se zobrazí dialog pro zadání **relativní cesty od kořene wiki**. Výchozí umístění odpovídá složce právě otevřené poznámky; lze zadat např. `Programovani/Nová.md` (nadřazená složka musí existovat). Pokud chybí přípona poznámky, přidá se `.md`.
- Nová poznámka se okamžitě objeví ve stromu a otevře se v editoru, ale zapisuje se na disk *až* při vytvoření (zatím jako prázdný soubor) a následně po stisknutí **Uložit**. Novou poznámku lze vyvolat také **Ctrl+N**.
- Existující soubory/složky se nevymažou ani nepřepíší. Jsou odmítnuty absolutní cesty, `..`, názvy typu `.obsidian`, neplatné přípony, rezervovaná jména Windows a přímé vytváření mimo kořen wiki. Vytváření složek samo o sobě nezahazuje neuložený text aktuální poznámky.
- Po změně stromu se fulltextový index v RAM zneplatní a při dalším hledání obnoví.

**Omezení:** V této dávce zatím není přejmenování, mazání ani přesun existujících souborů. Současné rozhraní prohlížeče nemá transakční operaci „vytvoř výhradně, pokud neexistuje“; aplikace kontroluje existenci bezprostředně před vytvořením, souběžné změny z jiné aplikace ale nejsou stoprocentně eliminovány.

**Důležité o StackEditu:** Původní StackEdit stále **nebyl přebudován ani integrován**. Jeho editor cledit vyžaduje balíčky `diff-match-patch`, `turndown` a interní moduly, které nejsou v tomto offline projektu k dispozici; pokus o záměnu jedné JS komponenty by byl nefunkční. Tato dávka proto rozšířila lokální souborovou vrstvu, kterou lze později napojit na originální editor. Aktuálně běží CodeMirror, marked a MathJax. Mermaid a ABCjs jsou nadále volitelné externí runtime soubory, v základním ZIPu nejsou.

## Testy dávky 5

- `node --test tests/*.test.cjs`: nově zahrnuje testy vytváření souborů/složek, kolize názvů a útoky přes cesty.
- `python tests/batch05-smoke.py`: prohlížečový scénář vytvořit složku → vytvořit `.md` → upravit → uložit. Prohlížečový test používá napodobený File System Access API; test skutečného otevření přes `file://` není v sandboxu povolen.

## Původní novinky dávky 4

- **Fulltext přes celou wiki**: načítá všechny autorizované `.md` a `.markdown` soubory na vyžádání; hledání ignoruje rozdíl velkých/malých písmen a českou diakritiku. Výsledek zobrazuje relativní cestu a číslo řádku; kliknutí přejde na řádek v editoru. Limit 100 výsledků, max. 3 na soubor. Index se vytváří pouze v paměti RAM; po obnovení adresářového stromu se zahodí.
- **Obsah aktuálního dokumentu (TOC)**: klikací nadpisy H1–H6 z vykresleného Markdownu.
- **Zpětné odkazy**: po načtení indexu detekuje `[[wiki odkazy]]` a běžné `[text](soubor.md)` odkazy v jiných souborech. Pokouší se rozlišovat relativní cesty a nejednoznačné názvy. Složitější Obsidian odkazy ještě nejsou podporované.
- **Volitelné offline renderery Mermaid + ABCjs**: adapter už umí předat kód skutečným knihovnám a vložit SVG do náhledu, ale knihovny **nejsou přibaleny**. Jednorázové doplnění popisuje `docs/RENDERERY.md`, součástí archivu jsou pomocné skripty. Při jejich absenci zůstávají zdrojové bloky viditelné.
- Starší funkce: podpora relativních odkazů, lokální obrázky, základní Obsidian odkazy, MathJax 2, CodeMirror 5, formátovací lišta, zachování LF/CRLF, Ctrl+S, ochrana před přepsáním změněného souboru.

## Co stále zbývá

- **Originální StackEdit editor/cledit a jeho renderer** – vzhledem k zastaralým build závislostem a nemožnosti instalovat původní npm balíčky zde nebyl integrován. Současný editor používá CodeMirror.
- Skutečné otestování dodaných JS buildů Mermaid a ABCjs; kontrola plné kompatibility všech diagramových a hudebních zápisů.
- Přímá podpora Obsidian embeds, hromadného přejmenování složek, složitějších syntaxí odkazů, lepší práce s obrázky a výkon pro velmi rozsáhlé wiki.
- Skutečný experiment s přístupem k lokální složce při dvojkliku v cílovém desktopovém prohlížeči.

Nejdřív testuj **demo-wiki**. V případě používání vlastní wiki si zachovej zálohu. Aplikace nikdy nevkládá nové indexy do kořene wiki: fulltext je pouze v RAM a nic neodesílá na internet.

## Testy (volitelné)

```bash
node --test tests/*.test.cjs
python tests/ui-smoke.py
python tests/editor-smoke.py
python tests/batch04-smoke.py
```

Tyto příkazy jsou určeny pouze pro vývoj; uživatel pro spuštění aplikace nic instalovat nemusí. Prohlížečové testy využívají simulované adresáře, nikoliv skutečný přístup k disku.

## Původ a licence

- `CodeMirror 5` – MIT, přibalen s licencí.
- `marked` – MIT, přibalen s licencí.
- `MathJax 2` – Apache-2.0, přibalen s licencí.
- `Mermaid` – MIT, a `ABCjs` – MIT; **ve výchozím balíčku jsou pouze placeholdery**, viz `docs/RENDERERY.md`.
- `StackEdit` – Apache-2.0, analyzovaný upstream https://github.com/benweet/stackedit ; **jeho zdrojový kód v tomto archivu není**. Další analýza v `docs/INTEGRACE_STACKEDIT.md`.
