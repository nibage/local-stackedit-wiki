# Diagramy a notový zápis

Tato stránka slouží k ověření **lokálních** rendererů Mermaid a ABCjs. Pokud knihovny ještě nejsou doplněny, uvidíš jejich kód a upozornění.

## Mermaid – procesní diagram

```mermaid
flowchart LR
  A[Poznámka] --> B{Otevřít?}
  B -->|Ano| C[Editor]
  B -->|Ne| D[Konec]
```

## Mermaid – sekvenční diagram

```mermaid
sequenceDiagram
  participant U as Uživatel
  participant W as Wiki
  U->>W: Otevři poznámku
  W-->>U: Markdown + náhled
```

## ABCjs – notový zápis

```abc
X:1
T:Ukázková stupnice
M:4/4
L:1/4
K:C
C D E F | G A B c |
```

Po načtení obou knihoven lze vykreslený diagram nebo noty uložit jako SVG tlačítkem pod náhledem.
