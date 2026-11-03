# RC4.1 – umístění tlačítek a vyhodnocení drag & drop

## Změny

- `Obnovit` přesunuto z horní lišty do akcí právě otevřeného dokumentu namísto `Přesunout`.
- `Přesunout` přesunuto do řádku akcí Soubory jako třetí tlačítko vedle `+ Poznámka` a `+ Složka`.
- Ponechána původní ID (`refresh`, `rename-file`) a obslužné funkce; žádná změna souborových operací.
- Při minimální šířce bočního panelu nesmí být text tlačítek oříznutý.

## Cílová cesta při přesunu

`Přesunout` dovoluje uvést jiný název a cestu uvnitř vybrané wiki. **Nadřazené složky musejí již existovat**. Pokud cílová složka neexistuje, přesun bezpečně skončí chybou. Návrh do budoucna: umožnit explicitní vytvoření chybějících složek s potvrzením; nedělat to automaticky bez souhlasu.

## Drag & drop – pouze posouzení, neimplementováno

Režim pro přesun tažením by byl užitečný zejména při organizování rozsáhlejší wiki. Doporučení: volitelný režim zapnout/vypnout, jasný vizuální stav, zvýraznění cíle a potvrzení před přemístěním. Funkce by měla využívat existující mechanismus přesunu kvůli bezpečnosti a aktualizaci Markdown odkazů; nesmí povolit přesun mimo wiki. Standardní dialog s textovou cestou má zůstat jako alternativa pro přesné umístění a přejmenování.

## Regrese

Po změně spouštěj `node --test tests/*.test.cjs`, `python tests/rc4-ui-smoke.py --chromium /usr/bin/chromium`, `python tests/rc3-layout-storage-smoke.py --chromium /usr/bin/chromium` a skutečný offline renderer test nad zabaleným ZIPem. Test RC4 ověřuje i umístění tlačítek a čitelnost názvů při šířce panelu 190 px.
