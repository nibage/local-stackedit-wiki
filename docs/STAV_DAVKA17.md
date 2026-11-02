# Dávka 17 – navigace na nadpisy

- Lokální `src/navigation.js` dekóduje cíle odkazů v `wiki:` protokolu a běžném Markdownu odlišně. Obsidian `[[Stránka#Sekce]]` se před převodem na HTML URL-enkóduje včetně `#`.
- Kliknutí na odkaz otevře cílovou poznámku a po úspěšném otevření najde nadpis přes viditelný text nebo Markdown slug, např. `#instalace-na-windows`. Stejná logika řeší `[[#Sekce]]` v aktuální poznámce.
- Nejednoznačné soubory stejného názvu nejsou otevírány automaticky podle pořadí ve stromu. Při nenalezeném nadpisu se zobrazí upozornění bez zásahu do souborů.
- Nepodporované zůstávají odkazy na Obsidian bloky `#^blockid`, přesné kotvy definované ve vlastním HTML a některé speciální tvary fragmentů.
- Ověřeno unit testy a uživatelským scénářem Chromia s mock přístupem k lokálním souborům.
- Nadále nejde o hotový fork StackEditu a Mermaid/ABCjs nejsou skutečně přibalené.
