"""Opt-in bookmark UI smoke. Simulates File System Access + saved directory handle.
The test does not prove actual file:// permissions or persistence across a browser restart.
"""
from pathlib import Path
from urllib.parse import urlsplit, unquote
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent

def route_local(route):
    rel=unquote(urlsplit(route.request.url).path).lstrip('/')
    target=(ROOT/rel).resolve()
    if not target.is_relative_to(ROOT) or not target.is_file():
        route.fulfill(status=404,body='Not found');return
    mime='text/css' if target.suffix=='.css' else 'application/javascript' if target.suffix=='.js' else 'text/html'
    route.fulfill(status=200,content_type=mime,body=target.read_bytes())

def main():
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        page=browser.new_page(viewport={'width':1440,'height':880})
        errors=[]
        page.on('pageerror',lambda e: errors.append(str(e)))
        page.route('https://local-wiki.test/**',route_local)
        html=(ROOT/'index.html').read_text(encoding='utf8').replace('<head>','<head><base href="https://local-wiki.test/">')
        page.set_content(html, wait_until='load')
        page.evaluate('''() => {
          window.bookmark=null;window.permissionRequests=0;window.rememberCalls=0;
          window.LocalWikiRecent.remember=async h=>{window.bookmark=h;window.rememberCalls++;};
          window.LocalWikiRecent.restoreHandle=async()=>window.bookmark;
          window.LocalWikiRecent.forget=async()=>{window.bookmark=null;};
          window.LocalWikiRecent.ensurePermission=async (h,prompt)=>{
             if(prompt)window.permissionRequests++;return !!window.permissionGranted;
          };
          const md={kind:'file',name:'test.md',async getFile(){return new File(['# Test'], 'test.md',{lastModified:1});}};
          window.root={kind:'directory',name:'MojeWiki',async *values(){yield md;}};
          window.showDirectoryPicker=async()=>window.root;
          window.permissionGranted=true;
        }''')
        assert page.locator('#restore-last').is_disabled()
        assert not page.locator('#remember-root').is_checked()
        page.locator('#open-folder').click()
        page.wait_for_function("() => document.querySelector('#root-name').textContent==='MojeWiki'")
        assert page.evaluate('window.rememberCalls')==0, 'unexpected implicit bookmark'
        page.locator('#remember-root').check()
        page.locator('#open-folder').click()
        page.wait_for_function('() => window.rememberCalls===1')
        assert page.locator('#restore-last').is_enabled()
        assert page.locator('#forget-last').is_enabled()
        # Denied permission keeps open root data untouched; user is notified.
        page.evaluate('window.permissionGranted=false')
        page.locator('#restore-last').click()
        page.wait_for_function("() => document.querySelector('#notice').textContent.includes('neudělil přístup')")
        assert page.locator('#root-name').inner_text()=='MojeWiki'
        page.evaluate('window.permissionGranted=true')
        page.locator('#restore-last').click()
        page.wait_for_function("() => document.querySelector('#notice').textContent.includes('Poslední wiki byla')")
        assert page.evaluate('window.permissionRequests')==2
        page.locator('#forget-last').click()
        page.wait_for_function('() => window.bookmark===null')
        assert page.locator('#restore-last').is_disabled()
        assert page.locator('#root-name').inner_text()=='MojeWiki'
        assert not errors,errors
        print('PASS: optional bookmark, denial, reauthorization, restore, forget, unchanged open wiki')
        browser.close()

if __name__=='__main__':main()
