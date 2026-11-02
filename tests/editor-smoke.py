"""Playwright smoke: CodeMirror editor, formatting, save, conflict, math.
Run: python tests/editor-smoke.py. This is an in-browser mocked file system,
NOT a real file:// permission test (sandbox does not allow file:// navigation).
"""
from pathlib import Path
from urllib.parse import unquote, urlsplit
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent


def route_local(route):
    path = unquote(urlsplit(route.request.url).path).lstrip('/')
    target = (ROOT / path).resolve()
    if not target.is_relative_to(ROOT) or not target.is_file():
        route.fulfill(status=404, body='File not found')
        return
    mime = 'application/javascript' if target.suffix == '.js' else 'text/css' if target.suffix == '.css' else 'text/html'
    route.fulfill(status=200, body=target.read_bytes(), content_type=mime)


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 1400, 'height': 900})
        errors, missing = [], []
        page.on('pageerror', lambda err: errors.append(str(err)))
        page.on('response', lambda response: missing.append(response.url) if response.status >= 400 else None)
        page.route('https://local-wiki.test/**', route_local)
        html = (ROOT / 'index.html').read_text(encoding='utf-8').replace('<head>', '<head><base href="https://local-wiki.test/">')
        page.set_content(html, wait_until='load', timeout=20000)
        page.evaluate(r'''() => {
          window.__mockFile = {
            name: 'Test.md', kind: 'file', contents: '# Test\r\n\r\nPůvodní text\r\n', lastModified: 4000,
            async getFile() {
              return { size: new TextEncoder().encode(this.contents).length,
                lastModified: this.lastModified, text: async () => this.contents, arrayBuffer:async()=>new TextEncoder().encode(this.contents).buffer };
            },
            async createWritable() {
              return { write: async text => { this.pending = text; },
                close: async () => { this.contents = this.pending; this.lastModified += 1000; }, abort: async () => {} };
            }
          };
          window.showDirectoryPicker = async () => ({ name:'Wiki',kind:'directory',
            async *values() { yield window.__mockFile; } });
        }''')
        page.locator('#open-folder').click()
        page.wait_for_function("() => window.LocalWikiDebug.bridge.hasFile('Test.md')")
        page.get_by_role('button', name='Test.md').click()
        page.wait_for_function("() => window.LocalWikiDebug.editor.getValue().includes('Původní')")
        assert page.locator('.CodeMirror').count() == 1, 'CodeMirror was not instantiated'
        assert page.evaluate("window.LocalWikiDebug.editor.cm.getOption('mode')") == 'gfm'
        assert not page.evaluate("window.LocalWikiDebug.editor.cm.getOption('readOnly')")
        page.evaluate('''() => {
          const e = window.LocalWikiDebug.editor;
          e.cm.setCursor(2, 0);
          e.cm.setSelection({line:2,ch:0},{line:2,ch:13});
          e.format('bold');
        }''')
        page.wait_for_timeout(350)
        assert '● Neuloženo' in page.locator('#dirty').inner_text()
        assert '**Původní text**' in page.evaluate('window.LocalWikiDebug.editor.getValue()')
        page.locator('#save').click()
        page.wait_for_function("() => !document.querySelector('#save').disabled || document.querySelector('#dirty').textContent === ''")
        stored = page.evaluate('window.__mockFile.contents')
        assert '**Původní text**' in stored
        assert '\r\n' in stored and '\n' not in stored.replace('\r\n', ''), 'CRLF was not preserved'
        # External change conflict should block save.
        page.evaluate('''() => {
          window.__mockFile.contents = '# externí úprava\\r\\n';
          window.__mockFile.lastModified += 5000;
          const e = window.LocalWikiDebug.editor;
          e.cm.replaceRange('! ', {line:2,ch:0});
        }''')
        page.locator('#save').click()
        page.wait_for_timeout(250)
        assert 'externí úprava' in page.evaluate('window.__mockFile.contents')
        assert 'Uložení zastaveno' in page.locator('#notice').inner_text()
        assert page.locator('#dirty').inner_text(), 'Editor must retain unsaved content'
        # Built-in search overlay works.
        page.evaluate("window.LocalWikiDebug.editor.cm.execCommand('find')")
        assert page.locator('.CodeMirror-dialog input').count() == 1
        assert not errors, f'Javascript errors: {errors}'
        assert not missing, f'Missing assets: {missing}'
        page.screenshot(path=str(ROOT / 'docs' / 'editor-smoke.png'))
        print('PASS: CodeMirror, formatting, CRLF disk save, external edit conflict, search dialog')
        browser.close()


if __name__ == '__main__':
    main()
