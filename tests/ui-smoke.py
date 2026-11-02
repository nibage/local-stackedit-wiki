"""Volitelný smoke test: python tests/ui-smoke.py
Vyžaduje Playwright a Chromium. Z důvodu omezení testovacího prostředí
používá virtuální síťovou adresu obsluhovanou výhradně z lokálních souborů.
NENÍ to test spuštění aplikace dvojklikem z file://.
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
    content_type = 'application/javascript' if target.suffix == '.js' else 'text/css' if target.suffix == '.css' else 'text/html'
    route.fulfill(status=200, body=target.read_bytes(), content_type=content_type)


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 1365, 'height': 780})
        errors, missing = [], []
        page.on('pageerror', lambda err: errors.append(str(err)))
        page.on('response', lambda response: missing.append(response.url) if response.status >= 400 else None)
        page.route('https://local-wiki.test/**', route_local)
        html = (ROOT / 'index.html').read_text(encoding='utf-8').replace('<head>', '<head><base href="https://local-wiki.test/">')
        page.set_content(html, wait_until='load', timeout=20000)
        page.evaluate('''() => {
          const docs = [
            ['index.md','# Úvod\\n\\n**Test** $E=mc^2$\\n\\n[Python](Programovani/Python.md) a [[Python|wiki odkaz]].\\n\\n<script>window.XSS_TEST=1</script>'],
            ['Programovani/Python.md','# Python\\n\\n$$\\na^2+b^2=c^2\\n$$\\n\\n```mermaid\\ngraph TD; A-->B;\\n```']
          ];
          const files=docs.map(([rel, body])=>{
            const file = new File([body],rel.split('/').pop(),{type:'text/markdown'});
            Object.defineProperty(file,'webkitRelativePath',{value:'Wiki/'+rel}); return file;
          });
          window.LocalWikiDebug.bridge.openReadOnly(files);
        }''')
        page.evaluate("() => window.LocalWikiDebug.selectFile('index.md')")
        page.wait_for_timeout(3000)
        assert page.locator('#preview strong').count() == 1, 'Markdown nebyl vykreslen'
        assert page.locator('#preview svg').count() >= 1, 'MathJax SVG nebyl vykreslen'
        assert page.evaluate('window.XSS_TEST === undefined'), 'Nebezpečné HTML bylo spuštěno'
        page.get_by_role('link', name='Python', exact=True).click()
        page.wait_for_timeout(3000)
        assert page.locator('#filename').inner_text() == 'Programovani/Python.md', 'Relativní odkaz neotevřel soubor'
        assert page.locator('#preview svg').count() >= 1, 'Bloková rovnice nebyla vykreslena'
        assert page.locator('#preview .unsupported').count() == 1, 'Mermaid placeholder se nezobrazuje'
        assert not errors, f'JavaScript chyby: {errors}'
        assert not missing, f'Nenalezené assets: {missing}'
        page.screenshot(path=str(ROOT / 'docs' / 'ui-smoke.png'))
        print('PASS: Markdown, MathJax SVG, wiki linky, XSS ochrana, Mermaid fallback')
        browser.close()


if __name__ == '__main__':
    main()
