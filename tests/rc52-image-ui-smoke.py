"""End-to-end UI interaction check with local assets and in-memory File System Access handles.
The browser's file:// picker permissions must still be tested on a real Chrome installation.
"""
from pathlib import Path
import argparse
from urllib.parse import urlsplit, unquote
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent

def serve(route):
    parsed=urlsplit(route.request.url)
    asset=(ROOT/unquote(parsed.path).lstrip('/')).resolve()
    if parsed.netloc!='wiki-rc5.test' or not asset.is_relative_to(ROOT) or not asset.is_file():
        route.fulfill(status=404,body='Not found '+parsed.path);return
    media = 'text/css' if asset.suffix=='.css' else 'application/javascript' if asset.suffix=='.js' else 'text/html'
    route.fulfill(status=200,content_type=media,body=asset.read_bytes())

parser = argparse.ArgumentParser(description='RC5 offline UI and drag-and-drop regression')
parser.add_argument('--chromium', default=None, help='Path to Chromium binary for local tests')
options=parser.parse_args()
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=options.chromium,headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1450,'height':900})
    page.set_default_timeout(9000)
    errors=[]; dialogs=[]
    page.on('pageerror',lambda err:errors.append(str(err)))
    def accept(dialog):
        dialogs.append(dialog.message)
        dialog.accept()
    page.on('dialog',accept)
    page.route('**/*',serve)
    html=(ROOT/'index.html').read_text().replace('<head>','<head><base href="https://wiki-rc5.test/">',1)
    page.set_content(html,wait_until='load')
    page.evaluate('''() => {
      function file(name, body, mime='text/plain') {return {kind:'file',name,body,mime,lastModified:100,
        async getFile(){return new File([this.body],name,{type:this.mime,lastModified:this.lastModified})},
        async createWritable(){let bytes='';return {write:async x=>{bytes=x},close:async()=>{this.body=bytes;this.lastModified++},abort:async()=>{}}}
      }}
      function dir(name, contents=[]){const entries=new Map(contents.map(x=>[x.name,x]));return {
        name,kind:'directory',entries,async *values(){yield* entries.values()},
        async getDirectoryHandle(n,{create=false}={}){let child=entries.get(n);if(!child&&create){child=dir(n);entries.set(n,child)}if(!child)throw Error('Missing directory '+n);return child},
        async getFileHandle(n,{create=false}={}){let child=entries.get(n);if(!child&&create){child=file(n,'');entries.set(n,child)}if(!child)throw Error('Missing file '+n);return child},
        async removeEntry(n,{recursive=false}={}){const child=entries.get(n);if(!child)throw Error('Missing');if(child.kind==='directory'&&child.entries.size&&!recursive)throw Error('Not empty');entries.delete(n)}
      }}
      const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/2pEAAAAASUVORK5CYII='),x=>x.charCodeAt(0));
      window.mockWiki=dir('Demo',[file('Intro.md','# Hello'),file('logo.png',png,'image/png'),dir('nested',[file('old.md','# Old')])]);
      window.showDirectoryPicker=async()=>window.mockWiki;
    }''')
    page.locator('#open-folder').click()
    page.wait_for_function("document.querySelector('#root-name').textContent==='Demo'")
    assert page.locator('.tree-row[aria-label="logo.png"]').count()==1
    assert page.locator('#count').inner_text().startswith('2 .md · 1 images')
    # Images are draggable in move mode, with no confirmation and no loss of bytes.
    page.evaluate("window.mockWiki.entries.get('Intro.md').body='![Logo](logo.png) ![[logo.png|200]] [open](logo.png)'")
    original=page.evaluate("Array.from(window.mockWiki.entries.get('logo.png').body)")
    assert page.locator('.tree-row[aria-label="logo.png"]').get_attribute('draggable') is None
    page.locator('#rename-file').click()
    assert page.locator('.tree-row[aria-label="logo.png"]').get_attribute('draggable')=='true'
    current_dialogs=len(dialogs)
    page.locator('.tree-row[aria-label="logo.png"]').drag_to(page.locator('.tree-row[aria-label="nested"]'))
    page.wait_for_function("window.LocalWikiDebug.bridge.hasAsset('nested/logo.png')")
    assert not page.evaluate("window.LocalWikiDebug.bridge.hasAsset('logo.png')")
    assert not page.locator('#move-dialog').evaluate('(e)=>e.open')
    assert len(dialogs)==current_dialogs, dialogs
    actual=page.evaluate("Array.from(window.mockWiki.entries.get('nested').entries.get('logo.png').body)")
    assert actual==original, 'Binary image bytes changed during move'
    assert page.evaluate("window.mockWiki.entries.get('Intro.md').body") ==         '![Logo](nested/logo.png) ![[nested/logo.png|200]] [open](nested/logo.png)'
    # The thumbnail still opens from its new location and can be inserted.
    page.locator('.tree-row[aria-label="nested"]').click()
    page.locator('.tree-row[aria-label="nested/logo.png"]').click()
    page.wait_for_function("document.querySelector('#image-dialog').open && document.querySelector('#image-dialog-preview').src.startsWith('blob:')")
    assert not errors,errors
    print('PASS: image drag-drop, binary integrity, Markdown and Obsidian links, no confirmation, image preview')
    browser.close()
