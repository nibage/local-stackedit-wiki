# Dávka 23 – sestavení kompletního ZIPu ze stažených npm archivů

Tento postup je **volitelnou záložní cestou**. Kdo může použít GitHub Actions, může jednoduše spustit `.github/workflows/offline-release.yml`. Pro samotné prohlížení wiki se Python ani npm neinstalují.

## Příprava souborů

Ve složce `npm-cache/` připrav právě čtyři soubory získané z oficiálního npm registru:

| Soubor | Oficiální URL |
|---|---|
| `mermaid-8.9.2.json` | https://registry.npmjs.org/mermaid/8.9.2 |
| `mermaid-8.9.2.tgz` | https://registry.npmjs.org/mermaid/-/mermaid-8.9.2.tgz |
| `abcjs-6.4.4.json` | https://registry.npmjs.org/abcjs/6.4.4 |
| `abcjs-6.4.4.tgz` | https://registry.npmjs.org/abcjs/-/abcjs-6.4.4.tgz |

Metadata JSON obsahují `dist.integrity`; archivy musí odpovídat jejich hodnotě SHA-512. Archiv nesmí být upraven ani přejmenován uvnitř.

## Sestavení

V terminálu se standardním Pythonem 3.10+ ve složce projektu spusť:

```bash
python tools/build-offline-release.py --cache-dir npm-cache --output local-stackedit-wiki-offline.zip
```

V tomto režimu skript vůbec nekontaktuje síť. Nejdřív ověří **oba** npm tarbally, jejich deklarované verze, licence, API a u Mermaid nezávislý SHA-512. Potom vytvoří kompletní ZIP, který musí projít přísným auditem. Pokud něco chybí nebo nesouhlasí, žádný částečný ZIP nevznikne.

Dokud nejsou k dispozici **skutečné** archivy, nelze považovat kompletní vydání za ověřené. Po sestavení použij v prostředí s Playwright/Chromium:

```bash
python tests/real-renderers-release-smoke.py --zip local-stackedit-wiki-offline.zip
```

Test má ověřit reálné Mermaid i ABCjs SVG, nikoli simulace; spuštění přes `file://` na cílovém počítači tím však není prokázáno.

## Stav

Dávka 23 **není hotový offline release**. Obsahuje nový nástroj a testy. Samotný prohlížeč wiki nepotřebuje npm ani Python. Pokud je možné při první instalaci použít internet, může uživatel alternativně využít stávající tlačítko **Renderery → Doplnit offline renderery**.
