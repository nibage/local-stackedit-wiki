# RC4 – změny ovládání a testování

## Strom

- `Soubory`, `Fulltext`, `Odkazy` mají v aktivním stavu zelený rámeček.
- Dvojklik na soubor `.md` otevře úpravu jména přímo ve stromu. Enter potvrdí, Escape zruší. Přesun složky se provádí odděleně od přejmenování.
- `+ Poznámka` a `+ Složka` založí zatím nezapsaný řádek v aktuálně vybrané složce; první změna na disku nastává po Enter nebo opuštění pole. Escape zruší návrh bez zápisu. Neplatné a existující názvy odmítá souborový adapter.
- Obrázky JPG, PNG, GIF, WebP, BMP a AVIF jsou vidět ve stromu. Kliknutí otevře náhled; tlačítko **Vložit do poznámky** vloží do otevřeného markdownu relativní odkaz. Zápis do původní poznámky nastane až při Uložit.
- Tlačítko **Přesunout** otevírá vlastní dialog pro cílovou cestu souboru. Samostatné přejmenování přímo ve stromu využívá stejné ověření a plán opravy odkazů.

## Motivy

- Tmavý: téměř černý základ, grafitové panely, oranžový akcent.
- Světlý: bledě šedý základ, bílé panely, cihlově červený akcent.
- Systémový motiv respektuje nastavení prohlížeče.
- CodeMirror má kompaktnější rozestupy mezi řádky; text zůstává zalamován.

## Ověření

```sh
node --test tests/*.test.cjs
python tests/offline-release-build.test.py
python tools/release-audit.py --require-renderers
python tests/rc4-ui-smoke.py --chromium /usr/bin/chromium
python tests/rc2-ui-smoke.py
python tests/rc3-layout-storage-smoke.py --chromium /usr/bin/chromium
```

Prohlížečové testy používají místní soubory a simulovaný File System Access API; skutečné oprávnění `file://` musí stále ověřit uživatel v Chrome/Edge.

## Bezpečnost

Před přejmenováním nebo přesunem s možnou úpravou dalších poznámek zobrazujeme shrnutí a vyžadujeme potvrzení. Operace v browser File System Access API nejsou atomické napříč více soubory. Mazání je trvalé a je třeba ho výslovně potvrdit. Na ostré wiki doporučujeme zálohu.
