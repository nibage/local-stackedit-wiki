"""Offline tests of the signed upstream npm bundle release builder."""
import base64
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('release_builder', ROOT / 'tools/build-offline-release.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def tarball(js, version, name):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w:gz') as archive:
        for filename, data in [('package/dist/test.js', js), ('package/LICENSE', b'MIT license for test')]:
            ti = tarfile.TarInfo(filename)
            ti.size = len(data)
            archive.addfile(ti, io.BytesIO(data))
    content = stream.getvalue()
    sri = 'sha512-' + base64.b64encode(hashlib.sha512(content).digest()).decode()
    metadata = json.dumps(dict(name=name, version=version, dist=dict(integrity=sri,
        tarball=f'https://registry.npmjs.org/{name}/-/{name}-{version}.tgz'))).encode()
    return content, metadata


class OfflineReleaseTests(unittest.TestCase):
    def setUp(self):
        self.version = '1.0.0'
        self.test_js = b'// ABCJS renderAbc valid package'.ljust(512, b'x')
        self.archive, self.metadata = tarball(self.test_js, self.version, 'abcjs')
        self.myspec = dict(name='abcjs', version=self.version, path='dist/test.js',
            output='vendor/abcjs/abcjs-basic-min.js', min_bytes=100, max_bytes=1000,
            markers=(b'ABCJS', b'renderAbc'), pinned_sri=None)

    def fetch(self, url, max_bytes):
        return self.metadata if url.endswith('/abcjs/1.0.0') else self.archive

    def test_valid_npm_tarball_extracts_exact_js_and_license(self):
        js, licenses, sri = module.load_npm_bundle(self.myspec, self.fetch)
        self.assertEqual(js, self.test_js)
        self.assertEqual(licenses['LICENSE'], b'MIT license for test')
        self.assertTrue(sri.startswith('sha512-'))

    def test_tampered_tarball_rejected(self):
        def corrupted(url, length):
            return self.metadata if url.endswith('/abcjs/1.0.0') else self.archive[:-1] + b'0'
        with self.assertRaisesRegex(module.BuildError, 'SHA-512'):
            module.load_npm_bundle(self.myspec, corrupted)

    def test_wrong_version_rejected(self):
        wrong = json.loads(self.metadata)
        wrong['version'] = '1.0.1'
        with self.assertRaisesRegex(module.BuildError, 'verzi'):
            module.load_npm_bundle(self.myspec, lambda url, max_bytes: json.dumps(wrong).encode())

    def test_refuse_unpinned_mermaid_even_if_npm_archive_valid(self):
        spec = dict(self.myspec, pinned_sri='sha512-' + 'AA' * 30)
        with self.assertRaisesRegex(module.BuildError, 'cdnjs/SRIs'):
            module.load_npm_bundle(spec, self.fetch)

    def test_invalid_tarball_host_rejected_before_download(self):
        wrong = json.loads(self.metadata)
        wrong['dist']['tarball'] = 'https://example.com/evil.tgz'
        with self.assertRaisesRegex(module.BuildError, 'neplatná adresa'):
            module.load_npm_bundle(self.myspec, lambda url, max_bytes: json.dumps(wrong).encode())

    def test_offline_cache_loads_pinned_metadata_and_tarball(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            (d / 'abcjs-6.4.4.json').write_bytes(self.metadata)
            (d / 'abcjs-6.4.4.tgz').write_bytes(self.archive)
            # A direct cache fetch does not parse metadata; the actual builder
            # validates npm version, archive SHA-512 and embedded API afterwards.
            cached = module.make_cache_fetch(d)
            self.assertEqual(cached('https://registry.npmjs.org/abcjs/6.4.4', 10000), self.metadata)
            self.assertEqual(cached('https://registry.npmjs.org/abcjs/-/abcjs-6.4.4.tgz', 10000), self.archive)

    def test_offline_cache_rejects_unknown_url_and_missing_assets(self):
        with tempfile.TemporaryDirectory() as td:
            cached = module.make_cache_fetch(td)
            with self.assertRaisesRegex(module.BuildError, 'nepovolená URL'):
                cached('https://evil.example/abcjs.tgz', 1000)
            with self.assertRaisesRegex(module.BuildError, 'chybí'):
                cached('https://registry.npmjs.org/mermaid/8.9.2', 1000)

    def test_offline_cache_respects_size_limit(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            (d / 'abcjs-6.4.4.json').write_bytes(b'X' * 99)
            cached = module.make_cache_fetch(d)
            with self.assertRaisesRegex(module.BuildError, 'limit'):
                cached('https://registry.npmjs.org/abcjs/6.4.4', 98)

    def test_offline_cache_still_rejects_invalid_hash(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            # Metadata and archive come from the cache; a malicious or corrupted
            # archive MUST still be rejected by the original SRI check.
            (d / 'abcjs-6.4.4.json').write_bytes(self.metadata)
            (d / 'abcjs-6.4.4.tgz').write_bytes(self.archive[:-1] + b'X')
            spec = dict(self.myspec, name='abcjs', version='6.4.4')
            metadata = json.loads(self.metadata)
            metadata['version'] = '6.4.4'
            metadata['dist']['tarball'] = 'https://registry.npmjs.org/abcjs/-/abcjs-6.4.4.tgz'
            (d / 'abcjs-6.4.4.json').write_text(json.dumps(metadata))
            with self.assertRaisesRegex(module.BuildError, 'SHA-512'):
                module.load_npm_bundle(spec, module.make_cache_fetch(d))

    def test_builder_never_creates_partial_zip_if_network_fails(self):
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / 'release.zip'
            with self.assertRaises(Exception):
                module.build_release(ROOT, out, fetch=lambda url, limit: (_ for _ in ()).throw(OSError('offline')),
                    specs=(self.myspec,))
            self.assertFalse(out.exists())


if __name__ == '__main__':
    unittest.main()
