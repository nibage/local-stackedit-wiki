"""Chromium test of new privacy-preserving diagnostics download.
Tests simulated HTTPS because administrator policy forbids file:// navigation.
"""
from pathlib import Path
from urllib.parse import urlsplit, unquote
import json
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent

def route_local(route):
    rel = unquote(urlsplit(route.request.url).path).lstrip('/')
    target = (ROOT / rel).resolve()
    if not target.is_relative_to(ROOT) or not target.is_file():
        route.fulfill(status=404, body='not found')
        return
    mime = 'text/css' if target.suffix == '.css' else 'application/javascript' if target.suffix == '.js' else 'text/html'
    route.fulfill(status=200, content_type=mime, body=target.read_bytes())

def run():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        context = browser.new_context(accept_downloads=True)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.route('https://local-wiki.test/**', route_local)
        html = (ROOT/'index.html').read_text(encoding='utf8').replace('<head>', '<head><base href="https://local-wiki.test/">')
        page.set_content(html, wait_until='load')
        assert page.title().startswith('Local StackEdit Wiki')
        page.locator('#renderer-check').click()
        assert page.locator('#renderer-details').inner_text().count('chybí knihovna') >= 2
        with page.expect_download() as download_info:
            page.locator('#diagnostics-export').click()
        download = download_info.value
        assert download.suggested_filename == f"local-wiki-diagnostics-{page.evaluate('window.LocalWikiDiagnostics.VERSION')}.json"
        report = json.loads(Path(download.path()).read_text())
        assert report['version'] == page.evaluate('window.LocalWikiDiagnostics.VERSION')
        assert report['libraries']['marked']
        assert report['libraries']['codeMirror']
        assert report['libraries']['mathJax']
        assert not report['libraries']['mermaid']
        assert not report['libraries']['abcjs']
        assert report['wiki']['mode'] == 'none'
        assert 'content' not in report['wiki']
        assert not errors, errors
        print('PASS: diagnostics modal and privacy-safe downloadable JSON, missing libraries correctly detected')
        browser.close()

if __name__ == '__main__': run()
