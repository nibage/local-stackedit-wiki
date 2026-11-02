"""Browser integration, using mock File System Access API (not a file:// permission test)."""
from pathlib import Path
from urllib.parse import urlsplit, unquote
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent

def route_local(route):
    p = unquote(urlsplit(route.request.url).path).lstrip('/')
    f = (ROOT / p).resolve()
    if not f.is_relative_to(ROOT) or not f.is_file():
        route.fulfill(status=404, body='Not found')
        return
    mime = 'application/javascript' if f.suffix == '.js' else 'text/css' if f.suffix == '.css' else 'text/html'
    route.fulfill(status=200, body=f.read_bytes(), content_type=mime)

def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 1400, 'height': 950})
        errors, missing = [], []
        page.on('pageerror', lambda exc: errors.append(str(exc)))
        page.on('response', lambda r: missing.append(r.url) if r.status >= 400 else None)
        page.route('https://local-wiki.test/**', route_local)
        page.set_content((ROOT/'index.html').read_text().replace('<head>', '<head><base href="https://local-wiki.test/">'), wait_until='load', timeout=20000)
        page.evaluate(r'''() => {
          const data = {
            'index.md': '# Domů\n\n[Python](Programovani/Python.md)\n\n```mermaid\ngraph LR\nA --> B\n```',
            'Programovani/Python.md': '# Python\n\n## První sekce\n\nŽluťoučký kůň má text.\n\n```abc\nX:1\nK:C\nCDEF GABc|\n```',
            'Programovani/JS.md': '# JS\n\n[[Python]]'
          };
          function handle(name, contents) {
            return { name, kind:'file', contents, lastModified:1234,
              async getFile() { const buffer = new TextEncoder().encode(this.contents); return {size: buffer.byteLength, lastModified: this.lastModified, text: async () => this.contents, arrayBuffer:async()=>buffer.slice().buffer}; },
              async createWritable() { return { write: async v => { this.pending=v }, close: async () => { this.contents=this.pending; this.lastModified++ }, abort: async () => {} }; } };
          }
          const group = Object.entries(data).reduce((a,[path,text])=>{ a[path]=handle(path.split('/').pop(),text);return a; },{});
          const folder = { name: 'Programovani', kind:'directory', async *values() { yield group['Programovani/Python.md']; yield group['Programovani/JS.md']; } };
          window.showDirectoryPicker = async () => ({name:'Wiki',kind:'directory',async *values() { yield group['index.md']; yield folder; }});
        }''')
        page.locator('#open-folder').click()
        page.wait_for_function("() => window.LocalWikiDebug.bridge.getFilePaths().length === 3")
        page.get_by_role('button', name='index.md').click()
        page.wait_for_function("() => window.LocalWikiDebug.editor.getValue().startsWith('# Domů')")
        page.locator('[data-side="links"]').click()
        assert page.locator('#toc .toc-item').count() == 1
        page.locator('#backlinks-run').click()
        page.wait_for_function("() => window.LocalWikiDebug.wikiIndex.isReady()")
        page.evaluate("window.LocalWikiDebug.selectFile('Programovani/Python.md')")
        page.wait_for_function("() => document.querySelector('#filename').textContent === 'Programovani/Python.md'")
        page.locator('#backlinks-run').click()
        page.wait_for_function("() => document.querySelectorAll('#backlinks-results .result-item').length === 2")
        assert page.locator('#toc .toc-item').count() == 2
        assert page.locator('#backlinks-results .result-item').count() == 2
        page.locator('[data-side="search"]').click()
        page.locator('#fulltext-query').fill('zlutoucky kun')
        page.locator('#fulltext-run').click()
        page.wait_for_function("() => document.querySelectorAll('#fulltext-results .result-item').length === 1")
        assert 'Python.md:5' in page.locator('#fulltext-results').inner_text()
        page.locator('#fulltext-results .result-item').click()
        assert page.evaluate('window.LocalWikiDebug.editor.cm.getCursor().line') == 4
        assert 'ABCjs: knihovna není nainstalována' in page.locator('#preview').inner_text()
        # Fake libraries only for adapter test. Real vendor libraries are optional in the ZIP.
        page.evaluate(r'''() => {
          window.ABCJS = { renderAbc(target, text) { target.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>'; }};
          window.mermaid = { initialize() {}, mermaidAPI: { render(id,text,cb) {
            cb('<svg xmlns="http://www.w3.org/2000/svg"><g><rect width="42" height="12"/></g><script>alert(1)</script></svg>');
          } } };
          window.LocalWikiDebug.renderPreview();
        }''')
        assert page.locator('#preview .visualization-abc svg').count() == 1
        page.get_by_role('button', name='Soubory').click()
        page.get_by_role('button', name='index.md').click()
        page.wait_for_function("() => document.querySelector('#filename').textContent === 'index.md'")
        assert page.locator('#preview .visualization-mermaid svg').count() == 1
        assert page.locator('#preview script').count() == 0
        assert not errors, errors
        assert not missing, missing
        page.screenshot(path=str(ROOT/'docs'/'batch04-smoke.png'))
        print('PASS: fulltext, backlinks, TOC, optional diagram adapters, no missing scripts')
        browser.close()
if __name__ == '__main__': main()
