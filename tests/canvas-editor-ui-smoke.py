"""Chromium Canvas editing smoke: offline Save, Undo/Redo, Discard and conflict protection."""
from pathlib import Path
from urllib.parse import urlsplit, unquote
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent

def serve(route):
    parsed=urlsplit(route.request.url)
    file=(ROOT/unquote(parsed.path).lstrip('/')).resolve()
    if parsed.netloc!='wiki-canvas-edit.test' or not file.is_relative_to(ROOT) or not file.is_file():
        route.fulfill(status=404,body='Not found')
        return
    mime='text/css' if file.suffix=='.css' else 'application/javascript' if file.suffix=='.js' else 'text/html'
    route.fulfill(status=200,content_type=mime,body=file.read_bytes())

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1420,'height':950})
    errors=[]
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.set_default_timeout(15000)
    page.route('**/*',serve)
    html=(ROOT/'index.html').read_text(encoding='utf-8').replace(
        '<head>','<head><base href="https://wiki-canvas-edit.test/">',1)
    page.set_content(html,wait_until='load')
    page.evaluate("""() => {
      function file(name,body) {
        return {kind:'file',name,body,lastModified:100,
          async getFile(){return new File([this.body],name,{type:'application/json',lastModified:this.lastModified})},
          async createWritable(){let next;return{
            write:async value=>{next=value},
            close:async()=>{this.body=next;this.lastModified++},abort:async()=>{}
          }}
        };
      }
      const initial={future:{keep:'yes'},nodes:[
        {id:'a',type:'text',text:'Original',x:0,y:0,width:210,height:140,unknown:{keep:42}}
      ],edges:[]};
      const entries=new Map([
        file('sample.canvas',JSON.stringify(initial)),
        file('Readme.md','# Test\\n\\n![[sample.canvas]]')
      ].map(x=>[x.name,x]));
      window.mockWiki={name:'Wiki',kind:'directory',entries,
        async *values(){yield* entries.values()},
        async getFileHandle(name){return entries.get(name)}
      };
      window.showDirectoryPicker=async()=>window.mockWiki;
    }""")
    page.locator('#open-folder').click()
    page.wait_for_function("document.querySelector('#root-name').textContent==='Wiki'")
    page.locator('.tree-row[aria-label="sample.canvas"]').click()
    page.wait_for_function("document.querySelector('#attachment-dialog').open")
    page.locator('#attachment-edit-canvas').click()
    page.wait_for_function("document.querySelector('.canvas-editor-board .canvas-node')")
    assert page.locator('.canvas-editor-board .canvas-node').count()==1
    page.locator('.canvas-editor-toolbar button',has_text='+ Text').click()
    assert page.locator('.canvas-editor-board .canvas-node').count()==2
    page.locator('.canvas-editor-toolbar button',has_text='Undo').click()
    assert page.locator('.canvas-editor-board .canvas-node').count()==1
    page.locator('.canvas-editor-toolbar button',has_text='Redo').click()
    assert page.locator('.canvas-editor-board .canvas-node').count()==2
    page.locator('.canvas-editor-toolbar button',has_text='Save canvas').click()
    page.wait_for_function("document.querySelector('.canvas-editor')?.dataset.dirty==='false'")
    updated=page.evaluate("JSON.parse(window.mockWiki.entries.get('sample.canvas').body)")
    assert len(updated['nodes'])==2
    assert updated['future']['keep']=='yes'
    assert updated['nodes'][0]['unknown']['keep']==42
    page.locator('#attachment-dialog .dialog-actions .canvas-preview-exit').click()
    page.wait_for_function("document.querySelector('.canvas-editor')===null")
    assert page.locator('#attachment-edit-canvas').is_visible()
    page.locator('#attachment-close').click()

    # A second edit detects an out-of-app change and refuses to overwrite.
    page.locator('.tree-row[aria-label="sample.canvas"]').click()
    page.locator('#attachment-edit-canvas').click()
    page.wait_for_function("document.querySelector('.canvas-editor-board .canvas-node')")
    page.locator('.canvas-editor-toolbar button',has_text='+ Group').click()
    page.evaluate("""() => {
      const f=window.mockWiki.entries.get('sample.canvas');
      f.body=JSON.stringify({...JSON.parse(f.body),outsideChange:true});
      f.lastModified++;
    }""")
    page.locator('.canvas-editor-toolbar button',has_text='Save canvas').click()
    page.wait_for_function("document.querySelector('.canvas-editor-message')?.textContent.includes('External modification detected')")
    assert page.evaluate("JSON.parse(window.mockWiki.entries.get('sample.canvas').body).outsideChange===true")
    # The Close button must not lose an unsaved draft without explicit Discard.
    page.locator('#attachment-close').click()
    assert page.locator('#attachment-dialog').evaluate("(el)=>el.open")
    page.locator('.canvas-editor-confirm button',has_text='Discard changes').click()
    page.wait_for_function("!document.querySelector('#attachment-dialog').open")
    assert not errors, errors
    browser.close()
    print('PASS: Canvas editing, undo, redo, guarded save, preservation, conflict and discard')
