"""Local UI smoke for user feedback; uses mocked file handles, not real file:// permissions."""
from pathlib import Path
from urllib.parse import unquote, urlsplit
from playwright.sync_api import sync_playwright
R = Path(__file__).resolve().parent.parent

def route(route):
    p=(R/unquote(urlsplit(route.request.url).path).lstrip('/')).resolve()
    if not p.is_relative_to(R) or not p.is_file():
        route.fulfill(status=404,body='Not found'); return
    route.fulfill(status=200, content_type=('text/css' if p.suffix=='.css' else 'application/javascript' if p.suffix=='.js' else 'text/html'), body=p.read_bytes())

def test():
 with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1320,'height':900})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('https://local-wiki.test/**',route)
    html=(R/'index.html').read_text().replace('<head>','<head><base href="https://local-wiki.test/">')
    page.set_content(html,wait_until='load')
    page.evaluate('''() => {
      window.__scrolls=[];
      Element.prototype.scrollIntoView=function(){ window.__scrolls.push(this.textContent); };
      function file(name,text='') {return {name,kind:'file',lastModified:2,
        async getFile(){return new File([text], name,{lastModified:this.lastModified})},
        async createWritable(){return {write:async v=>{this.text=v},close:async()=>{text=this.text;this.lastModified++},abort:async()=>{}}}}}
      function folder(name,initial=[]) {const d=new Map(initial.map(x=>[x.name,x]));return {name,kind:'directory',
        async *values(){yield* d.values()},
        async getDirectoryHandle(n,{create=false}={}){let h=d.get(n);if(!h&&create){h=folder(n);d.set(n,h)}if(!h)throw Error('not found');return h},
        async getFileHandle(n,{create=false}={}){let h=d.get(n);if(!h&&create){h=file(n);d.set(n,h)}if(!h)throw Error('not found');return h},
      }}
      window.__wiki=folder('Wiki',[file('README.md','# Heading\\n\\nAn orange elephant swims.\\n'),folder('notes',[file('Other.md','# Other\\n\\norange tree\\n')])]);
      window.showDirectoryPicker=async()=>window.__wiki;
    }''')
    page.locator('#open-folder').click()
    page.wait_for_function("document.querySelector('#root-name').textContent === 'Wiki'")
    page.locator('#view-preview').click()
    page.locator('[data-side=search]').click()
    page.locator('#fulltext-query').fill('orange')
    page.locator('#fulltext-run').click()
    page.wait_for_function("document.querySelectorAll('.result-item').length > 0")
    page.locator('.result-item').first.click()
    page.wait_for_function("document.querySelector('#preview mark.wiki-search-hit') !== null")
    assert page.locator('#editor-grid').get_attribute('data-layout')=='preview'
    assert 'orange' in page.locator('#preview mark.wiki-search-hit').inner_text().lower()
    page.locator('#theme-select').select_option('dark')
    assert page.locator('html').get_attribute('data-theme')=='dark'
    page.locator('#theme-select').select_option('light')
    assert page.locator('html').get_attribute('data-theme')=='light'
    page.locator('#sidebar-resizer').focus()
    page.keyboard.press('End')
    assert page.locator('#sidebar-resizer').get_attribute('aria-valuenow')=='520'
    page.keyboard.press('Home')
    assert page.locator('#sidebar-resizer').get_attribute('aria-valuenow')=='190'
    page.locator('[data-side=files]').click()
    page.on('dialog', lambda d: d.accept('/NewFolder/sub/beer.md') if d.type == 'prompt' else d.accept())
    page.locator('#new-file').click()
    page.wait_for_function("window.LocalWikiDebug.bridge.hasFile('NewFolder/sub/beer.md')")
    page.locator('.tree-row[aria-label="NewFolder/sub/beer.md"]').click()
    page.wait_for_function("document.querySelector('#filename').textContent==='NewFolder/sub/beer.md'")
    assert not errors,errors
    print('PASS: fulltext keeps preview, preview highlight, light/dark theme, sidebar resizing, nested path creation')
    browser.close()
if __name__=='__main__':test()
