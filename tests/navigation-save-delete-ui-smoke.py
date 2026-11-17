"""Browser regression: safe autosave on navigation and themed delete modal."""
import argparse
from pathlib import Path
from urllib.parse import urlsplit, unquote
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser()
parser.add_argument('--chromium', default=None)
args=parser.parse_args()

def serve(route):
    parsed=urlsplit(route.request.url)
    f=(ROOT/unquote(parsed.path).lstrip('/')).resolve()
    if parsed.netloc!='wiki-safe.test' or not f.is_relative_to(ROOT) or not f.is_file():
        route.fulfill(status=404,body='missing');return
    mime='text/css' if f.suffix=='.css' else 'application/javascript'
    route.fulfill(status=200,content_type=mime,body=f.read_bytes())

with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1380,'height':850})
    page.set_default_timeout(15000)
    errors=[];native_dialogs=[]
    page.on('pageerror', lambda err: errors.append(str(err)))
    page.on('dialog', lambda d: (native_dialogs.append(d.message),d.dismiss()))
    page.route('https://wiki-safe.test/**',serve)
    html=(ROOT/'index.html').read_text(encoding='utf-8').replace(
      '<head>','<head><base href="https://wiki-safe.test/">',1)
    page.set_content(html,wait_until='load')
    page.evaluate("""() => {
      function file(name,body) {return {
        kind:'file',name,body,lastModified:110,failWrite:false,
        async getFile(){return new File([this.body],name,{lastModified:this.lastModified})},
        async createWritable(){
          let value;
          return {write:async v=>{if(this.failWrite)throw Error('Simulated disk write error');value=v},
            close:async()=>{this.body=value;this.lastModified++},abort:async()=>{}};
        }
      }}
      function dir(name,children=[]){
        const entries=new Map(children.map(x=>[x.name,x]));
        return {kind:'directory',name,entries,
          async *values(){yield* entries.values()},
          async getDirectoryHandle(n){const x=entries.get(n);
            if(!x||x.kind!=='directory')throw Error('Missing folder '+n);return x},
          async getFileHandle(n){const x=entries.get(n);
            if(!x||x.kind!=='file')throw Error('Missing file '+n);return x},
          async removeEntry(n,{recursive=false}={}){
            const x=entries.get(n);if(!x)throw Error('Missing entry '+n);
            if(x.kind==='directory'&&x.entries.size&&!recursive)throw Error('Not empty');
            entries.delete(n);
          }
        }
      }
      window.mockWiki=dir('Wiki',[
        file('A.md','# First note'),
        file('B.md','# Second note'),
        dir('Folder',[file('Child.md','# Important child')])
      ]);
      window.showDirectoryPicker=async()=>window.mockWiki;
    }""")
    page.locator('#open-folder').click()
    page.wait_for_function("document.querySelector('#root-name').textContent==='Wiki'")
    page.locator('.tree-row[aria-label="A.md"]').click()
    page.wait_for_function("document.querySelector('#filename').textContent==='A.md'")
    page.evaluate("""() => window.LocalWikiDebug.editor.cm.replaceRange(
      '\\n\\nA modification that must be saved on navigation',
      {line:0,ch:12})""")
    page.locator('.tree-row[aria-label="B.md"]').click()
    page.wait_for_function("document.querySelector('#filename').textContent==='B.md'")
    assert 'A modification that must be saved' in page.evaluate(
        "window.mockWiki.entries.get('A.md').body")
    assert not native_dialogs, native_dialogs

    # A write conflict/error must block navigation instead of losing text.
    page.evaluate("""() => {
      window.mockWiki.entries.get('B.md').failWrite=true;
      window.LocalWikiDebug.editor.cm.replaceRange('\\n\\nNot yet saved', {line:0,ch:13});
    }""")
    page.locator('.tree-row[aria-label="A.md"]').click()
    page.wait_for_function("document.querySelector('#notice').textContent.includes('Cannot switch notes')")
    assert page.locator('#filename').inner_text()=='B.md'
    assert 'Not yet saved' in page.evaluate("window.LocalWikiDebug.editor.cm.getValue()")
    assert 'Not yet saved' not in page.evaluate("window.mockWiki.entries.get('B.md').body")
    assert not native_dialogs, native_dialogs
    page.evaluate("window.mockWiki.entries.get('B.md').failWrite=false")
    page.locator('.tree-row[aria-label="A.md"]').click()
    page.wait_for_function("document.querySelector('#filename').textContent==='A.md'")
    assert 'Not yet saved' in page.evaluate("window.mockWiki.entries.get('B.md').body")

    # A disabled Delete toggle leaves no green border/shadow or focus line.
    page.locator('#delete-toggle').click()
    assert page.locator('#delete-toggle').get_attribute('aria-pressed')=='true'
    page.locator('#delete-toggle').click()
    assert page.locator('#delete-toggle').get_attribute('aria-pressed')=='false'
    inactive=page.locator('#delete-toggle').evaluate("""e=>({
      shadow:getComputedStyle(e).boxShadow,
      border:getComputedStyle(e).borderBottomColor,
      outline:getComputedStyle(e).outlineStyle
    })""")
    assert inactive['shadow']=='none',inactive
    assert inactive['border']!='rgb(84, 178, 115)',inactive
    assert inactive['outline']=='none',inactive

    # No browser confirm alert: show a branded, centered modal.
    page.locator('#delete-toggle').click()
    page.locator('.tree-row[aria-label="B.md"]').hover()
    page.locator('#tree-delete-overlay').click()
    page.wait_for_function("document.querySelector('#delete-dialog').open")
    assert page.locator('#delete-dialog').is_visible()
    assert 'B.md' in page.locator('#delete-dialog-path').inner_text()
    assert page.locator('#delete-dialog').evaluate("""e=>{
      const r=e.getBoundingClientRect();
      return Math.abs((r.top+r.bottom)/2-window.innerHeight/2)<3 &&
             Math.abs((r.left+r.right)/2-window.innerWidth/2)<3;
    }""")
    assert not native_dialogs,native_dialogs
    page.locator('#delete-dialog-cancel').click()
    assert page.evaluate("window.mockWiki.entries.has('B.md')")

    # Delete note only after explicit confirmation.
    page.locator('.tree-row[aria-label="B.md"]').hover()
    page.locator('#tree-delete-overlay').click()
    page.wait_for_function("document.querySelector('#delete-dialog').open")
    page.locator('#delete-dialog-confirm').click()
    page.wait_for_function("!window.mockWiki.entries.has('B.md')")
    assert not page.locator('#delete-dialog').is_visible()

    # A nonempty folder requires a second acknowledgement in the same dialog.
    page.locator('.tree-row[aria-label="Folder"]').hover()
    page.locator('#tree-delete-overlay').click()
    page.wait_for_function("document.querySelector('#delete-dialog').open")
    assert page.locator('#delete-dialog-confirm').is_disabled()
    assert page.locator('#delete-dialog-ack-group').is_visible()
    page.locator('#delete-dialog-ack').check()
    assert page.locator('#delete-dialog-confirm').is_enabled()
    page.locator('#delete-dialog-confirm').click()
    page.wait_for_function("!window.mockWiki.entries.has('Folder')")
    assert not native_dialogs,native_dialogs
    assert not errors,errors
    print('PASS: save-before-switch, failed save blocks navigation, centered delete modal, folder acknowledgement and no green remnant')
    browser.close()
