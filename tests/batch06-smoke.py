"""Chromium smoke: UI file rename/move against a mocked FS Access API.
This does not validate file:// permissions on a real desktop machine.
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

def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 1480, 'height': 900}, accept_downloads=True)
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.route('https://local-wiki.test/**', route_local)
        html = (ROOT / 'index.html').read_text().replace('<head>', '<head><base href="https://local-wiki.test/">')
        page.set_content(html, wait_until='load')
        page.evaluate(r'''() => {
          const te = new TextEncoder(); const td = new TextDecoder();
          function file(name, initial='') {
            return {kind:'file',name,body:initial,lastModified:1,
              async getFile() {const bytes=te.encode(this.body);const copy=bytes.slice();return {
                size:bytes.length,lastModified:this.lastModified,text:async()=>this.body,
                arrayBuffer:async()=>copy.buffer.slice(copy.byteOffset,copy.byteOffset+copy.byteLength)}} ,
              async createWritable() {return {write:async x=>{this.temp=typeof x==='string'?x:td.decode(x)},
                close:async()=>{this.body=this.temp;this.lastModified++},abort:async()=>{}}}
            };
          }
          function folder(name, children=[]) {
            const entries = new Map(children.map(x=>[x.name,x]));
            return {name,kind:'directory', entries,
              async *values() {yield* entries.values()},
              async getDirectoryHandle(n,{create=false}={}) {if(entries.has(n)){const v=entries.get(n);if(v.kind!=='directory')throw Error('wrong type');return v}if(!create)throw Error('not found');const x=folder(n);entries.set(n,x);return x},
              async getFileHandle(n,{create=false}={}) {if(entries.has(n)){const v=entries.get(n);if(v.kind!=='file')throw Error('not file');return v}if(!create)throw Error('not found');const x=file(n);entries.set(n,x);return x},
              async removeEntry(n) {if(!entries.has(n))throw Error('not found');entries.delete(n)}
            };
          }
          window.mockRoot = folder('Wiki',[file('index.md','# Hlavní stránka\r\n\r\nTest přesunu.'),folder('Dokumenty')]);
          window.showDirectoryPicker = async () => window.mockRoot;
        }''')
        assert page.locator('#rename-file').is_disabled()
        page.locator('#open-folder').click()
        page.get_by_role('button', name='index.md').click()
        page.wait_for_function("() => !document.querySelector('#rename-file').disabled")
        def accept(dialog):
            if dialog.type == 'prompt':
                dialog.accept('Dokumenty/Přesunutá.md')
            else:
                dialog.accept()
        page.on('dialog', accept)
        page.locator('#rename-file').click()
        page.wait_for_function("() => document.querySelector('#filename').textContent === 'Dokumenty/Přesunutá.md'")
        assert page.evaluate("() => window.mockRoot.entries.has('index.md')") is False
        assert page.evaluate("() => window.mockRoot.entries.get('Dokumenty').entries.get('Přesunutá.md').body") == '# Hlavní stránka\r\n\r\nTest přesunu.'
        assert 'Upraveno 0 odkazů' in page.locator('#notice').inner_text()
        page.screenshot(path=str(ROOT / 'docs' / 'batch06-smoke.png'))
        assert not errors, errors
        print('PASS: rename via UI, nested move, bytes content preserved, tree updates, no JS errors')
        browser.close()

if __name__ == '__main__':
    main()
