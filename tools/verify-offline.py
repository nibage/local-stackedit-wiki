#!/usr/bin/env python3
"""Offline release verifier, standard library only. Does not access the network."""
from pathlib import Path
import sys
import re

ROOT = Path(__file__).resolve().parent.parent
HTML = (ROOT / 'index.html').read_text(encoding='utf-8')
REQUIRED = [
    'assets/app.css',
    'vendor/MathJax/MathJax.js',
    'vendor/marked/marked.js',
    'vendor/codemirror/lib/codemirror.js',
    'src/diagram-adapter.js',
    'src/renderer-selftest.js',
    'src/diagnostics.js',
    'src/recent-wiki.js',
    'src/renderer-installer.js',
    'src/operation-guard.js',
    'src/navigation.js',
    'src/wiki-index.js',
    'src/editor-adapter.js',
    'src/file-system.js',
    'src/renderer.js',
    'src/link-migration.js',
    'src/main.js',
]
OPTIONAL = {
    'Mermaid': ('vendor/mermaid/mermaid.min.js', 100000),
    'ABCjs': ('vendor/abcjs/abcjs-basic-min.js', 50000),
}

def verify():
    errors = []
    for rel in REQUIRED:
        target = ROOT / rel
        if not target.is_file() or target.stat().st_size < 100:
            errors.append('CHYBI povinny soubor: ' + rel)
    linked = re.findall(r'(?:src|href)=["\']([^"\']+)["\']', HTML)
    for rel in linked:
        if rel.startswith(('https://', 'http://', '//')):
            errors.append('Vnejsi skript nebo CSS: ' + rel)
        elif rel.startswith(('vendor/', 'src/', 'assets/')) and not (ROOT / rel).is_file():
            errors.append('Chybejici odkazovany soubor: ' + rel)
    optional = {}
    for label, (rel, minsize) in OPTIONAL.items():
        f = ROOT / rel
        exists = f.is_file() and f.stat().st_size >= minsize
        optional[label] = exists
        print(f'{label}: {"DISTRIBUCNI SOUBOR PRITOMEN (nutno otestovat API)" if exists else "NENI PRIBALENA SKUTECNA KNIHOVNA"}')
    print('Kontrola struktury:', 'OK' if not errors else 'CHYBY')
    for err in errors: print(' -', err)
    print('Kontrola Mermaid/ABCjs podle delky souboru sama o sobe nepotvrzuje funkcnost.')
    return 1 if errors else 0

if __name__ == '__main__': sys.exit(verify())
