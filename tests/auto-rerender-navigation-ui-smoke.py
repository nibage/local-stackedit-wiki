"""Back button in shared toolbar, link tree expansion, manual/auto preview render."""
from pathlib import Path
from urllib.parse import urlsplit,unquote
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
def serve(route):
    u=urlsplit(route.request.url)
    p=(ROOT/unquote(u.path).lstrip('/')).resolve()
    if u.netloc!='wiki-auto-render.test' or not p.is_relative_to(ROOT) or not p.is_file():
        route.fulfill(status=404,body='Not found');return
    mime='text/css' if p.suffix=='.css' else 'application/javascript' if p.suffix=='.js' else 'text/html'
    route.fulfill(status=200,content_type=mime,body=p.read_bytes())

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1520,'height':960})
    page.set_default_timeout(13000)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('**/*',serve)
    html=(ROOT/'index.html').read_text(encoding='utf-8').replace('<head>',
        '<head><base href="https://wiki-auto-render.test/">',1)
    page.set_content(html,wait_until='load')
    page.evaluate(r"""() => {
      function file(name,text){return {kind:'file',name,text,lastModified:50,
        async getFile(){return new File([this.text],name,{type:'text/markdown',lastModified:this.lastModified})},
        async createWritable(){let next;return{
          write:async data=>{next=data},
          close:async()=>{this.text=next;this.lastModified++},abort:async()=>{}
        }}
      }}
      const inner=new Map([file('Other.md','# Other note\n\n## Deep section\n\nSecond note')].map(f=>[f.name,f]));
      const docs={kind:'directory',name:'Docs',entries:inner,
        async *values(){yield* inner.values()},
        async getFileHandle(n){return inner.get(n)}
      };
      const home=file('Home.md','# Home\n\n[Open other](Docs/Other.md)\n\nText.');
      const entries=new Map([[home.name,home],['Docs',docs]]);
      window.mockWiki={kind:'directory',name:'Wiki',entries,
        async *values(){yield* entries.values()},
        async getFileHandle(n){return entries.get(n)},
        async getDirectoryHandle(n){return entries.get(n)}
      };
      window.showDirectoryPicker=async()=>window.mockWiki;
    }""")
    assert not page.locator('#toolbar-back').is_visible()
    assert page.locator('#auto-rerender-toggle').is_checked()
    assert page.locator('#rerender-status').inner_text()=='Auto re-render 3s'
    page.locator('#open-folder').click()
    page.wait_for_function("document.querySelector('#root-name').textContent==='Wiki'")
    page.locator('.tree-row[aria-label="Home.md"]').click()
    page.wait_for_function("document.querySelector('#filename').textContent==='Home.md'")
    page.locator('#view-preview').click()
    page.locator('#preview a',has_text='Open other').click()
    page.wait_for_function("document.querySelector('#filename').textContent==='Docs/Other.md'")
    assert page.locator('#editor-grid').get_attribute('data-layout')=='preview'
    assert page.locator('#side-files').is_visible()
    assert page.locator('.tree-row[aria-label="Docs/Other.md"]').is_visible()
    assert 'selected' in (page.locator('.tree-row[aria-label="Docs/Other.md"]').get_attribute('class') or '')
    assert page.locator('#toolbar-back').is_visible()
    assert page.locator('#toolbar-back').bounding_box()['x']<page.locator('#center-content-toggle').bounding_box()['x']
    page.locator('#toolbar-back').click()
    page.wait_for_function("document.querySelector('#filename').textContent==='Home.md'")
    assert not page.locator('#toolbar-back').is_visible()
    assert page.locator('#editor-grid').get_attribute('data-layout')=='preview'

    page.locator('#view-edit').click()
    assert page.locator('#render-now').is_enabled()
    page.locator('#auto-rerender-toggle').uncheck()
    assert page.locator('#rerender-status').inner_text()=='Auto re-render: Off'
    page.evaluate("""() => {
      const cm=window.LocalWikiDebug.editor.cm;
      cm.replaceRange('\n\n## Rendered manually\n\nNew paragraph.',{line:cm.lastLine(),ch:cm.getLine(cm.lastLine()).length});
    }""")
    assert 'Rendered manually' not in page.locator('#preview').inner_text()
    page.wait_for_timeout(3300)
    assert 'Rendered manually' not in page.locator('#preview').inner_text()
    assert 'Preview paused' in page.locator('#render-status').inner_text()
    page.locator('#render-now').click()
    page.wait_for_function("document.querySelector('#preview').textContent.includes('Rendered manually')")
    assert page.locator('#filename').inner_text()=='Home.md'
    # Re-enable automatic previews and exercise the actual 3s debounce.
    page.locator('#auto-rerender-toggle').check()
    page.evaluate("""() => {
      const cm=window.LocalWikiDebug.editor.cm;
      cm.replaceRange('\n\n## Rendered automatically',{line:cm.lastLine(),ch:cm.getLine(cm.lastLine()).length});
    }""")
    page.wait_for_function("document.querySelector('#preview').textContent.includes('Rendered automatically')",timeout=6000)
    assert page.locator('#rerender-status').inner_text()=='Auto re-render 3s'
    assert not errors,errors
    print('PASS: history toolbar Back, expanded selected tree route, and manual/automatic 3-second preview')
    browser.close()
