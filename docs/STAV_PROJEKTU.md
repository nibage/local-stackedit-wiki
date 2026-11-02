# Stav projektu – dávka 13

- **Nově:** jednorázový instalační dialog pro volitelné oficiální Mermaid 8.9.2 a ABCjs 6.4.4. Prohlížeč si vyžádá zápis do vybrané *složky aplikace*, před zapisováním obě knihovny stáhne a po zápisu ověří bajtovou shodu. Za běžného provozu běží aplikace bez internetu. Reálné knihovny stále nejsou přibalené v ZIPu.
- **Neověřeno:** skutečný obsah distribucí (kvůli blokované síti v sestavovacím prostředí), chování oprávnění při `file://` na cílovém PC a kompatibilita se všemi uživatelskými diagramy/notovými zápisy.
- **Nesplněná část původního záměru:** skutečný StackEdit editor `cledit` se v této meziverzi zatím nepoužívá; editor je CodeMirror 5. To není vhodné zaměňovat s hotovým forkem.
- **Hotová infrastruktura:** strom složek, přímé čtení/ukládání, ochrana externích změn, fulltext, backlinks, základ Obsidian syntaxe, matematika, správa souborů a poznámek.

**Cílem zůstává použitelné offline řešení bez backendu; finální test na Windows v Edge/Chrome musí potvrdit `file://` a integritu zápisů.**

---

# Stav projektu po dávce 12

## Hotové a automaticky otestované

- Nová offline diagnostika exportuje technické JSON bez názvů, cest a obsahu poznámek; `tools/verify-offline.py` ověřuje kompletnost balíčku. Celkem 48 automatických testů + 11 prohlížečových scénářů (přístup k disku simulován).

- Nově řízené souběžné operace: stará načtení nemohou přepsat novou poznámku; zápis pracuje s pevnou verzí textu; další úpravy zůstávají viditelně neuložené. Regrese 46 Node testů + 10 scénářů Chromium.

- Přímé editování je nově přísně UTF-8 (bez náhrady poškozených bajtů), zachovává BOM a CRLF/LF a detekuje běžné externí změny obsahu i při nezměněné velikosti/času souboru.

- Samostatný HTML/JS prototyp, lokální strom, načítání a ukládání `.md`, vytváření souborů a složek.
- Editor CodeMirror, živý Markdown náhled marked, MathJax matematika (SVG offline).
- Základní `[[wiki]]` odkazy, Obsidian embeds obrázků, YAML frontmatter, callouty, fulltext, TOC a backlinks.
- Přejmenování/přesun souboru a konzervativní aktualizace jednoznačně rozpoznaných odkazů, s upozorněním na neatomické zápisy.
- Offline integrační adaptér pro Mermaid/ABCjs, diagnostika připravenosti, export sanitizovaného SVG, zachování textového zdroje při chybě.

## Nedokončené a neověřené

- **Původní StackEdit/cledit** není přibalen ani zapojen; stále nejde o fork StackEditu.
- **Skutečné distribuční knihovny Mermaid 8.9.2 a ABCjs 6.4.4** nejsou přibalené. Lze je jednorázově stáhnout skripty v `tools/`, ale skutečná integrace dosud nebyla otestována.
- Přímé otevření pomocí dvojkliku na `file://` nebylo v testovacím prostředí možné ověřit; přístup k FS API byl simulovaný.
- Ne všechny Obsidian syntaxe a formáty, transkluze poznámek, přesouvání celých složek, plně atomické zápisy a aktualizace všech možných odkazů.
- Komplexní ruční testy na reálné wiki s tisíci soubory, různé přípony či mimořádné situace na disku.

## Před vydáním jako hotové

1. Doplnit a skutečně otestovat UMD balíčky Mermaid / ABCjs; ověřit `file://`.
2. Rozhodnout, zda integrovat a sestavit původní StackEdit (preferované původním zadáním), nebo projekt transparentně označit jako samostatný viewer/editor.
3. Otestovat správu souborů a bezpečnost při přejmenování na kopii skutečné wiki.
4. Ověřit ukládání, obrázky, matematiku, diagramy a noty na cílovém Windows/Chrome/Edge.
