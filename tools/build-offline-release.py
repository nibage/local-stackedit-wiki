#!/usr/bin/env python3
"""Build a complete offline ZIP from pinned upstream npm release archives.

Standard library only. Downloads are required only during packaging, never when
opening the resulting index.html. This build refuses unverified/incomplete assets.
"""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import shutil
import sys
import subprocess
import tarfile
import tempfile
from urllib.parse import urlparse
from urllib.request import Request, urlopen
import zipfile

ROOT = Path(__file__).resolve().parent.parent
MERMAID_SRI = 'sha512-6Wa+B9B3RYe0RtUPHHpg6RTnDBMLUq1hdoJtNJfkfNOaipetnb30xQPd1nTQDBMF0dt7lOb3XmAq62Dqqr57Zw=='
SPECS = (
    dict(name='mermaid', version='8.9.2', path='dist/mermaid.min.js',
         output='vendor/mermaid/mermaid.min.js', min_bytes=100000, max_bytes=12000000,
         markers=(b'mermaidAPI', b'initialize'), pinned_sri=MERMAID_SRI),
    dict(name='abcjs', version='6.4.4', path='dist/abcjs-basic-min.js',
         output='vendor/abcjs/abcjs-basic-min.js', min_bytes=50000, max_bytes=9000000,
         markers=(b'ABCJS', b'renderAbc'), pinned_sri=None),
)

class BuildError(RuntimeError):
    pass


def get_https(url, max_bytes=35_000_000):
    parts = urlparse(url)
    if parts.scheme != 'https' or parts.hostname != 'registry.npmjs.org':
        raise BuildError('Neplatný nebo nepovolený zdroj balíčku: ' + url)
    with urlopen(Request(url, headers={'User-Agent': 'local-stackedit-wiki-release-builder/1.0'}), timeout=35) as response:
        content = response.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise BuildError('Překročen limit velikosti stahovaného balíčku.')
    return content



def make_cache_fetch(cache_dir):
    """Read only four pinned npm metadata/tarball files, with NO network fallback.

    The original load_npm_bundle() still verifies npm archive integrity and
    exact versions. Files from the cache are not trusted merely because they
    have the expected name.
    """
    cache_dir = Path(cache_dir).resolve()
    if not cache_dir.is_dir():
        raise BuildError('Adresář s npm archivy neexistuje: ' + str(cache_dir))
    allowed = {}
    for spec in SPECS:
        name, version = spec['name'], spec['version']
        allowed[f'https://registry.npmjs.org/{name}/{version}'] = f'{name}-{version}.json'
        allowed[f'https://registry.npmjs.org/{name}/-/{name}-{version}.tgz'] = f'{name}-{version}.tgz'

    def fetch_cached(url, max_bytes):
        filename = allowed.get(url)
        if filename is None:
            raise BuildError('Offline cache: neočekávaná nebo nepovolená URL: ' + url)
        filename_path = cache_dir / filename
        if not filename_path.is_file() or filename_path.is_symlink():
            raise BuildError('Offline cache: chybí běžný soubor ' + filename)
        if filename_path.stat().st_size > max_bytes:
            raise BuildError('Offline cache: překročen limit velikosti ' + filename)
        content = filename_path.read_bytes()
        if len(content) > max_bytes:
            raise BuildError('Offline cache: překročen limit velikosti ' + filename)
        return content

    return fetch_cached

def load_npm_bundle(spec, fetch=get_https):
    name, version = spec['name'], spec['version']
    metadata_url = f'https://registry.npmjs.org/{name}/{version}'
    try:
        metadata = json.loads(fetch(metadata_url, 1_000_000))
    except (ValueError, UnicodeDecodeError) as exc:
        raise BuildError(f'{name}: neplatná npm metadata') from exc
    if metadata.get('name') != name or metadata.get('version') != version:
        raise BuildError(f'{name}: npm metadata neodpovídají požadované verzi.')
    dist = metadata.get('dist') or {}
    sri = dist.get('integrity', '')
    if not isinstance(sri, str) or not sri.startswith('sha512-'):
        raise BuildError(f'{name}: chybí npm SHA-512 integrity.')
    tarball_url = dist.get('tarball', '')
    parts = urlparse(tarball_url)
    if parts.scheme != 'https' or parts.hostname != 'registry.npmjs.org' or not parts.path.endswith('.tgz'):
        raise BuildError(f'{name}: neplatná adresa npm tarballu.')
    tar_data = fetch(tarball_url, 35_000_000)
    expected = sri.removeprefix('sha512-')
    actual = base64.b64encode(hashlib.sha512(tar_data).digest()).decode('ascii')
    if actual != expected:
        raise BuildError(f'{name}: SHA-512 npm archivu nesouhlasí.')
    try:
        with tarfile.open(fileobj=io.BytesIO(tar_data), mode='r:gz') as archive:
            member = archive.getmember('package/' + spec['path'])
            if not member.isfile() or not (spec['min_bytes'] <= member.size <= spec['max_bytes']):
                raise BuildError(f'{name}: podezřelá velikost distribučního JS.')
            source = archive.extractfile(member)
            if source is None:
                raise BuildError(f'{name}: v npm archivu chybí požadovaný JS.')
            script = source.read(spec['max_bytes'] + 1)
            # Include upstream licensing text in the distributable ZIP.
            licenses = {}
            for possible in ('LICENSE', 'LICENSE.md', 'LICENSE.txt'):
                try:
                    license_member = archive.getmember('package/' + possible)
                except KeyError:
                    continue
                if license_member.isfile() and license_member.size < 100_000:
                    inp = archive.extractfile(license_member)
                    if inp:
                        licenses[possible] = inp.read()
    except (tarfile.TarError, KeyError, OSError) as exc:
        raise BuildError(f'{name}: neplatný npm archiv nebo chybějící distribuční soubor.') from exc
    if not licenses:
        raise BuildError(f'{name}: v npm archivu chybí licence; sestavení ukončeno.')
    if not all(marker in script for marker in spec['markers']):
        raise BuildError(f'{name}: neobsahuje požadované rozhraní knihovny.')
    if spec['pinned_sri']:
        digest = 'sha512-' + base64.b64encode(hashlib.sha512(script).digest()).decode('ascii')
        if digest != spec['pinned_sri']:
            raise BuildError(f'{name}: SHA-512 distribučního souboru neodpovídá zveřejněnému cdnjs/SRIs otisku.')
    return script, licenses, sri


def build_release(root, destination, fetch=get_https, specs=SPECS):
    root, destination = Path(root).resolve(), Path(destination).resolve()
    if not (root / 'index.html').is_file() or not (root / 'src' / 'main.js').is_file():
        raise BuildError('Chybí správný kořen projektu.')
    # Do not create a partial artifact when downloads fail.
    blobs = {}
    for spec in specs:
        print(f'Stahuji a ověřuji {spec["name"]} {spec["version"]}…', flush=True)
        blobs[spec['name']] = load_npm_bundle(spec, fetch)
    with tempfile.TemporaryDirectory(prefix='wiki-release-') as dirname:
        stage = Path(dirname) / 'local-stackedit-wiki'
        shutil.copytree(root, stage, ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '.DS_Store'))
        manifest = {'format': 1, 'type': 'verified-upstream-npm', 'renderers': {}}
        for spec in specs:
            script, licenses, npm_integrity = blobs[spec['name']]
            output = stage / spec['output']
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(script)
            for name, license_bytes in licenses.items():
                (output.parent / name).write_bytes(license_bytes)
            manifest['renderers'][spec['name']] = {
                'version': spec['version'], 'path': spec['output'],
                'sha512': base64.b64encode(hashlib.sha512(script).digest()).decode('ascii'),
                'npm_tarball_integrity': npm_integrity,
            }
        (stage / 'tools' / 'renderer-provenance.json').write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        audit = subprocess.run(
            [sys.executable, str(stage / 'tools' / 'release-audit.py'), '--require-renderers'],
            capture_output=True, text=True, timeout=50,
        )
        if audit.returncode:
            raise BuildError('Kontrola release selhala:\n' + audit.stdout + audit.stderr)
        # Assemble archive deterministically: no symlinks, no network dependencies.
        destination.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=8) as archive:
            for file in sorted(stage.rglob('*')):
                if file.is_file():
                    archive.write(file, file.relative_to(stage.parent).as_posix())
        with zipfile.ZipFile(destination) as archive:
            bad = archive.testzip()
            if bad:
                destination.unlink(missing_ok=True)
                raise BuildError('Poškozená položka ZIP: ' + bad)
        print('Úspěšně vytvořen plně offline ZIP:', destination, flush=True)
    return destination


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Sestavit kompletní offline ZIP s ověřenými originálními renderery')
    parser.add_argument('--output', type=Path, default=ROOT.parent / 'local-stackedit-wiki-release.zip')
    parser.add_argument('--cache-dir', type=Path, help='Offline režim: použít ověřované npm .json/.tgz soubory ze složky, bez sítě')
    options = parser.parse_args()
    try:
        fetch = make_cache_fetch(options.cache_dir) if options.cache_dir is not None else get_https
        build_release(ROOT, options.output, fetch=fetch)
    except (BuildError, OSError) as exc:
        parser.exit(1, f'Sestavení se nepodařilo: {exc}\n')
