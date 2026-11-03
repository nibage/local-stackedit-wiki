# Local StackEdit Wiki – RC2 (3. 11. 2026)

## Jak vyzkoušet

1. Rozbal **celý** ZIP do nové složky; nezaměňuj za vývojový klon GitHubu, kde mohou být původní placeholdery.
2. Dvojklikem otevři `index.html` v Chromu / Edge.
3. Vyber testovací wiki tlačítkem **Otevřít složku**, checkboxem **Jen pro čtení** lze vyžádat pouze oprávnění ke čtení.
4. Otevři `demo-wiki/Diagramy/UML.md`, `demo-wiki/Diagramy/Noty.md` a `demo-wiki/Programovani/Python.md`. V náhledu musejí být Mermaid SVG, notová osnova a obarvená syntaxe Pythonu.
5. V testovací wiki lze kliknout na malé `×` vedle souboru/složky a potvrdit odstranění. **Nemazej dosud skutečné soubory z osobní wiki.**
6. Tlačítko **Obnovit** obnoví strom a případně také aktivní soubor. Neuložené změny vyžadují potvrzení.

## Bezpečnost mazání

- Mazání je dostupné pouze při oprávnění k zápisu; neumožňuje smazat kořen wiki.
- Pro složky zahrnuje **všechny** soubory, tedy i soubory jiných typů než Markdown, a zobrazuje jejich počet.
- Mazání složek s obsahem vyžaduje dvě potvrzení. Nelze obnovit v rámci aplikace. Nejdřív zálohuj nebo verzuj wiki.
- Mazání odmítne složky obsahující chráněné adresáře typu `.git` a `.obsidian`, velmi rozsáhlé stromy a stromy změněné mezi potvrzením a odstraněním.
- Nejde o atomickou operaci ani plnohodnotný koš; před použitím na ostré wiki doporučujeme ještě ručně ověřit chování.

## Opravili jsme

- Přibalené plné distribuce Mermaid a ABCjs. Tlačítko Renderery je automaticky skryté, pokud jsou skutečně načtené.
- Offline Prism syntax highlighting pro Python, JavaScript, CSS, JSON a Bash v Markdown náhledu.
- Sjednocené tlačítko Obnovit a režim Jen pro čtení jako checkbox před výběrem složky.
- Automatické zapamatování poslední složky v prohlížeči (kde IndexedDB a oprávnění dovolí) bez čtyř samostatných ovládacích prvků.
- Mazání jednotlivých souborů a složek po potvrzení.

## Automatické ověření

- `node --test tests/*.test.cjs` – 90/90.
- `python tools/release-audit.py --require-renderers` – prošlo.
- `python tests/real-renderers-release-smoke.py --root . --chromium /usr/bin/chromium` – skutečné Mermaid/ABCjs a Markdown náhled fungují bez internetu.
- `python tests/rc2-ui-smoke.py` – obarvený Python, read-only, mazání, Obnovit.
- `python tests/ui-feedback-smoke.py` – fulltext, témata, resizing, zakládání podsložek.

**Použití přes file://** v této dávce znovu neověřeno na cílovém počítači. V předchozí verzi je uživatel úspěšně ověřil; nová kombinace funkcí potřebuje opět manuální test.
