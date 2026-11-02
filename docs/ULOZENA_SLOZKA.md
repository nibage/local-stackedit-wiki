# Dávka 14: volitelná poslední wiki

Po zaškrtnutí **Zapamatovat složku** a kliknutí na **Otevřít složku** se do IndexedDB v daném prohlížeči uloží pouze `FileSystemDirectoryHandle` vybrané wiki. **Neukládají se texty poznámek ani celý souborový strom.** Po opětovném otevření `index.html` tlačítko **Poslední wiki** provede kontrolu oprávnění; pokud je třeba, Chrome nebo Edge může znovu požadovat povolení. Bez tohoto povolení aplikace složku neotevře.

Tlačítko **Zapomenout** odstraní uložený odkaz ze stránky (IndexedDB). Neodstraňuje wiki, nenahrazuje správu oprávnění prohlížeče a nepřesouvá žádné soubory. Zaškrtávací pole je záměrně ve výchozím stavu vypnuté.

## Omezení

- Některé kombinace prohlížeče, nastavení a `file://` mohou ukládání nebo přístup k adresářovému handle blokovat. V takovém případě je nadále k dispozici běžný výběr složky.
- Zapamatovaný handle je vázaný na **origin** a profil prohlížeče. Přesun aplikace do jiné cesty, otevření v jiném profilu nebo smazání úložiště může výběr zneplatnit.
- Nejde o automatické udělení oprávnění. `requestPermission()` se vyvolává jen po kliknutí uživatele.
- Nezměnilo se ukládání nebo vykreslování souborů wiki.
- Testy ověřují chování přes Chromium na HTTP a simulovaný File System Access handle. Skutečné `file://` nebylo možné otestovat kvůli blokaci testovacího prostředí.
