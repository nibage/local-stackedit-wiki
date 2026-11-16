"""Regression: tree expansion, unobtrusive notices and 5-second safe autosave.
The File System Access API is simulated; real file:// permissions are still a manual check.
"""
from pathlib import Path
from urllib.parse import urlsplit, unquote
import argparse
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser()
parser.add_argument('--chromium',default=None)
opts=parser.parse_args()

def serve(route):
    parsed=urlsplit(route.request.url)
    asset=(ROOT/unquote(parsed.path).lstrip('/')).resolve()
    if parsed.netloc!='wiki-autosave.test' or not asset.is_relative_to(ROOT) or not asset.is_file():
        route.fulfill(status=404,body='Not found');return
    mime='text/css' if asset.suffix=='.css' else 'application/javascript'
    route.fulfill(status=200,content_type=mime,body=asset.read_bytes())

with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=opts.chromium,headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1360,'height':840})
    page.set_default_timeout(11000)
    errors=[]
    page.on('pageerror',lambda err:errors.append(str(err)))
    page.route('https://wiki-autosave.test/**',serve)
    html=(ROOT/'index.html').read_text().replace('<head>','<head><base href="https://wiki-autosave.test/">',1)
    page.set_content(html,wait_until='load')
    # A temporary message belongs inside the brand, not over the file controls.
    assert page.locator('.topbar .brand #notice').count()==1
    assert page.locator('#notice').evaluate("(el)=>getComputedStyle(el).position")=='static'
    assert page.evaluate("document.querySelector('.workspace').getBoundingClientRect().top - document.querySelector('.topbar').getBoundingClientRect().bottom < 2")
    assert page.locator('[data-side="search"]').inner_text()=='Search'
    page.evaluate("""() => {
      function file(name,body){return {kind:'file',name,body,lastModified:100,
        async getFile(){return new File([this.body],name,{type:'text/markdown',lastModified:this.lastModified})},
        async createWritable(){let next;return{write:async value=>{next=value},
          close:async()=>{this.body=next;this.lastModified++},abort:async()=>{}}}
      }}
      function dir(name,contents=[]){const entries=new Map(contents.map(x=>[x.name,x]));
        return {kind:'directory',name,entries,async *values(){yield* entries.values()},
          async getDirectoryHandle(n,{create=false}={}){const child=entries.get(n);if(!child)throw Error('Missing dir');return child},
          async getFileHandle(n,{create=false}={}){const child=entries.get(n);if(!child)throw Error('Missing file');return child},
          async removeEntry(n){entries.delete(n)}
        }}
      window.mockWiki=dir('Demo',[file('Intro.md','# Original'),dir('Deep',[dir('Nested',[file('Child.md','# Child')])])]);
      window.showDirectoryPicker=async()=>window.mockWiki;
    }""")
    page.locator('#open-folder').click()
    page.wait_for_function("document.querySelector('#root-name').textContent==='Demo'")
    assert page.locator('#expand-all').is_enabled()
    assert page.locator('.tree-row[aria-label="Deep/Nested/Child.md"]').count()==0
    page.locator('#expand-all').click()
    assert page.locator('.tree-row[aria-label="Deep/Nested/Child.md"]').count()==1
    assert page.locator('.tree-row[aria-label="Deep"]').locator('.glyph-folder').inner_text()=='▼'
    page.locator('#collapse-all').click()
    assert page.locator('.tree-row[aria-label="Deep/Nested/Child.md"]').count()==0
    assert page.locator('.tree-row[aria-label="Deep"]').locator('.glyph-folder').inner_text()=='▶'
    assert page.locator('.tree-row[aria-label="Intro.md"]').locator('.glyph-note').inner_text()=='●'
    page.locator('.tree-row[aria-label="Intro.md"]').click()
    page.wait_for_function("document.querySelector('#filename').textContent==='Intro.md'")
    assert 'Opened note:' not in page.locator('#notice').text_content()
    assert page.locator('#notice').evaluate("(el)=>getComputedStyle(el).position")=='static'
    page.locator('#rename-file').click()
    page.wait_for_function("document.querySelector('#notice').textContent.includes('Move mode enabled')")
    assert page.locator('#notice').get_attribute('title')==page.locator('#notice').inner_text()
    # The message must be contained in the header and never cover the folder buttons.
    assert page.evaluate("""() => {
        const n=document.querySelector('#notice').getBoundingClientRect();
        const h=document.querySelector('.topbar').getBoundingClientRect();
        const b=document.querySelector('#new-folder').getBoundingClientRect();
        return n.top>=h.top && n.bottom<=h.bottom+1 && n.bottom<=b.top;
    }""")
    page.locator('#new-folder').is_enabled()
    page.locator('#rename-file').click()
    page.evaluate("window.LocalWikiDebug.editor.cm.setValue('# Autosaved on timer')")
    assert page.locator('#dirty').inner_text().strip(), 'Editing must mark the note dirty'
    # Wait for a real 5-second interval, not a mocked timer.
    page.wait_for_function("window.mockWiki.entries.get('Intro.md').body.includes('# Autosaved on timer')",timeout=9000)
    assert not page.locator('#dirty').inner_text().strip()
    assert 'No unsaved changes' in page.locator('#save-status').inner_text()
    # Read-only opening disables saving even if the user asks to open the same wiki again.
    page.locator('#read-only-toggle').check()
    page.locator('#open-folder').click()
    page.wait_for_function("window.LocalWikiDebug.bridge.getMode()==='readonly'")
    page.locator('.tree-row[aria-label="Intro.md"]').click()
    page.wait_for_function("document.querySelector('#filename').textContent==='Intro.md'")
    assert page.locator('#save').is_disabled()
    assert not errors, errors
    print('PASS: Expand/Collapse all, clear glyphs, Search tab, nonpersistent notices, 5-second autosave and read-only')
    browser.close()
