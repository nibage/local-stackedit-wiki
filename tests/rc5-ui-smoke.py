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
    # New folder must not open a native prompt: inline input appears immediately.
    page.locator('#new-folder').click()
    inline=page.locator('.tree-name-input')
    assert inline.count()==1
    inline.fill('Recipes')
    inline.press('Enter')
    page.wait_for_function("document.querySelector('.tree-row[aria-label=Recipes]') !== null")
    # Select new folder (click collapses it); new file must appear within it.
    page.locator('.tree-row[aria-label="Recipes"]').click()
    page.locator('#new-file').click()
    inline=page.locator('.tree-name-input')
    inline.fill('Beer')
    inline.press('Enter')
    try:
        page.wait_for_function("window.LocalWikiDebug.bridge.hasFile('Recipes/Beer.md')",timeout=4000)
    except Exception:
        print('create file debug',page.locator('#notice').inner_text(),page.evaluate('window.LocalWikiDebug.bridge.getFilePaths()'),page.locator('#tree').inner_text(),errors,flush=True)
        raise
    page.wait_for_function("document.querySelector('#filename').textContent==='Recipes/Beer.md'")
    # Double-click rename edits just the basename directly inside the tree.
    page.locator('.tree-row[aria-label="Recipes/Beer.md"]').dblclick()
    inline=page.locator('.tree-name-input')
    assert inline.count()==1
    inline.fill('Beer-notes')
    inline.press('Enter')
    try:
        page.wait_for_function("window.LocalWikiDebug.bridge.hasFile('Recipes/Beer-notes.md')", timeout=7000)
    except Exception:
        print('rename failed',page.locator('#notice').inner_text(),page.evaluate('window.LocalWikiDebug.bridge.getFilePaths()'), 'dialogs=', dialogs, 'errors=',errors)
        raise
    assert page.locator('#filename').inner_text()=='Recipes/Beer-notes.md'
    # The explicit toggle enables drag and drop only in read/write mode.
    assert page.locator('.topbar #read-only-toggle').bounding_box()['x'] < page.locator('.topbar #open-folder').bounding_box()['x']
    assert page.locator('#read-only-toggle').locator('xpath=..').inner_text().strip()=='Open read-only'
    assert page.locator('#side-files .file-actions > #rename-file').count()==1
    assert page.locator('.editor-bar .editor-actions > #refresh').count()==1
    assert page.locator('#rename-file').get_attribute('aria-pressed')=='false'
    assert not page.locator('.tree-row[aria-label="Recipes/Beer-notes.md"]').get_attribute('draggable')=='true'
    page.evaluate("document.documentElement.style.setProperty('--sidebar-width','190px')")
    assert page.locator('.file-actions').evaluate('el=>el.scrollWidth <= el.clientWidth')
    assert page.locator('.file-actions button').evaluate_all('els=>els.every(el=>el.scrollWidth <= el.clientWidth)')
    page.locator('#rename-file').click()
    assert page.locator('#rename-file').get_attribute('aria-pressed')=='true'
    assert page.locator('#rename-file').evaluate('(el)=>getComputedStyle(el).borderTopColor')=='rgb(84, 178, 115)'
    assert 'Drag and drop' in page.locator('#rename-file').get_attribute('title')
    assert page.locator('.tree-row[aria-label="Recipes/Beer-notes.md"]').get_attribute('draggable')=='true'
    # Drop onto wiki root. It must only PREPARE the move dialog, not mutate files.
    page.locator('.tree-row[aria-label="Recipes/Beer-notes.md"]').drag_to(page.locator('.tree-row[aria-label="Demo"]'))
    page.wait_for_function("document.querySelector('#move-dialog').open")
    assert page.locator('#move-destination').input_value() == 'Beer-notes.md'
    assert page.evaluate("window.LocalWikiDebug.bridge.hasFile('Recipes/Beer-notes.md')")
    page.locator('#move-cancel').click()
    assert page.evaluate("window.LocalWikiDebug.bridge.hasFile('Recipes/Beer-notes.md')")
    # Drop again and explicitly confirm the destination.
    page.locator('.tree-row[aria-label="Recipes/Beer-notes.md"]').drag_to(page.locator('.tree-row[aria-label="Demo"]'))
    page.wait_for_function("document.querySelector('#move-dialog').open")
    page.locator('#move-form button[type="submit"]').click()
    page.wait_for_function("window.LocalWikiDebug.bridge.hasFile('Beer-notes.md')")
    assert not page.evaluate("window.LocalWikiDebug.bridge.hasFile('Recipes/Beer-notes.md')")
    assert page.locator('#filename').inner_text()=='Beer-notes.md'
    # Toggle OFF: no native drag behavior.
    page.locator('#rename-file').click()
    assert page.locator('#rename-file').get_attribute('aria-pressed')=='false'
    assert not page.locator('.tree-row[aria-label="Beer-notes.md"]').get_attribute('draggable')=='true'
    # Image preview and Markdown insertion from the tree.
    page.locator('.tree-row[aria-label="logo.png"]').click()
    page.wait_for_function("document.querySelector('#image-dialog').open && document.querySelector('#image-dialog-preview').src.startsWith('blob:')")
    page.locator('#image-insert').click()
    page.wait_for_function("window.LocalWikiDebug.editor.getValue().includes('![logo](logo.png)')")
    assert page.locator('#image-dialog').evaluate('(el)=>el.open') is False
    # Palettes and green tab border taken from user's screenshots.
    page.locator('#theme-select').select_option('dark')
    assert page.locator('html').get_attribute('data-theme')=='dark'
    assert page.locator('.topbar').evaluate('(e)=>getComputedStyle(e).borderBottomColor')=='rgb(246, 166, 34)'
    assert page.locator('.sidebar-tabs .active').evaluate('(e)=>getComputedStyle(e).borderTopColor')=='rgb(88, 163, 106)'
    page.locator('#theme-select').select_option('light')
    assert page.locator('.topbar').evaluate('(e)=>getComputedStyle(e).backgroundColor')=='rgb(137, 25, 40)'
    assert page.locator('#move-dialog').count()==1
    # Open in read-only mode; drag & drop must become unavailable.
    page.locator('#read-only-toggle').check()
    page.locator('#open-folder').click()
    page.wait_for_function("window.LocalWikiDebug.bridge.getMode()==='readonly'")
    assert page.locator('#rename-file').is_disabled()
    assert page.locator('#rename-file').get_attribute('aria-pressed')=='false'
    assert not errors,errors
    print('PASS RC5: English UI, checkbox order, move toggle, drag/drop modal cancel/confirm, read-only, inline creation/rename, images, themes')
    browser.close()
