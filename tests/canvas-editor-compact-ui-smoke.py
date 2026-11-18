"""Canvas editor UX: single-row actions/zoom, path metadata, compact inspector, inline discard and toggle selection."""
from pathlib import Path
from urllib.parse import urlsplit,unquote
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
def serve(route):
    uri=urlsplit(route.request.url)
    path=(ROOT/unquote(uri.path).lstrip('/')).resolve()
    if uri.netloc!='wiki-canvas-compact.test' or not path.is_relative_to(ROOT) or not path.is_file():
        route.fulfill(status=404,body='Not found');return
    mime='text/css' if path.suffix=='.css' else 'application/javascript' if path.suffix=='.js' else 'text/html'
    route.fulfill(status=200,content_type=mime,body=path.read_bytes())

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1500,'height':960})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_default_timeout(16000)
    page.route('**/*',serve)
    html=(ROOT/'index.html').read_text(encoding='utf-8').replace(
        '<head>','<head><base href="https://wiki-canvas-compact.test/">',1)
    page.set_content(html,wait_until='load')
    page.evaluate("""() => {
      function file(name,body){return {name,kind:'file',body,lastModified:100,
        async getFile(){return new File([this.body],name,{type:'application/json',lastModified:this.lastModified})},
        async createWritable(){let next;return{
          write:async data=>{next=data},
          close:async()=>{this.body=next;this.lastModified++},
          abort:async()=>{}
        }}};
      }
      const graph={nodes:[
        {id:'a',type:'text',text:'Note',x:0,y:0,width:190,height:125},
        {id:'b',type:'file',file:'photo.png',x:430,y:120,width:215,height:140}
      ],edges:[{id:'e1',fromNode:'a',toNode:'b',fromSide:'right',toSide:'left',toEnd:'arrow'}]};
      const entries=new Map([
        file('graph.canvas',JSON.stringify(graph)),
        file('Readme.md','# Hello\\n![[graph.canvas]]')
      ].map(item=>[item.name,item]));
      window.mockWiki={name:'Wiki',kind:'directory',entries,
        async *values(){yield* entries.values()},
        async getFileHandle(name){return entries.get(name)}};
      window.showDirectoryPicker=async()=>window.mockWiki;
    }""")
    page.locator('#open-folder').click()
    page.wait_for_function("document.querySelector('#root-name').textContent==='Wiki'")
    page.locator('.tree-row[aria-label="graph.canvas"]').click()
    page.wait_for_function("document.querySelector('#attachment-dialog').open")
    page.locator('#attachment-edit-canvas').click()
    page.wait_for_function("document.querySelector('.canvas-editor-board .canvas-node[data-node-id=\"a\"]')")
    page.wait_for_timeout(270)
    assert page.locator('#attachment-dialog-path').inner_text()=='graph.canvas'
    path=page.locator('#attachment-dialog-path').bounding_box()
    assert not page.locator('#attachment-dialog-canvas-info').is_visible()
    toolbar=page.locator('.canvas-editor-toolbar')
    zoom=toolbar.locator('.canvas-editor-zoom')
    buttons=toolbar.locator('.canvas-editor-actions')
    save=toolbar.locator('.canvas-editor-save-stack')
    meta=page.locator('.canvas-editor>.canvas-editor-meta')
    assert meta.is_visible()
    assert meta.locator('.canvas-editor-info-summary').count()==1
    assert 'JSON Canvas editor · 2 cards · 1 connections' in meta.inner_text()
    assert 'Drag cards to move' in meta.inner_text()
    assert meta.bounding_box()['y']>page.locator('.canvas-editor-inspector').bounding_box()['y']
    assert meta.locator('.canvas-editor-info-hint').evaluate('(e)=>getComputedStyle(e).borderLeftWidth')=='1px'
    assert 'Canvas: saved' in save.inner_text()
    assert 'select a card to edit' in meta.inner_text()
    assert save.bounding_box()['x']>zoom.bounding_box()['x']
    assert page.locator('.canvas-editor-board>.wiki-canvas-viewer>.canvas-summary').count()==0
    assert page.locator('.canvas-editor-board>.wiki-canvas-viewer>.canvas-controls').count()==0
    # Screenshot new.png: [- + Fit 100% pct] | [node actions Undo Redo] ... Save
    separator=toolbar.locator('.canvas-editor-toolbar-separator')
    zoom_box=zoom.bounding_box()
    separator_box=separator.bounding_box()
    actions_box=buttons.bounding_box()
    save_box=save.bounding_box()
    assert zoom_box['x']+zoom_box['width']<=separator_box['x']+2,(zoom_box,separator_box)
    assert separator_box['x']+separator_box['width']<=actions_box['x']+2,(separator_box,actions_box)
    assert actions_box['x']<save_box['x'],(actions_box,save_box)
    preview_exit=page.locator('#attachment-dialog .dialog-actions .canvas-preview-exit')
    insert=page.locator('#attachment-insert')
    close=page.locator('#attachment-close')
    assert preview_exit.bounding_box()['x']<insert.bounding_box()['x']<close.bounding_box()['x']
    assert zoom.locator('button').count()==4
    assert toolbar.locator('.canvas-zoom-status').count()==1
    assert toolbar.locator('.canvas-editor-toolbar-separator').count()==1
    assert abs(buttons.bounding_box()['y']-zoom.bounding_box()['y'])<5
    assert toolbar.bounding_box()['height']<49,toolbar.bounding_box()
    assert page.locator('.canvas-icon-button svg').count()==4
    assert page.locator('#attachment-dialog .dialog-actions .canvas-preview-exit').count()==1
    assert page.locator('#attachment-dialog .dialog-actions .canvas-preview-exit svg').count()==1
    assert toolbar.locator('button',has_text='Preview').count()==0
    assert toolbar.locator('button',has_text='Undo').locator('svg').count()==1
    assert toolbar.locator('button',has_text='Redo').locator('svg').count()==1
    assert toolbar.locator('button',has_text='Save canvas').locator('svg').count()==1
    old_pct=toolbar.locator('.canvas-zoom-status').inner_text()
    zoom.locator('button',has_text='+').click()
    assert toolbar.locator('.canvas-zoom-status').inner_text()!=old_pct

    first=page.locator('.canvas-editor-board .canvas-node[data-node-id="a"]')
    first.click()
    assert first.get_attribute('class').find('canvas-node-selected')>=0
    inspector=page.locator('.canvas-editor-inspector')
    props=inspector.locator('.canvas-editor-inspector-properties')
    edges=inspector.locator('.canvas-editor-inspector-connections')
    assert 'TEXT:' in props.inner_text()
    text_top=props.locator('.canvas-editor-property-top')
    assert text_top.is_visible()
    assert props.locator('.canvas-prop-content textarea').count()==1
    textarea_box=props.locator('.canvas-prop-content textarea').bounding_box()
    width_box=props.locator('.canvas-prop-width input').bounding_box()
    assert textarea_box['x']>width_box['x']+width_box['width'],(textarea_box,width_box)
    assert props.locator('.canvas-prop-color').bounding_box()['y']<props.locator('.canvas-prop-x').bounding_box()['y']

    assert edges.bounding_box()['x']>=props.bounding_box()['x']+props.bounding_box()['width']-1
    assert inspector.locator('.canvas-editor-field input[type="number"]').count()==4
    for fld in inspector.locator('.canvas-editor-field input[type="number"]').all():
        assert fld.bounding_box()['width']<=100,fld.bounding_box()
    assert inspector.locator('.canvas-editor-edge-list option').count()==1
    assert inspector.locator('.canvas-editor-connection-row button').bounding_box()['width']==inspector.locator('.canvas-editor-delete').bounding_box()['width']
    assert inspector.locator('.canvas-editor-delete').bounding_box()['y']>inspector.locator('.canvas-editor-connection-row button').bounding_box()['y']
    assert 'Note' in inspector.locator('.canvas-editor-edge-list option').first.inner_text()
    assert inspector.bounding_box()['height']<=112
    assert inspector.evaluate('(el)=>getComputedStyle(el).overflowY')!='auto'
    first.click()
    assert page.locator('.canvas-editor-board .canvas-node-selected').count()==0
    assert 'Select a card' in props.inner_text()
    # Keyboard activation toggles the same selection.
    first.focus()
    first.press('Enter')
    assert page.locator('.canvas-editor-board .canvas-node-selected').count()==1
    first.press('Enter')
    assert page.locator('.canvas-editor-board .canvas-node-selected').count()==0
    # File paths take the flexible long field, while color is hex-sized.
    second=page.locator('.canvas-editor-board .canvas-node[data-node-id="b"]')
    second.click()
    file_field=inspector.locator('.canvas-prop-content input')
    color_field=inspector.locator('.canvas-prop-color input')
    # The FILE value is on the same header row as FILE: and COLOR;
    # compact X/Y/width/height appear below it, never beside the path.
    assert props.locator('.canvas-editor-property-top .canvas-prop-content input').count()==1
    assert props.locator('.canvas-editor-properties-grid .canvas-prop-content').count()==0
    assert props.locator('.canvas-prop-content input').get_attribute('aria-label')=='Canvas file path'
    file_box=file_field.bounding_box()
    color_box=color_field.bounding_box()
    heading_box=props.locator('.canvas-editor-inspector-heading').bounding_box()
    geometry_box=props.locator('.canvas-prop-x').bounding_box()
    assert abs(file_box['y']-color_box['y'])<4,(file_box,color_box)
    assert abs(file_box['y']-heading_box['y'])<12,(file_box,heading_box)
    assert color_box['x']>file_box['x']+file_box['width'],(file_box,color_box)
    assert geometry_box['y']>file_box['y']+file_box['height'],(geometry_box,file_box)
    assert file_box['width']>260,file_box

    assert color_field.bounding_box()['width']<=75,color_field.bounding_box()
    delete_edge=inspector.locator('.canvas-delete-connection').bounding_box()
    delete_card=inspector.locator('.canvas-editor-delete').bounding_box()
    assert abs(delete_edge['width']-delete_card['width'])<=1,(delete_edge,delete_card)
    assert delete_card['y']>delete_edge['y']
    assert page.locator('.canvas-editor-save-stack').bounding_box()['x']>zoom.bounding_box()['x']
    assert page.locator('#attachment-dialog .dialog-actions .canvas-preview-exit').count()==1
    assert page.locator('.canvas-editor>.canvas-editor-meta').bounding_box()['y']>inspector.bounding_box()['y']

    toolbar.locator('button',has_text='+ Group').click()
    assert 'unsaved changes' in save.inner_text()
    page.locator('#attachment-close').click()
    assert page.locator('#attachment-dialog').evaluate('(el)=>el.open')
    warning=toolbar.locator('.canvas-editor-confirm')
    assert warning.is_visible()
    assert warning.locator('button').count()==2
    assert warning.inner_text().strip()=='Discard changes\nKeep editing',warning.inner_text()
    assert warning.bounding_box()['x']>buttons.bounding_box()['x']
    assert abs(warning.bounding_box()['y']-buttons.bounding_box()['y'])<12
    assert not zoom.is_visible(),'Zoom should give room to confirmation buttons'
    assert not save.is_visible(),'Save/status should give room to confirmation buttons'
    assert toolbar.bounding_box()['height']<49,'Confirmation must not add a toolbar row'
    warning.locator('button',has_text='Keep editing').click()
    assert zoom.is_visible()
    assert save.is_visible()
    assert not warning.is_visible()
    page.locator('#attachment-close').click()
    warning.locator('button',has_text='Discard changes').click()
    page.wait_for_function("!document.querySelector('#attachment-dialog').open")
    assert not errors,errors
    print('PASS: Canvas compact chrome, path status, zoom, icons, inspector, deselection and inline discard')
    browser.close()
