"""UI smoke with in-browser mock file handles; not a direct file:// permissions test."""
from pathlib import Path
from urllib.parse import urlsplit, unquote
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent

def route_local(route):
    rel = unquote(urlsplit(route.request.url).path).lstrip('/')
    target = (ROOT / rel).resolve()
    if not target.is_relative_to(ROOT) or not target.is_file():
        route.fulfill(status=404, body='Not found'); return
    mime = 'text/css' if target.suffix == '.css' else 'application/javascript' if target.suffix == '.js' else 'text/html'
    route.fulfill(status=200, content_type=mime, body=target.read_bytes())

def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 1400, 'height': 850})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('https://local-wiki.test/**', route_local)
        markup = (ROOT / 'index.html').read_text().replace('<head>', '<head><base href="https://local-wiki.test/">')
        page.set_content(markup, wait_until='load')
        page.evaluate(r'''() => {
          function file(name, initial='') {
            return {kind:'file',name,body:initial,lastModified:1,
              async getFile() {const buffer=new TextEncoder().encode(this.body);return {size:buffer.byteLength,lastModified:this.lastModified,text:async()=>this.body,arrayBuffer:async()=>buffer.slice().buffer}},
              async createWritable() {return {write:async x=>{this.temp=x},close:async()=>{this.body=this.temp;this.lastModified++},abort:async()=>{}}}
            };
          }
          function folder(name, children=[]) {
            const entries = new Map(children.map(x=>[x.name,x]));
            return {name,kind:'directory', entries,
              async *values() {yield* entries.values()},
              async getDirectoryHandle(n,{create=false}={}) {if(entries.has(n)){const v=entries.get(n);if(v.kind!=='directory')throw Error('wrong type');return v}if(!create)throw Error('not found');const x=folder(n);entries.set(n,x);return x},
              async getFileHandle(n,{create=false}={}) {if(entries.has(n)){const v=entries.get(n);if(v.kind!=='file')throw Error('wrong type');return v}if(!create)throw Error('not found');const x=file(n);entries.set(n,x);return x}
            };
          }
          window.mockRoot = folder('Wiki',[file('index.md','# Home\n\nStart')]);
          window.showDirectoryPicker=async()=>window.mockRoot;
        }''')
        assert page.locator('#new-file').is_disabled()
        page.locator('#open-folder').click()
        page.wait_for_function("() => !document.querySelector('#new-file').disabled")
        prompts = iter(['Kapitoly', 'Kapitoly/Nová.md'])
        page.on('dialog', lambda dialog: dialog.accept(next(prompts)))
        page.locator('#new-folder').click()
        page.wait_for_function("() => window.mockRoot.entries.has('Kapitoly')")
        page.locator('#new-file').click()
        page.wait_for_function("() => document.querySelector('#filename').textContent === 'Kapitoly/Nová.md'")
        assert page.locator('#new-file').is_enabled()
        page.evaluate("() => window.LocalWikiDebug.editor.setReadOnly(false)")
        page.evaluate("() => { window.LocalWikiDebug.editor.cm.replaceRange('# Nová stránka', {line:0,ch:0}); }")
        page.locator('#save').click()
        page.wait_for_function("() => !document.querySelector('#dirty').textContent")
        saved = page.evaluate("() => window.mockRoot.entries.get('Kapitoly').entries.get('Nová.md').body")
        assert saved == '# Nová stránka', saved
        page.get_by_role('button', name='Nová.md').click()
        assert page.locator('#filename').inner_text() == 'Kapitoly/Nová.md'
        page.screenshot(path=str(ROOT/'docs'/'batch05-smoke.png'))
        assert not errors, errors
        print('PASS: create folder, create note, open in editor, save to original mock file, no JS errors')
        browser.close()

if __name__ == '__main__': main()
