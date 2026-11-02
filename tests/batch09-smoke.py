"""Chromium integration for batch 9. Renderer UMD APIs are simulated because
vendored originals are not available in this environment. Simulates FSA too.
"""
from pathlib import Path
from urllib.parse import urlsplit, unquote
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
NOTE = '# Renderery\n\n```mermaid\nflowchart LR\n A-->B\n```\n\n```abc\nX:1\nT:Test\nK:C\nCDEF GABc|\n```\n'


def route_local(route):
    rel = unquote(urlsplit(route.request.url).path).lstrip('/')
    file = (ROOT / rel).resolve()
    if not file.is_relative_to(ROOT) or not file.is_file():
        route.fulfill(status=404, body='not found')
        return
    mime = 'text/css' if file.suffix == '.css' else 'application/javascript' if file.suffix == '.js' else 'text/html'
    route.fulfill(status=200, content_type=mime, body=file.read_bytes())


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 1500, 'height': 960}, accept_downloads=True)
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.route('https://local-wiki.test/**', route_local)
        source = (ROOT / 'index.html').read_text().replace('<head>', '<head><base href="https://local-wiki.test/">')
        page.set_content(source, wait_until='load')
        page.evaluate('''(doc) => {
            const file = {kind:'file', name:'Diagrams.md', async getFile() { return new File([doc],'Diagrams.md'); }};
            window.showDirectoryPicker = async () => ({kind:'directory',name:'Wiki',async *values() { yield file; }});
        }''', NOTE)
        page.locator('#open-folder').click()
        page.get_by_role('button', name='Diagrams.md').click()
        page.wait_for_function("() => document.querySelector('#filename').textContent === 'Diagrams.md'")
        assert page.locator('#preview .unsupported').count() == 2
        assert page.locator('#preview pre').count() >= 2
        assert 'Chybí knihovny: 2' in page.locator('#render-status').inner_text()
        page.locator('#renderer-check').click()
        assert 'Mermaid diagramy: chybí knihovna' in page.locator('#renderer-details').inner_text()
        assert 'ABC notový zápis: chybí knihovna' in page.locator('#renderer-details').inner_text()
        page.locator('#renderer-close').click()
        # Simulated UMD libraries, including async Mermaid callback and hostile SVG content.
        page.evaluate(r'''() => {
            window.ABCJS = {
              renderAbc(target) {
                target.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="20" height="10" onclick="alert(1)"/>' +
                  '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">bad</div></foreignObject></svg>';
              }
            };
            window.mermaid = {
              initialize() {},
              mermaidAPI: {
                render(id, text, callback) {
                  setTimeout(() => callback('<svg xmlns="http://www.w3.org/2000/svg">' +
                    '<rect width="50" height="10" onclick="alert(1)"/><script>alert(2)</script>' +
                    '<a href="https://example.com"><text>External</text></a></svg>'), 25);
                }
              }
            };
            window.LocalWikiDebug.renderPreview();
        }''')
        page.wait_for_function("() => document.querySelectorAll('#preview .visualization svg').length === 2")
        assert page.locator('#preview .visualization-mermaid svg').count() == 1
        assert page.locator('#preview .visualization-abc svg').count() == 1
        assert page.locator('#preview .unsupported').count() == 0
        assert page.locator('#preview .visualization script,#preview .visualization foreignObject').count() == 0
        assert page.locator('#preview .visualization [onclick]').count() == 0
        assert page.locator('#preview .visualization a[href]').count() == 0
        assert 'Diagramy/noty: 2' in page.locator('#render-status').inner_text()
        assert page.locator('#preview .diagram-export').count() == 2
        with page.expect_download() as info:
            page.locator('#preview .visualization-mermaid .diagram-export').click()
        download = info.value
        assert download.suggested_filename.startswith('mermaid-') and download.suggested_filename.endswith('.svg')
        page.locator('#renderer-check').click()
        assert 'Mermaid diagramy: připraven' in page.locator('#renderer-details').inner_text()
        assert 'ABC notový zápis: připraven' in page.locator('#renderer-details').inner_text()
        page.locator('#renderer-close').click()
        # A later preview must not pick up an outdated Mermaid callback.
        page.evaluate(r'''() => {
            const code = window.LocalWikiDebug.editor.getValue();
            window.LocalWikiDebug.editor.setValue('# Nový náhled\n\nJen text.');
            window.LocalWikiDebug.renderPreview();
        }''')
        page.wait_for_timeout(100)
        assert page.locator('#preview .visualization').count() == 0
        assert page.locator('#preview h1').inner_text() == 'Nový náhled'
        assert not errors, errors
        page.screenshot(path=str(ROOT/'docs'/'batch09-smoke.png'))
        print('PASS: missing renderers, diagnostics, Mermaid/ABC UMD bridge, SVG cleaning, async, export, stale preview')
        browser.close()


if __name__ == '__main__':
    main()
