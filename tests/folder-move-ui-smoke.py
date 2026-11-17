"""Browser regression for safe folder dragging and opt-in trash visibility."""
from pathlib import Path
from urllib.parse import urlsplit, unquote
import argparse
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser()
parser.add_argument('--chromium',default=None)
args=parser.parse_args()

def serve(route):
    url=urlsplit(route.request.url)
    candidate=(ROOT/unquote(url.path).lstrip('/')).resolve()
    if url.netloc!='wiki-folders.test' or not candidate.is_relative_to(ROOT) or not candidate.is_file():
        route.fulfill(status=404,body='missing');return
    mime='text/css' if candidate.suffix=='.css' else 'application/javascript'
    route.fulfill(status=200,content_type=mime,body=candidate.read_bytes())

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path=args.chromium,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1500,'height':950})
    page.set_default_timeout(15000)
    errors=[], dialogs=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    def confirm(d):
        dialogs.append(d.message)
        d.accept()
    page.on('dialog',confirm)
    page.route('https://wiki-folders.test/**',serve)
    html=(ROOT/'index.html').read_text(encoding='utf8').replace('<head>',
      '<head><base href="https://wiki-folders.test/">',1)
    page.set_content(html,wait_until='load')
    page.evaluate("""() => {
      function file(name,body) {return {kind:'file',name,body,lastModified:100,
        async getFile(){return new File([this.body],this.name,{lastModified:this.lastModified})},
        async createWritable(){let next;return {write:async b=>next=b,
          close:async()=>{this.body=next;this.lastModified++},abort:async()=>{}}}
      }}
      function dir(name,items=[]) {
        const entries=new Map(items.map(c=>[c.name,c]));
        return {kind:'directory',name,entries,
          async *values(){yield* entries.values()},
          async getDirectoryHandle(n,{create=false}={}){
            let v=entries.get(n);
            if(!v&&create){v=dir(n);entries.set(n,v)}
            if(!v||v.kind!=='directory')throw Error('No dir '+n);
            return v;
          },
          async getFileHandle(n,{create=false}={}){
            let v=entries.get(n);
            if(!v&&create){v=file(n,'');entries.set(n,v)}
            if(!v||v.kind!=='file')throw Error('No file '+n);
            return v;
          },
          async removeEntry(n,{recursive=false}={}){
            const v=entries.get(n);
            if(!v)throw Error('Missing '+n);
            if(v.kind==='directory'&&v.entries.size&&!recursive)throw Error('Not empty');
            entries.delete(n);
          }
        };
      }
      window.mockWiki=dir('Wiki',[
        file('Main.md','# Main\\n\\n[Project note](Project/Note.md)'),
        dir('Project',[file('Note.md','# Note\\n\\n![binary](secret.xyz)'),
          file('secret.xyz',new Uint8Array([0,255,17,128]))]),
        dir('Archive')
      ]);
      window.showDirectoryPicker=async()=>window.mockWiki;
    }""")
    page.locator('#open-folder').click()
    page.wait_for_function("document.querySelector('#root-name').textContent==='Wiki'")
    assert page.locator('#delete-toggle').is_enabled()
    assert page.locator('#delete-toggle').get_attribute('aria-pressed')=='false'
    page.locator('.tree-row[aria-label="Main.md"]').hover()
    assert not page.locator('#tree-delete-overlay').is_visible()
    page.locator('#delete-toggle').click()
    assert page.locator('#delete-toggle').get_attribute('aria-pressed')=='true'
    assert page.locator('#delete-toggle').evaluate("(e)=>getComputedStyle(e).borderTopColor")=='rgb(84, 178, 115)'
    page.locator('.tree-row[aria-label="Main.md"]').hover()
    assert page.locator('#tree-delete-overlay').is_visible()
    page.locator('#delete-toggle').click()
    assert not page.locator('#tree-delete-overlay').is_visible()
    assert page.locator('#delete-toggle').get_attribute('aria-pressed')=='false'
    page.locator('#rename-file').click()
    page.locator('.tree-row[aria-label="Project"]').drag_to(page.locator('.tree-row[aria-label="Archive"]'))
    page.wait_for_function("window.LocalWikiDebug.bridge.hasFile('Archive/Project/Note.md')")
    assert len(dialogs)>=1 and 'Move Project' in dialogs[0],dialogs
    assert not page.evaluate("window.mockWiki.entries.has('Project')")
    assert page.evaluate("Array.from(window.mockWiki.entries.get('Archive').entries.get('Project').entries.get('secret.xyz').body)") == [0,255,17,128]
    assert 'Archive/Project/Note.md' in page.evaluate("window.mockWiki.entries.get('Main.md').body")
    page.locator('.tree-row[aria-label="Archive"]').click()
    assert page.locator('.tree-row[aria-label="Archive/Project"]').count()==1
    page.locator('#rename-file').click()
    page.locator('#read-only-toggle').check()
    page.locator('#open-folder').click()
    page.wait_for_function("window.LocalWikiDebug.bridge.getMode()==='readonly'")
    assert page.locator('#delete-toggle').is_disabled()
    assert not page.locator('#tree-delete-overlay').is_visible()
    assert not errors,errors
    print('PASS: folder drag/drop moves arbitrary binary files, rewrites source links, keeps trash opt-in')
    browser.close()
