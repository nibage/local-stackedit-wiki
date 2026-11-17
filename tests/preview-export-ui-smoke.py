"""Chromium smoke: green layout state and self-contained HTML / native print-to-PDF flow."""
from pathlib import Path
from urllib.parse import urlsplit,unquote
from playwright.sync_api import sync_playwright
import base64

ROOT=Path(__file__).resolve().parent.parent
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+xpe8AAAAASUVORK5CYII=')

def serve(route):
    parsed=urlsplit(route.request.url)
    path=(ROOT/unquote(parsed.path).lstrip('/')).resolve()
    if parsed.netloc!='wiki-export.test' or not path.is_relative_to(ROOT) or not path.is_file():
        route.fulfill(status=404,body='Not found')
        return
    mime='text/css' if path.suffix=='.css' else 'application/javascript' if path.suffix=='.js' else 'text/html'
    route.fulfill(status=200,content_type=mime,body=path.read_bytes())

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
    context=browser.new_context(accept_downloads=True,viewport={'width':1540,'height':960})
    context.add_init_script("window.print=()=>{window.__wikiPrintInvoked=true;};")
    page=context.new_page()
    page.set_default_timeout(16000)
    errors=[];unexpected=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('**/*',lambda route: (unexpected.append(route.request.url),route.abort())
               if urlsplit(route.request.url).netloc!='wiki-export.test' else serve(route))
    html=(ROOT/'index.html').read_text(encoding='utf-8').replace(
        '<head>','<head><base href="https://wiki-export.test/">',1)
    page.set_content(html,wait_until='load')
    page.evaluate("""(png) => {
      function file(name,data,mime) {return {kind:'file',name,data,mime,lastModified:100,
        async getFile(){return new File([this.data],name,{type:this.mime,lastModified:this.lastModified})},
        async createWritable(){throw Error('No writes expected')}
      }}
      const text='# Preview export heading\\n\\nHello **world** with a local image.\\n\\n![[photo.png]]\\n\\n| Name | Value |\\n| --- | --- |\\n| Alpha | 42 |\\n\\n> A quoted sentence.';
      const entries=new Map([
        file('Preview.md',text,'text/markdown'),
        file('photo.png',Uint8Array.from(atob(png),x=>x.charCodeAt(0)),'image/png')
      ].map(item=>[item.name,item]));
      window.mockWiki={kind:'directory',name:'Wiki',entries,
        async *values(){yield* entries.values()},
        async getFileHandle(name){return entries.get(name)}
      };
      window.showDirectoryPicker=async()=>window.mockWiki;
    }""",base64.b64encode(PNG).decode())
    # No export until a real note is open.
    assert page.locator('#preview-export-toggle').is_disabled()
    page.locator('#open-folder').click()
    page.wait_for_function("document.querySelector('#root-name').textContent==='Wiki'")
    page.locator('.tree-row[aria-label="Preview.md"]').click()
    page.wait_for_function("document.querySelector('#filename').textContent==='Preview.md'")
    page.wait_for_function("document.querySelector('#preview img[src^=\"blob:\"]')?.complete")
    assert page.locator('#preview-export-toggle').is_enabled()

    for value,selector in [('edit','#view-edit'),('split','#view-split'),('preview','#view-preview')]:
        page.locator(selector).click()
        assert page.locator(selector).get_attribute('aria-pressed')=='true'
        active=page.evaluate("""() => [...document.querySelectorAll('.view-switch button')]
          .filter(b=>b.getAttribute('aria-pressed')==='true').length""")
        assert active==1
        border=page.locator(selector).evaluate("(el)=>getComputedStyle(el).borderTopColor")
        assert border=='rgb(88, 163, 106)',(value,border)
    # Export is a split arrow directly beside Preview, not in the pane title.
    assert page.locator('#view-preview + .preview-export-menu #preview-export-toggle').count()==1
    assert page.locator('.preview-pane .preview-export-toggle').count()==0
    assert page.locator('.view-switch .preview-view-action').count()==1
    page.locator('#theme-select').select_option('dark')
    assert page.locator('html').get_attribute('data-theme')=='dark'
    # Export popup opening/closing may not change the preview pane height.
    pane_height_before=page.locator('.preview-pane .pane-title').bounding_box()['height']
    # Export arrow is in the view switch, not the right preview header.
    page.locator('#preview-export-toggle').click()
    assert page.locator('#preview-export-options').is_visible()
    assert page.locator('#preview-export-toggle').get_attribute('aria-expanded')=='true'
    page.locator('#preview-export-html').press('Escape')
    assert not page.locator('#preview-export-options').is_visible()
    assert page.locator('.preview-pane .pane-title').bounding_box()['height']==pane_height_before

    page.locator('#preview-export-toggle').click()
    with page.expect_download() as capture:
        page.locator('#preview-export-html').click()
    download=capture.value
    assert download.suggested_filename=='Preview.html'
    exported=Path(download.path()).read_text(encoding='utf-8')
    assert 'Preview export heading' in exported
    assert 'Hello' in exported and 'world' in exported
    assert 'data:image/png;base64,' in exported
    assert 'border-top' in exported or 'font-family' in exported
    assert 'blob:' not in exported
    assert '<script' not in exported.lower()
    assert 'src="https:' not in exported
    assert 'http-equiv="refresh"' not in exported
    # Generated HTML can be opened as a completely standalone document.
    offline=context.new_page()
    standalone_requests=[]
    offline.route('**/*',lambda route:(standalone_requests.append(route.request.url),route.abort()))
    offline.set_content(exported,wait_until='load')
    assert offline.locator('h1').first.inner_text()=='Preview export heading'
    assert offline.locator('img').first.evaluate("(el)=>el.complete && el.naturalWidth>0")
    assert offline.locator('table td').count()==2
    html_theme=offline.locator('main').evaluate('(el)=>getComputedStyle(el).backgroundColor')
    assert html_theme!='rgb(255, 255, 255)',html_theme
    assert not standalone_requests,standalone_requests
    offline.close()

    page.locator('#preview-export-toggle').click()
    with context.expect_page() as new_tab:
        page.locator('#preview-export-pdf').click()
    printable=new_tab.value
    printable.wait_for_load_state('domcontentloaded')
    printable.wait_for_function("document.querySelector('h1')?.textContent==='Preview export heading'")
    printable.wait_for_function("window.__wikiPrintInvoked===true")
    pdf_background=printable.locator('main').evaluate('(el)=>getComputedStyle(el).backgroundColor')
    assert pdf_background=='rgb(255, 255, 255)',(pdf_background,printable.locator('main').get_attribute('style'))
    assert page.locator('html').get_attribute('data-theme')=='dark'
    assert printable.locator('img').count()==1
    assert printable.locator('img').first.get_attribute('src').startswith('data:image/png;base64,')
    # Chromium's print backend generates a real PDF from the same document.
    pdf=printable.pdf(print_background=True,format='A4')
    assert pdf.startswith(b'%PDF') and len(pdf)>3500,len(pdf)
    printable.close()
    assert not errors,errors
    assert not unexpected,unexpected
    print('PASS: green mode selection, HTML inline assets, offline re-open and printable PDF')
    context.close()
    browser.close()
