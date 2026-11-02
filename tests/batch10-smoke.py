"""Chromium UI regression for strict UTF-8, BOM, CRLF and stealth external edits.
File System Access is mocked; this does not verify OS directory permissions or file://.
"""
from pathlib import Path
from urllib.parse import urlsplit, unquote
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent


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
        page = browser.new_page(viewport={'width': 1480, 'height': 950})
        errors=[]
        page.on('pageerror', lambda err: errors.append(str(err)))
        page.route('https://local-wiki.test/**', route_local)
        html = (ROOT / 'index.html').read_text(encoding='utf8').replace('<head>', '<head><base href="https://local-wiki.test/">')
        page.set_content(html, wait_until='load')
        page.evaluate(r'''() => {
          const enc = new TextEncoder();
          function make(name, bytes) {
            return {kind:'file', name, bytes, time:1234,
              async getFile() { return new File([this.bytes.slice()], name, {lastModified:this.time}); },
              async createWritable() { let pending;
                return {write: async value => { pending = typeof value === 'string' ? enc.encode(value) : value; },
                  close: async () => {this.bytes = pending; this.time++;}, abort: async () => {}};
              }
            };
          }
          window.realFile = make('BOM.md',enc.encode('\uFEFF# První\r\nDruhý řádek\r\n'));
          window.externalFile = make('Stealth.md',enc.encode('FIRST'));
          window.badFile = make('Bad.md',new Uint8Array([35,32,195,40]));
          window.showDirectoryPicker = async () => ({kind:'directory',name:'Wiki',async *values(){yield window.realFile; yield window.externalFile; yield window.badFile;}});
        }''')
        page.locator('#open-folder').click()
        page.get_by_role('button', name='BOM.md').click()
        page.wait_for_function("() => document.querySelector('#filename').textContent==='BOM.md'")
        assert page.evaluate("() => window.LocalWikiDebug.editor.getValue()") == '# První\nDruhý řádek\n'
        page.evaluate("(value) => window.LocalWikiDebug.editor.cm.setValue(value)", "# První\nNová řádka\n")
        page.locator('#save').click()
        page.wait_for_function("() => document.querySelector('#notice').textContent.includes('Uloženo')")
        data=page.evaluate("() => [...window.realFile.bytes]")
        assert data[:3] == [239, 187, 191], f'BOM dropped: {data[:3]}'
        raw=bytes(data).decode('utf8')
        assert raw == '\ufeff# První\r\nNová řádka\r\n', repr(raw)
        page.get_by_role('button', name='Stealth.md').click()
        page.wait_for_function("() => document.querySelector('#filename').textContent==='Stealth.md'")
        page.evaluate("() => {window.externalFile.bytes=new TextEncoder().encode('OTHER'); window.LocalWikiDebug.editor.cm.setValue('WRITE');}")
        page.locator('#save').click()
        page.wait_for_function("() => document.querySelector('#notice').textContent.includes('zablokován')")
        assert page.evaluate("() => new TextDecoder().decode(window.externalFile.bytes)") == 'OTHER'
        page.once('dialog', lambda dialog: dialog.accept())
        page.get_by_role('button', name='Bad.md').click()
        page.wait_for_function("() => document.querySelector('#notice').textContent.includes('UTF-8')")
        assert page.locator('#filename').inner_text() == 'Stealth.md'
        assert not errors, errors
        page.screenshot(path=str(ROOT/'docs'/'batch10-smoke.png'))
        print('PASS: BOM+CRLF saved unchanged, same-size/mtime external edit blocked, invalid UTF-8 rejected')
        browser.close()


if __name__ == '__main__':
    main()
