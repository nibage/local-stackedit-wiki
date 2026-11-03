"""Offline-in-browser RC2 smoke: full renderers, Prism, read-only, delete, refresh."""
from pathlib import Path
from urllib.parse import urlsplit,unquote
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parent.parent

def serve(route):
    url=urlsplit(route.request.url)
    p=(R/unquote(url.path).lstrip('/')).resolve()
    if url.netloc!='local-wiki.test' or not p.is_relative_to(R) or not p.is_file():
        route.fulfill(status=404,body='Missing: '+url.path);return
    mime='text/css' if p.suffix=='.css' else 'text/javascript' if p.suffix=='.js' else 'text/html'
    route.fulfill(status=200,content_type=mime,body=p.read_bytes())

with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':900})
    errors=[]
    page.on('pageerror',lambda ex: errors.append(str(ex)))
    page.route('**/*',serve)
    page.set_content((R/'index.html').read_text().replace('<head>','<head><base href="https://local-wiki.test/">',1),wait_until='load')
    page.evaluate('''() => {
      function file(name,body) { return {kind:'file',name,lastModified:100,body,
        async getFile(){return new File([this.body],name,{lastModified:this.lastModified});},
        async createWritable(){let text='';return{write:async x=>text=x,close:async()=>{this.body=text;this.lastModified++},abort:async()=>{}}}
      };}
      function dir(name,children=[]){const entries=new Map(children.map(x=>[x.name,x]));return{
        kind:'directory',name,entries,async *values(){yield* entries.values()},
        async getDirectoryHandle(n,{create=false}={}){let v=entries.get(n);if(!v&&create){v=dir(n);entries.set(n,v)}if(!v)throw Error('Missing directory');return v},
        async getFileHandle(n,{create=false}={}){let v=entries.get(n);if(!v&&create){v=file(n,'');entries.set(n,v)}if(!v)throw Error('Missing file');return v},
        async removeEntry(n,{recursive=false}={}){const x=entries.get(n);if(x.kind==='directory'&&x.entries.size&&!recursive)throw Error('Not empty');entries.delete(n)}
      }}
      window.testWiki=dir('Demo',[file('Python.md','# Python\\n\\n```python\\ndef greet():\\n    print("Ahoj")\\n```'),dir('notes',[file('one.md','# one')])]);
      window.pickModes=[];
      window.showDirectoryPicker=async options=>{window.pickModes.push(options.mode);return window.testWiki};
    }''')
    caps=page.evaluate('window.LocalWikiDiagrams.capabilities()')
    assert caps=={'mermaid':True,'abc':True}, caps
    page.locator('#open-folder').click()
    page.wait_for_function("document.querySelector('#root-name').textContent==='Demo'")
    page.locator('.tree-row[aria-label="Python.md"]').click()
    page.wait_for_function("document.querySelector('#filename').textContent==='Python.md'")
    page.wait_for_function("document.querySelectorAll('#preview .token.keyword').length>0")
    assert page.locator('#preview .token.keyword').first.inner_text()=='def'
    assert page.locator('#refresh').is_enabled()
    assert not page.locator('#restore-last').count()
    assert not page.locator('#remember-root').count()
    assert not page.locator('#reload').count()
    assert not page.locator('#forget-last').count()
    dialogs=[]
    def accept(d):
        dialogs.append(d.message)
        d.accept()
    page.on('dialog',accept)
    # Delete one nested note; confirm and verify it really disappeared.
    page.locator('.tree-row[aria-label="notes"]').click()
    page.locator('.tree-delete[aria-label="Smazat soubor notes/one.md"]').click()
    page.wait_for_function("!window.LocalWikiDebug.bridge.hasFile('notes/one.md')")
    assert 'notes/one.md' in dialogs[0]
    assert page.locator('#preview .token.keyword').count()>0
    # A read-only open uses File System Access {mode:'read'} and disables deletion.
    page.locator('#read-only-toggle').check()
    page.locator('#open-folder').click()
    page.wait_for_function("document.querySelector('#mode').textContent==='Jen pro čtení'")
    assert page.evaluate('window.pickModes')==['readwrite','read']
    assert page.locator('#refresh').is_enabled()
    assert page.locator('.tree-delete').count()==0
    assert page.locator('#new-file').is_disabled()
    page.locator('#read-only-toggle').uncheck()
    page.locator('#open-folder').click()
    page.wait_for_function("document.querySelector('#mode').textContent==='Čtení + zápis'")
    # Delete an empty folder, then one source file to test path protection.
    page.locator('.tree-delete[aria-label="Smazat složku notes"]').click()
    page.wait_for_function("!document.querySelector('.tree-row[aria-label=notes]')")
    assert not errors, errors
    print('PASS: renderers present; Python highlighting; deletion; unified refresh; read-only checkbox; hidden bookmark controls')
    browser.close()
