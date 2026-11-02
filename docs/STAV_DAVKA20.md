# Dávka 20: automatizované sestavení plně offline ZIPu

Cíl: oddělit **vývojový snapshot** (obsahuje náhradní krátké soubory pro Mermaid/ABCjs) od **ověřeného distribučního ZIPu**. Do finálního ZIPu se dostanou přesné runtime soubory z originálních npm distribučních archivů; není potřeba je při používání aplikace stahovat ani instalovat.

## Co je nové

- `tools/build-offline-release.py`: samostatný Python 3 sestavovač bez externích pip balíčků. Přes HTTPS převezme npm metadata pro Mermaid **8.9.2** a ABCjs **6.4.4**, stáhne odpovídající npm release tarbally a porovná SHA-512 celé každé distribuce s npm `dist.integrity`. Z archivů bez jejich spuštění vybere potřebné UMD JavaScriptové soubory a upstream licence.
- Mermaid navíc kontroluje proti nezávisle zveřejněnému **cdnjs/SRIs SHA-512**. ABCjs kontroluje vůči npm tarball SHA-512, nemá zde druhý nezávislý otisk konkrétního JS souboru.
- Do kompletního balíčku se vloží `tools/renderer-provenance.json` s údaji o verzích a hashech. `tools/release-audit.py --require-renderers` nově manifest a skutečné soubory přezkoumá. Při problému se výstupní ZIP vůbec nevytvoří.
- `.github/workflows/offline-release.yml`: volitelný způsob sestavení na GitHub Actions s internetem (bez nutnosti lokálně instalovat Python/Node); projekt musí být ve vlastním GitHub repository a workflow je třeba spustit manuálně.
- `tests/offline-release-build.test.py`: testuje integritu, špatné verze, neplatný zdroj tarballu a nepřítomnost částečného ZIPu při selhání.

## Jak vytvořit plně offline ZIP ve vývojovém prostředí s internetem

```bash
python tools/build-offline-release.py --output local-stackedit-wiki-offline.zip
```

Po úspěšném vytvoření ZIP rozbalit; pro běžné používání stačí otevřít `index.html` přímo v Chrome/Edge, vybrat kořen wiki a povolit přístup. **Tento poslední krok stále vyžaduje praktické ověření na desktopu.** Sestavení nevyžaduje původní StackEdit ani jeho `cledit`.

## Důležitá hranice testů v této dávce

V izolovaném sestavovacím prostředí není DNS/HTTPS přístup k npm registru. **Nebylo zde možné spustit reálný online build nebo ověřit pravé Mermaid/ABCjs v prohlížeči.** Tento vývojový ZIP stále obsahuje jejich zástupné soubory; nejedná se o finální offline vydání. Automatické testy sestavovače používají malé lokální testovací archivy a ověřují pouze integrační logiku. Neznamená to, že reálné soubory byly staženy.

Původní editor StackEditu (`cledit`) stále není integrován; běží CodeMirror, marked a MathJax. Funkční kompatibilitu s vlastní wiki a oprávnění při `file://` bude nutné ověřit až po sestavení skutečného release ZIPu.
