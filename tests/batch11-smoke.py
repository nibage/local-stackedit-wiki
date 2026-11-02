"""Chromium regression for async read/write races using a delayed FS mock.
This doesn't prove file:// permissions or actual disk writes.
"""
from pathlib import Path
from urllib.parse import urlsplit, unquote
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent


def route_local(route):
    rel = unquote(urlsplit(route.request.url).path).lstrip('/')
    target = (ROOT / rel).resolve()
    if not target.is_relative_to(ROOT) or not target.is_file():
        route.fulfill(status=404, body='not found'); return
    mime = 'text/css' if target.suffix == '.css' else 'application/javascript' if target.suffix == '.js' else 'text/html'
    route.fulfill(status=200, content_type=mime, body=target.read_bytes())


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 1440, 'height': 880})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('https://local-wiki.test/**', route_local)
        html = (ROOT / 'index.html').read_text(encoding='utf8').replace('<head>', '<head><base href="https://local-wiki.test/">')
        page.set_content(html, wait_until='load')
        page.evaluate(r'''() => {
          const enc=new TextEncoder();
          function file(name, content) {
            return {kind:'file', name, bytes:enc.encode(content), time:12,
              async getFile() {
                if (name === 'A.md' && window.holdReadA) {
                  await new Promise(resolve => {window.releaseReadA=resolve;});
                }
                return new File([this.bytes.slice()],name,{lastModified:this.time});
              },
              async createWritable() {
                let pending;
                const source=this;
                return {write:async value=>{pending=typeof value==='string'?enc.encode(value):value;},
                  close:async()=> {
                    if (name==='B.md' && window.holdSaveB)
                      await new Promise(resolve=>{window.releaseSaveB=resolve;});
                    source.bytes=pending; source.time++;
                  }, abort:async()=>{}};
              }
            };
          }
          window.A=file('A.md','A original');
          window.B=file('B.md','B original');
          window.C=file('C.md','C original');
          window.showDirectoryPicker=async()=>({kind:'directory',name:'Wiki',async *values(){yield window.A;yield window.B;yield window.C;}});
        }''')
        page.locator('#open-folder').click()
        page.wait_for_function("() => document.querySelector('#root-name').textContent==='Wiki'")
        # Read B first, then start delayed A and another B read. The latest wins.
        page.get_by_role('button', name='B.md').click()
        page.wait_for_function("() => document.querySelector('#filename').textContent==='B.md'")
        page.evaluate("() => {window.holdReadA=true; window.pendingA=window.LocalWikiDebug.selectFile('A.md');}")
        page.wait_for_function("() => typeof window.releaseReadA==='function'")
        page.evaluate("() => {window.pendingC=window.LocalWikiDebug.selectFile('C.md');}")
        page.wait_for_function("() => document.querySelector('#filename').textContent==='C.md'")
        page.evaluate("() => window.releaseReadA()")
        page.evaluate("() => Promise.all([window.pendingA,window.pendingC])")
        assert page.locator('#filename').inner_text() == 'C.md', 'stale read replaced new document'
        # Start a delayed save; deny file switching, retain edits typed during save.
        page.get_by_role('button', name='B.md').click()
        page.wait_for_function("() => document.querySelector('#filename').textContent==='B.md'")
        page.evaluate("() => {window.LocalWikiDebug.editor.cm.setValue('saved snapshot'); window.holdSaveB=true;}")
        page.locator('#save').click()
        page.wait_for_function("() => typeof window.releaseSaveB==='function'")
        page.evaluate("() => {window.attemptedSwitch=window.LocalWikiDebug.selectFile('C.md');}")
        page.wait_for_function("() => document.querySelector('#notice').textContent.includes('dočasně zakázané')")
        assert page.locator('#filename').inner_text() == 'B.md'
        page.evaluate("() => window.LocalWikiDebug.editor.cm.setValue('newer edit')")
        page.evaluate("() => window.releaseSaveB()")
        page.wait_for_function("() => !window.LocalWikiDebug.operations.isBusy()")
        assert page.evaluate("() => new TextDecoder().decode(window.B.bytes)") == 'saved snapshot'
        assert page.evaluate("() => window.LocalWikiDebug.editor.getValue()") == 'newer edit'
        assert page.locator('#save').is_enabled(), 'new edit silently marked as saved'
        assert 'Neuloženo' in page.locator('#dirty').inner_text()
        # Second save must persist the more recent text.
        page.evaluate("() => {window.holdSaveB=false; window.releaseSaveB=null;}")
        page.locator('#save').click()
        page.wait_for_function("() => !window.LocalWikiDebug.operations.isBusy()")
        assert page.evaluate("() => new TextDecoder().decode(window.B.bytes)") == 'newer edit'
        assert page.locator('#dirty').inner_text() == ''
        # Reload same file without changing active path (old implementation lost it).
        page.evaluate("() => window.LocalWikiDebug.editor.cm.setValue('unsaved on reload')")
        page.once('dialog', lambda dialog: dialog.accept())
        page.locator('#reload').click()
        page.wait_for_function("() => window.LocalWikiDebug.editor.getValue()==='newer edit'")
        assert page.locator('#filename').inner_text() == 'B.md'
        assert not errors, errors
        page.screenshot(path=str(ROOT/'docs'/'batch11-smoke.png'))
        print('PASS: stale reads rejected; switch blocked during write; new edits stay dirty; second save; safe reload')
        browser.close()

if __name__ == '__main__':
    main()
