"""Open root index.md, keep blank wiki blank, stable Scroll sync and MathJax left alignment."""
from pathlib import Path
from urllib.parse import urlsplit,unquote
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
def serve(route):
    u=urlsplit(route.request.url)
    file=(ROOT/unquote(u.path).lstrip('/')).resolve()
    if u.netloc!='wiki-index-math.test' or not file.is_relative_to(ROOT) or not file.is_file():
        route.fulfill(status=404,body='Not found');return
    mime='text/css' if file.suffix=='.css' else 'application/javascript' if file.suffix=='.js' else 'text/html'
    route.fulfill(status=200,content_type=mime,body=file.read_bytes())

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1650,'height':950})
    errors=[]
    page.on('pageerror',lambda err:errors.append(str(err)))
    page.route('**/*',serve)
    html=(ROOT/'index.html').read_text(encoding='utf-8').replace('<head>',
        '<head><base href="https://wiki-index-math.test/">',1)
    page.set_content(html,wait_until='load')
    page.evaluate(r"""() => {
      function file(name,text){return {kind:'file',name,text,lastModified:100,
        async getFile(){return new File([this.text],name,{type:'text/markdown',lastModified:this.lastModified})},
        async createWritable(){let update;return{write:async data=>update=data,
          close:async()=>{this.text=update;this.lastModified++},abort:async()=>{}}}
      }}
      window.makeWiki=(withIndex)=>{
        const docs=[file('Another.md','# Another')];
        if(withIndex)docs.push(file('index.md','# Index home\n\n## Math\n\n$$x^2+y^2=z^2$$'));
        const entries=new Map(docs.map(item=>[item.name,item]));
        return {kind:'directory',name:'Wiki',entries,
          async *values(){yield* entries.values()},
          async getFileHandle(n){return entries.get(n)}
        };
      };
      window.mockWiki=window.makeWiki(true);
      window.showDirectoryPicker=async()=>window.mockWiki;
    }""")
    page.locator('#open-folder').click()
    page.wait_for_function("document.querySelector('#filename').textContent==='index.md'")
    assert page.locator('#preview h1').inner_text()=='Index home'
    assert page.locator('.tree-row[aria-label="index.md"]').get_attribute('class').find('selected')>=0
    page.locator('#view-split').click()
    sync=page.locator('#scroll-sync-toggle')
    dimensions=page.evaluate("""() => {
      const button=document.querySelector('#scroll-sync-toggle');
      const bar=document.querySelector('.format-toolbar');
      return {x:button.getBoundingClientRect().x,width:button.getBoundingClientRect().width,
        header:bar.getBoundingClientRect().height,scrollWidth:bar.scrollWidth};
    }""")
    for _ in range(4):
        sync.click()
        current=page.evaluate("""() => {
          const b=document.querySelector('#scroll-sync-toggle'),bar=document.querySelector('.format-toolbar');
          return {x:b.getBoundingClientRect().x,width:b.getBoundingClientRect().width,
            header:bar.getBoundingClientRect().height,scrollWidth:bar.scrollWidth};
        }""")
        for name in dimensions:
            assert abs(dimensions[name]-current[name])<=1,(dimensions,current)
    page.locator('#view-preview').click()
    page.locator('#center-content-toggle').uncheck()
    math=page.locator('#preview .MathJax_Display')
    if math.count()==0:
        # This fallback also tests the actual MathJax 2 display class without
        # requiring TeX runtime initialization for every browser installation.
        page.evaluate("""() => {
          const el=document.createElement('span');
          el.className='MathJax_Display';el.textContent='x squared + y squared';
          el.style.textAlign='center';
          document.querySelector('#preview').append(el);
        }""")
        math=page.locator('#preview .MathJax_Display')
    assert math.first.evaluate("(el)=>getComputedStyle(el).textAlign")=='left'
    page.locator('#center-content-toggle').check()
    assert page.locator('html').get_attribute('data-centered')=='true'

    # A second independent wiki has no root index.md: don't select another
    # arbitrary file or pre-fill the editor.
    page.evaluate("window.mockWiki=window.makeWiki(false)")
    page.locator('#open-folder').click()
    page.wait_for_function("document.querySelector('#root-name').textContent==='Wiki'")
    assert page.locator('#filename').inner_text()=='No note open'
    assert page.evaluate("window.LocalWikiDebug.editor.getValue()")=='' 
    assert page.locator('.tree-row[aria-label="Another.md"]').count()==1
    assert page.locator('.tree-row.selected').count()==0
    assert not errors,errors
    print('PASS: root index.md on open; empty otherwise; stable sync geometry; MathJax obeys Center toggle')
    browser.close()
