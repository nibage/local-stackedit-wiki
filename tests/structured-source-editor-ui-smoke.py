"""Chromium regression for protected raw Canvas JSON/draw.io XML editing."""
from pathlib import Path
from urllib.parse import urlsplit,unquote
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
diagram=(ROOT/'demo-wiki/Attachments/example.drawio').read_text(encoding='utf-8')

def serve(route):
    url=urlsplit(route.request.url)
    path=(ROOT/unquote(url.path).lstrip('/')).resolve()
    if url.netloc!='wiki-source-mode.test' or not path.is_relative_to(ROOT) or not path.is_file():
        route.fulfill(status=404,body='Not found');return
    mime='text/css' if path.suffix=='.css' else 'application/javascript' if path.suffix=='.js' else 'text/html'
    route.fulfill(status=200,content_type=mime,body=path.read_bytes())

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1450,'height':940})
    page.set_default_timeout(18000)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('**/*',serve)
    html=(ROOT/'index.html').read_text(encoding='utf-8').replace(
        '<head>','<head><base href="https://wiki-source-mode.test/">',1)
    page.set_content(html,wait_until='load')
    page.evaluate("""xml=>{
      function file(name,body){return {name,kind:'file',body,lastModified:100,
        async getFile(){return new File([this.body],name,{lastModified:this.lastModified})},
        async createWritable(){let pending;return {
          write:async value=>{pending=value},
          close:async()=>{this.body=pending;this.lastModified++},
          abort:async()=>{}
        }}
      }};
      const graph={nodes:[{id:'node1',type:'text',text:'Hello canvas',
        x:0,y:0,width:190,height:125}],edges:[]};
      const entries=new Map([file('graph.canvas',JSON.stringify(graph)),
        file('diagram.drawio',xml),file('Readme.md','# Original note')].map(x=>[x.name,x]));
      window.mockWiki={name:'Wiki',kind:'directory',entries,
        async *values(){yield* entries.values()},
        async getFileHandle(name){return entries.get(name)}};
      window.showDirectoryPicker=async()=>window.mockWiki;
    }""",diagram)
    page.locator('#open-folder').click()
    page.wait_for_function("document.querySelector('#root-name').textContent==='Wiki'")
    original_note=page.evaluate("window.mockWiki.entries.get('Readme.md').body")

    page.locator('.tree-row[aria-label="graph.canvas"]').click()
    page.wait_for_function("document.querySelector('#attachment-dialog').open")
    assert page.locator('#attachment-edit-canvas').is_visible()
    assert page.locator('#attachment-edit-canvas').inner_text()=='Interactive edit'
    page.locator('#attachment-edit-canvas-source').wait_for(state='visible')
    page.locator('#attachment-edit-canvas-source').click()
    source=page.locator('.asset-source-editor textarea')
    source.wait_for()
    source.fill(source.input_value().replace('Hello canvas','Edited JSON'))
    page.locator('#attachment-dialog .dialog-actions .asset-footer-save').click()
    page.wait_for_function("document.querySelector('.asset-source-editor .bases-edit-message').textContent.includes('saved safely')")
    assert 'Edited JSON' in page.evaluate("window.mockWiki.entries.get('graph.canvas').body")
    page.locator('#attachment-dialog .dialog-actions .asset-back-to-preview').click()
    page.wait_for_function("document.querySelector('#attachment-dialog .canvas-node')!==null")
    page.locator('#attachment-close').click()

    page.locator('.tree-row[aria-label="diagram.drawio"]').click()
    page.wait_for_function("document.querySelector('#attachment-dialog .drawio-graph')!==null")
    assert page.locator('#attachment-edit-drawio-source').is_visible()
    page.locator('#attachment-edit-drawio-source').click()
    source=page.locator('.asset-source-editor textarea')
    source.wait_for()
    before=source.input_value()
    assert '<mxfile' in before
    source.fill(before.replace('Start','Start via XML',1))
    page.locator('#attachment-dialog .dialog-actions .asset-footer-save').click()
    page.wait_for_function("document.querySelector('.asset-source-editor .bases-edit-message').textContent.includes('saved safely')")
    assert 'Start via XML' in page.evaluate("window.mockWiki.entries.get('diagram.drawio').body")
    # Bad XML must be refused before any disk write.
    source.fill('<!DOCTYPE unsafe>'+source.input_value())
    page.locator('#attachment-dialog .dialog-actions .asset-footer-save').click()
    page.wait_for_function("document.querySelector('.asset-source-editor .bases-edit-message').textContent.includes('Save failed')")
    assert '<!DOCTYPE' not in page.evaluate("window.mockWiki.entries.get('diagram.drawio').body")
    page.locator('#attachment-close').click()
    assert page.locator('#attachment-dialog').evaluate('(el)=>el.open')
    confirmation=page.locator('#attachment-dialog .dialog-actions .bases-edit-confirm')
    assert confirmation.is_visible()
    assert confirmation.locator('button').count()==2
    assert 'Discard changes' in confirmation.inner_text()
    assert 'Save changes' in confirmation.inner_text()
    assert confirmation.locator('.asset-confirm-save').count()==1
    assert 'asset-exit-pending' in (page.locator('#attachment-close').get_attribute('class') or '')
    page.locator('#attachment-dialog .dialog-actions .bases-edit-confirm button',has_text='Discard changes').click()
    page.wait_for_function("!document.querySelector('#attachment-dialog').open")
    assert page.evaluate("window.mockWiki.entries.get('Readme.md').body")==original_note
    assert not errors,errors
    print('PASS: safe Canvas JSON and draw.io XML editing, validation, save, preview and close guards')
    browser.close()
