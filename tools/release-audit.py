#!/usr/bin/env python3
"""Validate the ZIP layout and offline readiness; standard library + optional Node.
Without --require-renderers this validates a development snapshot. With it, a
release fails unless real Mermaid/ABCjs bundles are present (size checks alone
cannot prove their behavior or authenticity).
"""
from html.parser import HTMLParser
import hashlib
import base64
import json
from pathlib import Path
import argparse
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent

class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.references = []
    def handle_starttag(self, tag, attrs):
        data = dict(attrs)
        if tag == 'script' and 'src' in data:
            self.references.append(('script', data['src']))
        elif tag == 'link' and data.get('rel') == 'stylesheet' and 'href' in data:
            self.references.append(('stylesheet', data['href']))


def audit(strict=False):
    messages = []
    problems = []
    entry = ROOT / 'index.html'
    companion = ROOT / 'tools/test-file-access.html'
    if not entry.is_file():
        return ['Chybí index.html'], [], 1
    parsed = Assets()
    parsed.feed(entry.read_text(encoding='utf-8'))
    if not companion.is_file():
        problems.append('Chybí samostatný test přístupu k souborům.')
    elif any(x in companion.read_text(encoding='utf-8') for x in
             ['<script src=', '<link rel="stylesheet" href="https://']):
        problems.append('Samostatný test není plně samostatný.')
    for kind, rel in parsed.references:
        if rel.startswith(('http://', 'https://', '//')):
            problems.append(f'{kind}: za běhu se stahuje vzdálený soubor {rel}')
        elif not (ROOT / rel).is_file():
            problems.append(f'{kind}: chybí lokální soubor {rel}')
    messages.append(f'Lokální skripty a CSS v index.html: {len(parsed.references)}')
    for label, rel, min_size in (
        ('Mermaid', 'vendor/mermaid/mermaid.min.js', 100000),
        ('ABCjs', 'vendor/abcjs/abcjs-basic-min.js', 50000),
    ):
        available = (ROOT / rel).is_file() and (ROOT / rel).stat().st_size >= min_size
        messages.append(f'{label}: {"přítomno – vyžaduje funkční test" if available else "chybí skutečná knihovna"}')
        if strict and not available:
            problems.append(f'{label}: finální offline vydání vyžaduje skutečnou knihovnu.')
    if strict:
        provenance = ROOT / 'tools/renderer-provenance.json'
        if not provenance.is_file():
            problems.append('Chybí ověřitelný manifest provenience rendererů z release builderu.')
        else:
            try:
                record = json.loads(provenance.read_text(encoding='utf-8'))
                if record.get('type') != 'verified-upstream-npm':
                    raise ValueError('neznámý typ sestavení')
                for library, version, filepath in (
                    ('mermaid', '8.9.2', 'vendor/mermaid/mermaid.min.js'),
                    ('abcjs', '6.4.4', 'vendor/abcjs/abcjs-basic-min.js'),
                ):
                    item = record['renderers'][library]
                    if item.get('version') != version or item.get('path') != filepath:
                        raise ValueError(f'{library}: nesouhlasí verze nebo cesta')
                    digest = base64.b64encode(hashlib.sha512((ROOT / filepath).read_bytes()).digest()).decode('ascii')
                    if digest != item.get('sha512'):
                        raise ValueError(f'{library}: SHA-512 distribučního souboru neodpovídá manifestu')
                    if not item.get('npm_tarball_integrity', '').startswith('sha512-'):
                        raise ValueError(f'{library}: chybí informace o npm integritě')
                    if library == 'mermaid' and digest != '6Wa+B9B3RYe0RtUPHHpg6RTnDBMLUq1hdoJtNJfkfNOaipetnb30xQPd1nTQDBMF0dt7lOb3XmAq62Dqqr57Zw==':
                        raise ValueError('Mermaid: nesouhlasí nezávislý cdnjs/SRIs SHA-512')
                messages.append('Renderery: manifest a SHA-512 ověřeny (Mermaid též vůči cdnjs/SRIs)')
            except (OSError, ValueError, KeyError, TypeError) as error:
                problems.append('Nedůvěryhodný manifest offline rendererů: ' + str(error))
    scripts = sorted((ROOT / 'src').glob('*.js'))
    node_check = 0
    for script in scripts:
        try:
            result = subprocess.run(['node', '--check', str(script)], capture_output=True, text=True, timeout=8)
        except FileNotFoundError:
            messages.append('Node.js nenalezen: kontrola syntaxe byla přeskočena.')
            break
        except subprocess.TimeoutExpired:
            problems.append(f'Časový limit kontroly syntaxe: {script.name}')
            continue
        node_check += 1
        if result.returncode:
            problems.append(f'Chyba syntaxe: {script.name}: {result.stderr[:200]}')
    messages.append(f'Kontrola syntaxe lokálních modulů: {node_check}/{len(scripts)}')
    return problems, messages, int(bool(problems))

if __name__ == '__main__':
    args = argparse.ArgumentParser()
    args.add_argument('--require-renderers', action='store_true', help='Přísný režim pro finální vydání')
    strict = args.parse_args().require_renderers
    failures, details, code = audit(strict)
    print('Local StackEdit Wiki – audit', 'finálního vydání' if strict else 'vývojové verze')
    for message in details: print(' -', message)
    for issue in failures: print('CHYBA:', issue)
    print('Závěr:', 'OK – požadované kontroly prošly' if not failures else f'NENÍ PŘIPRAVENO ({len(failures)} problémů)')
    if not strict:
        print('Pozn.: Tento test nedokazuje funkčnost file:// ani vykreslení reálným Mermaid/ABCjs.')
    sys.exit(code)
