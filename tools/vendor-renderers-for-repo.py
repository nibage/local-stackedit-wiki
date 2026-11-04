#!/usr/bin/env python3
"""Install pinned, independently verified Mermaid and ABCjs into this Git checkout.

Ordinary users then need only git pull; no npm, server or startup download.
"""
import argparse
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('offline_release_builder', ROOT / 'tools' / 'build-offline-release.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def check():
    manifest_path = ROOT / 'tools' / 'renderer-provenance.json'
    if not manifest_path.is_file():
        raise builder.BuildError('Missing renderer provenance manifest')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    for item in builder.SPECS:
        name = item['name']
        meta = manifest.get('renderers', {}).get(name, {})
        path = ROOT / item['output']
        if not path.is_file() or meta.get('version') != item['version'] or meta.get('path') != item['output']:
            raise builder.BuildError(f'{name}: missing or invalid release asset')
        digest = base64.b64encode(hashlib.sha512(path.read_bytes()).digest()).decode('ascii')
        if meta.get('sha512') != digest or (item.get('pinned_sri') and item['pinned_sri'] != 'sha512-' + digest):
            raise builder.BuildError(f'{name}: SHA-512 mismatch')
        if not any((path.parent / f).exists() for f in ('LICENSE', 'LICENSE.md', 'LICENSE.txt')):
            raise builder.BuildError(f'{name}: missing license')
        print(f'Verified {name} {item["version"]}')


def install(fetch):
    # Validate both upstream archives before writing to the working tree.
    bundles = {item['name']: builder.load_npm_bundle(item, fetch) for item in builder.SPECS}
    manifest = {'format': 1, 'type': 'verified-upstream-npm', 'renderers': {}}
    for item in builder.SPECS:
        name = item['name']
        script, licenses, npm_integrity = bundles[name]
        path = ROOT / item['output']
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(script)
        for license_name, data in licenses.items():
            (path.parent / license_name).write_bytes(data)
        manifest['renderers'][name] = {
            'version': item['version'], 'path': item['output'],
            'sha512': base64.b64encode(hashlib.sha512(script).digest()).decode('ascii'),
            'npm_tarball_integrity': npm_integrity
        }
        print(f'Bundled {name} {item["version"]}: {len(script)} bytes')
    (ROOT / 'tools' / 'renderer-provenance.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Verify bundled assets without network')
    parser.add_argument('--cache-dir', type=Path, help='Use local verified npm archives')
    args = parser.parse_args()
    try:
        if not args.check:
            fetch = builder.make_cache_fetch(args.cache_dir) if args.cache_dir else builder.get_https
            install(fetch)
        check()
    except (builder.BuildError, ValueError, OSError) as error:
        sys.exit('Renderer validation failed: ' + str(error))


if __name__ == '__main__':
    main()
