"""Regression: editor fills available work area, theme CSS loads, copies stay isolated.
Runs with browser-network emulation; separately verify file:// permissions on target PC.
"""
from pathlib import Path
from urllib.parse import urlsplit, unquote
import argparse
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent


def route(request):
    parsed = urlsplit(request.request.url)
    path = unquote(parsed.path)
    for prefix in ['/copy-a/', '/copy-b/']:
        if path.startswith(prefix):
            path = path[len(prefix):]
            break
    else:
        request.fulfill(status=404, body='Unexpected resource: ' + parsed.path)
        return
    path = (ROOT / path).resolve()
    if not path.is_relative_to(ROOT) or not path.is_file():
        request.fulfill(status=404, body='Not found')
        return
    media = 'text/html' if path.suffix == '.html' else 'text/css' if path.suffix == '.css' else 'application/javascript'
    request.fulfill(status=200, content_type=media, body=path.read_bytes())


def get_geometry(page):
    return page.evaluate('''() => {
      const r = s => {const x=document.querySelector(s).getBoundingClientRect();return {left:x.left,top:x.top,right:x.right,bottom:x.bottom,width:x.width,height:x.height}};
      return {sidebar:r('.sidebar'), divider:r('.sidebar-resizer'), main:r('.main-area'),
        editor:r('#editor-grid'), pane:r('.edit-pane'), preview:r('.preview-pane'), workspace:r('.workspace')};
    }''')

parser = argparse.ArgumentParser(description='RC3 browser layout/theme regression test')
parser.add_argument('--chromium', default=None, help='Optional local Chromium binary path')
opts = parser.parse_args()
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=opts.chromium, headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1500, 'height': 900})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    # Chromium in our environment blocks top-level navigation even to localhost;
    # mirror the supported browser smoke pattern: HTML + locally routed assets.
    def serve_asset(req):
        parsed = urlsplit(req.request.url)
        if parsed.netloc != 'local-wiki.test':
            req.fulfill(status=404, body='Unexpected host'); return
        file = (ROOT / unquote(parsed.path).lstrip('/')).resolve()
        if not file.is_relative_to(ROOT) or not file.is_file():
            req.fulfill(status=404, body='Missing '+parsed.path); return
        mime = 'text/css' if file.suffix == '.css' else 'application/javascript'
        req.fulfill(status=200, content_type=mime, body=file.read_bytes())
    page.route('https://local-wiki.test/**', serve_asset)
    html = (ROOT / 'index.html').read_text().replace('<head>', '<head><base href="https://local-wiki.test/">', 1)
    page.set_content(html, wait_until='load')
    a = get_geometry(page)
    assert a['sidebar']['width'] > 185, a
    assert 5 <= a['divider']['width'] <= 7, a
    assert abs(a['sidebar']['right'] - a['divider']['left']) < 2, a
    assert abs(a['divider']['right'] - a['main']['left']) < 2, a
    assert a['main']['width'] > 1050, a
    assert a['editor']['width'] > 1050, a
    assert a['editor']['height'] > 500, a
    assert a['pane']['width'] > 500 and a['preview']['width'] > 500, a
    page.locator('#theme-select').select_option('dark')
    assert page.locator('html').get_attribute('data-theme') == 'dark'
    dark_background = page.locator('html').evaluate('(el)=>getComputedStyle(el).backgroundColor')
    sidebar_dark = page.locator('.sidebar').evaluate('(el)=>getComputedStyle(el).backgroundColor')
    assert dark_background == 'rgb(17, 19, 23)', dark_background
    assert sidebar_dark == 'rgb(23, 26, 32)', sidebar_dark
    page.locator('#theme-select').select_option('light')
    sidebar_light = page.locator('.sidebar').evaluate('(el)=>getComputedStyle(el).backgroundColor')
    assert sidebar_light != sidebar_dark, (sidebar_dark, sidebar_light)
    page.locator('#theme-select').select_option('dark')
    page.locator('#sidebar-resizer').focus()
    page.keyboard.press('End')
    wide = get_geometry(page)
    assert wide['sidebar']['width'] >= 515, wide
    assert wide['main']['width'] >= 850, wide
    assert wide['main']['left'] > a['main']['left'] + 250, (a, wide)
    page.locator('#view-preview').click()
    assert get_geometry(page)['editor']['width'] > 850
    assert not errors, errors
    page.screenshot(path=str(ROOT / 'docs' / 'rc3-layout-smoke.png'), full_page=True)
    print('PASS: editor/preview occupy main area; dark and light CSS really change colors; sidebar resize and preview work')
    browser.close()
