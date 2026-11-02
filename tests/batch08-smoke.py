"""Chromium: Obsidian YAML, callouts, local image embeds and code fences.
Uses a mocked File System Access API. Does not establish file:// permission support.
"""
from pathlib import Path
from urllib.parse import urlsplit, unquote
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent

def route_local(route):
    rel = unquote(urlsplit(route.request.url).path).lstrip('/')
    path = (ROOT / rel).resolve()
    if not path.is_relative_to(ROOT) or not path.is_file():
        route.fulfill(status=404, body='not found')
        return
    mime = 'text/css' if path.suffix == '.css' else 'application/javascript' if path.suffix == '.js' else 'text/html'
    route.fulfill(status=200, content_type=mime, body=path.read_bytes())

DOC = '''---
title: "Poznámky k obrázkům"
tags: [wiki, demo]
---
# Obsidian formáty

> [!TIP] Vlastní nadpis
> Užitečný tip s **Markdownem**.

> [!warning]- Skryté varování
> Schovaný text varování.

## Obrázek

![[schema.png|280]]

`![[schema.png]]`

```md
![[schema.png]]
> [!tip] toto není callout
```
'''

def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 1470, 'height': 920})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.route('https://local-wiki.test/**', route_local)
        html = (ROOT/'index.html').read_text().replace('<head>', '<head><base href="https://local-wiki.test/">')
        page.set_content(html, wait_until='load')
        png_bytes = list((ROOT / 'demo-wiki' / 'obrazky' / 'schema.png').read_bytes())
        page.evaluate(r'''({doc, pngBytes}) => {
          const note = {kind:'file',name:'Obsidian.md',async getFile(){return new File([doc], 'Obsidian.md',{type:'text/markdown'})}};
          const picture = {kind:'file',name:'schema.png',async getFile(){return new File([new Uint8Array(pngBytes)],'schema.png',{type:'image/png'})}};
          const imageDir = {kind:'directory',name:'obrazky',async *values(){yield picture}};
          window.showDirectoryPicker=async()=>({kind:'directory',name:'Wiki',async *values(){yield note;yield imageDir}});
        }''', {'doc': DOC, 'pngBytes': png_bytes})
        page.locator('#open-folder').click()
        page.get_by_role('button', name='Obsidian.md').click()
        page.wait_for_function("() => document.querySelector('#filename').textContent === 'Obsidian.md'")
        page.wait_for_function("() => document.querySelector('#preview img')?.getAttribute('src')?.startsWith('blob:')")
        assert page.locator('#preview .obsidian-properties summary').inner_text() == 'Vlastnosti poznámky (YAML)'
        assert 'tags: [wiki, demo]' in page.locator('#preview .obsidian-properties pre').text_content()
        assert page.locator('#preview .obsidian-callout').count() == 2
        assert page.locator('#preview .obsidian-callout--tip .obsidian-callout-title').inner_text() == 'Vlastní nadpis'
        assert 'Markdownem' in page.locator('#preview .obsidian-callout--tip strong').inner_text()
        assert page.locator('#preview details.obsidian-callout--warning').get_attribute('open') is None
        assert page.locator('#preview img').count() == 1
        assert page.locator('#preview img').first.get_attribute('style') == 'width: 280px;'
        assert page.locator('#preview img').first.get_attribute('title') == 'obrazky/schema.png'
        assert page.locator('#preview img').first.evaluate('(img) => img.complete && img.naturalWidth > 0')
        assert '![[schema.png]]' in page.locator('#preview pre').last.inner_text()
        page.screenshot(path=str(ROOT/'docs'/'batch08-smoke.png'))
        assert not errors, errors
        print('PASS: Obsidian YAML, callouts, folding, local embed, safe code fences, no JS errors')
        browser.close()

if __name__ == '__main__': main()
