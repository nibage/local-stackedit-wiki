"""Real pointer regression: no Canvas jump, live arrows and restrained resize handles."""
from pathlib import Path
from urllib.parse import urlsplit,unquote
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
def serve(route):
    uri=urlsplit(route.request.url)
    path=(ROOT/unquote(uri.path).lstrip('/')).resolve()
    if uri.netloc!='wiki-canvas-drag.test' or not path.is_relative_to(ROOT) or not path.is_file():
        route.fulfill(status=404,body='Not found');return
    kind='text/css' if path.suffix=='.css' else 'application/javascript' if path.suffix=='.js' else 'text/html'
    route.fulfill(status=200,content_type=kind,body=path.read_bytes())

def midpoint(box):
    return box['x']+box['width']/2,box['y']+box['height']/2

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1500,'height':960})
    errors=[]
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.set_default_timeout(15000)
    page.route('**/*',serve)
    html=(ROOT/'index.html').read_text(encoding='utf-8').replace('<head>','<head><base href="https://wiki-canvas-drag.test/">',1)
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
        {id:'a',type:'text',text:'Move me',x:0,y:0,width:190,height:125},
        {id:'b',type:'text',text:'Target',x:410,y:110,width:210,height:125}
      ],edges:[{id:'e1',fromNode:'a',toNode:'b',fromSide:'right',toSide:'left',toEnd:'arrow'}]};
      const entries=new Map([
        file('graph.canvas',JSON.stringify(graph)),
        file('Note.md','# Hello\\n![[graph.canvas]]')
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
    board=page.locator('.canvas-editor-board')
    page.wait_for_function("document.querySelector('.canvas-editor-board .canvas-node[data-node-id=\"a\"]')")
    first=board.locator('.canvas-node[data-node-id="a"]')
    second=board.locator('.canvas-node[data-node-id="b"]')
    path=board.locator('.canvas-connections path[stroke]').first
    page.wait_for_timeout(250) # wait for initial fit animation
    # The default graph does not let unselected handles float over nodes.
    assert second.locator('.canvas-editor-resize').evaluate(
        '(el)=>getComputedStyle(el).opacity')=='0'
    before=first.bounding_box(); x,y=before['x']+35,before['y']+35
    original_d=path.get_attribute('d')
    page.mouse.move(x,y)
    page.mouse.down()
    grabbed=first.bounding_box()
    assert abs(grabbed['x']-before['x'])<=1 and abs(grabbed['y']-before['y'])<=1,(before,grabbed)
    page.mouse.move(x+65,y+42,steps=5)
    during=first.bounding_box()
    assert abs(during['x']-before['x']-65)<=3,(before,during)
    assert abs(during['y']-before['y']-42)<=3,(before,during)
    assert path.get_attribute('d')!=original_d,'connection did not move with card'
    page.mouse.up()
    page.wait_for_timeout(80)
    after=board.locator('.canvas-node[data-node-id="a"]').bounding_box()
    assert abs(after['x']-during['x'])<=3,(during,after)
    assert abs(after['y']-during['y'])<=3,(during,after)
    # The JSON Canvas coordinate includes the drag, unlike the temporary
    # normalized viewport offset or the currently visible card coordinates.
    page.locator('.canvas-editor-toolbar button',has_text='Save canvas').click()
    page.wait_for_function("document.querySelector('.canvas-editor')?.dataset.dirty==='false'")
    data=page.evaluate("JSON.parse(window.mockWiki.entries.get('graph.canvas').body)")
    node=next(node for node in data['nodes'] if node['id']=='a')
    assert abs(node['x']-65)<=4 and abs(node['y']-42)<=4,node
    # On resize, the outgoing arrow must recalculate without waiting for up.
    first=board.locator('.canvas-node[data-node-id="a"]')
    handle=first.locator('.canvas-editor-resize')
    first.hover()
    assert handle.is_visible()
    page.wait_for_timeout(170)
    assert float(handle.evaluate('(el)=>getComputedStyle(el).opacity'))>0.9
    origin=midpoint(handle.bounding_box())
    before_path=board.locator('.canvas-connections path[stroke]').first.get_attribute('d')
    page.mouse.move(*origin)
    page.mouse.down()
    page.mouse.move(origin[0]+35,origin[1]+20,steps=4)
    mid_path=board.locator('.canvas-connections path[stroke]').first.get_attribute('d')
    assert mid_path!=before_path,'resize did not update arrow immediately'
    page.mouse.up()
    assert not errors,errors
    print('PASS: Canvas cards do not jump; arrows move/resize live; camera stable; handles scoped')
    browser.close()
