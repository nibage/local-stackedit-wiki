---
title: Ukázka kompatibility s Obsidianem
tags: [wiki, test, obrazky]
aliases:
  - Obsidian formáty
---
# Obsidian: poznámky, obrázky a metadata

Tento dokument ukazuje nové funkce **dávky 8**. YAML metadata zůstávají v původním `.md` souboru a v náhledu se zobrazí po rozbalení panelu.

> [!NOTE] Lokální Markdown wiki
> V tomto náhledu se vykreslují **Obsidian callouty** a [běžné odkazy](Programovani/Python.md).

> [!TIP] Praktický tip
> Pro přímou práci se soubory otevři kořen `demo-wiki` v Edge nebo Chromu.

> [!WARNING]- Sbalené upozornění
> Sbalený obsah uvidíš až po kliknutí na nadpis.

## Obrázek přes Obsidian embed

![[schema.png|300]]

Obrázek `schema.png` je ve skutečnosti uložený v adresáři `obrazky/`. Aplikace ho dohledá podle jednoznačného názvu a načte lokálně.

Alternativně lze uvést cestu od kořene wiki:

![[obrazky/schema.png|180]]

## Co se nezpracovává jako speciální syntaxe

Inline kód `![[schema.png]]` ani blok kódu:

```md
![[schema.png]]
> [!TIP] Toto je pouze kód
```

Vložený obsah jiné poznámky, například `![[Python.md]]`, zatím není implementován jako transkluze. Také se zatím nevykreslují SVG obrázky — záměrně kvůli bezpečnosti.
