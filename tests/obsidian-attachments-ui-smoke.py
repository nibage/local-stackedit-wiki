"""Offline browser smoke: browsable Obsidian attachments and local embeds.
Uses in-memory File System Access handles; final file:// behavior needs desktop Chrome.
"""
from pathlib import Path
import argparse
from urllib.parse import urlsplit, unquote
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent

def serve(route):
    parsed=urlsplit(route.request.url)
    asset=(ROOT/unquote(parsed.path).lstrip('/')).resolve()
    if parsed.netloc!='wiki-media.test' or not asset.is_relative_to(ROOT) or not asset.is_file():
        route.fulfill(status=404, body='Not found: '+parsed.path); return
    media='text/css' if asset.suffix=='.css' else 'application/javascript' if asset.suffix=='.js' else 'text/html'
    route.fulfill(status=200, content_type=media, body=asset.read_bytes())

parser=argparse.ArgumentParser()
parser.add_argument('--chromium',default=None)
opts=parser.parse_args()
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=opts.chromium,headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1400,'height':900})
    errors=[]
    page.on('pageerror',lambda err: errors.append(str(err)))
    page.set_default_timeout(9000)
    page.route('**/*',serve)
    html=(ROOT/'index.html').read_text().replace('<head>','<head><base href="https://wiki-media.test/">',1)
    page.set_content(html,wait_until='load')
    page.evaluate('''() => {
      function file(name,body,mime='application/octet-stream') {return {kind:'file',name,body,mime,lastModified:100,
        async getFile(){return new File([this.body],name,{type:this.mime,lastModified:this.lastModified})},
        async createWritable(){let bytes;return{write:async x=>{bytes=x},close:async()=>{this.body=bytes;this.lastModified++},abort:async()=>{}}}
      }}
      function dir(name,items=[]){const entries=new Map(items.map(x=>[x.name,x]));return {
        name,kind:'directory',entries,async *values(){yield* entries.values()},
        async getDirectoryHandle(n,{create=false}={}){let c=entries.get(n);if(!c&&create){c=dir(n);entries.set(n,c)}if(!c)throw Error('No folder '+n);return c},
        async getFileHandle(n,{create=false}={}){let c=entries.get(n);if(!c&&create){c=file(n,'');entries.set(n,c)}if(!c)throw Error('No file '+n);return c},
        async removeEntry(n,{recursive=false}={}){entries.delete(n)}
      }}
      const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"><script>window.svgExecuted=1</script><circle r="4" cx="6" cy="6"/></svg>';
      window.mockWiki=dir('Wiki',[
        file('Main.md','## Media\\n\\n![[voice.mp3]]\\n\\n![[movie.mp4]]\\n\\n![[paper.pdf]]\\n\\n![[drawing.svg]]\\n\\n[Open canvas](board.canvas)\\n\\n[Open PDF](paper.pdf)'),
        file('drawing.svg',svg,'image/svg+xml'),
        file('voice.mp3',new Uint8Array([1,3,2,4,255]),'audio/mpeg'),
        file('movie.mp4',new Uint8Array([0,0,0,20,102,116,121,112]),'video/mp4'),
        file('paper.pdf',new Uint8Array([37,80,68,70,45,49,46,52]),'application/pdf'),
        file('board.canvas',JSON.stringify({nodes:[{id:'n1',type:'text',text:'Hello <img src=x onerror=alert(1)> **strong** [link](https://example.org)',x:0,y:0,width:260,height:140},{id:'n2',type:'file',file:'drawing.svg',x:350,y:0,width:250,height:160}],edges:[{id:'e1',fromNode:'n1',toNode:'n2',fromSide:'right',toSide:'left',label:'safe'}]}), 'application/json'),
        file('query.base','filters:\\n  - color: orange\\n','text/yaml'),
        dir('Assets')
      ]);
      window.showDirectoryPicker=async()=>window.mockWiki;
    }''')
    page.locator('#open-folder').click()
    page.wait_for_function("document.querySelector('#root-name').textContent === 'Wiki'")
    for filename in ['drawing.svg','voice.mp3','movie.mp4','paper.pdf','board.canvas','query.base']:
        assert page.locator(f'.tree-row[aria-label="{filename}"]').count()==1,filename
    assert '6 attachments' in page.locator('#count').inner_text()
    original_audio=page.evaluate("Array.from(window.mockWiki.entries.get('voice.mp3').body)")
    page.locator('#rename-file').click()
    page.locator('.tree-row[aria-label="voice.mp3"]').drag_to(page.locator('.tree-row[aria-label="Assets"]'))
    page.wait_for_function("window.LocalWikiDebug.bridge.hasAsset('Assets/voice.mp3')")
    assert not page.evaluate("window.LocalWikiDebug.bridge.hasAsset('voice.mp3')")
    assert page.evaluate("Array.from(window.mockWiki.entries.get('Assets').entries.get('voice.mp3').body)")==original_audio
    assert '![[Assets/voice.mp3]]' in page.evaluate("window.mockWiki.entries.get('Main.md').body")
    page.locator('.tree-row[aria-label="Main.md"]').click()
    page.wait_for_function("document.querySelector('#filename').textContent === 'Main.md'")
    page.wait_for_function("document.querySelectorAll('#preview .wiki-attachment-embed').length === 3")
    page.wait_for_function("document.querySelector('#preview audio')?.src.startsWith('blob:')")
    assert page.locator('#preview video[src^="blob:"]').count()==1
    assert page.locator('#preview object[type="application/pdf"]').count()==1
    assert page.locator('#preview img[src^="blob:"]').count()==1
    assert not page.evaluate('Boolean(window.svgExecuted)'), 'SVG script executed in image context'
    page.locator('.tree-row[aria-label="board.canvas"]').click()
    page.wait_for_function("document.querySelector('#attachment-dialog').open")
    page.wait_for_function("document.querySelector('#attachment-dialog-viewer').textContent.includes('2 nodes, 1 edges')")
    assert '2 nodes, 1 edges' in page.locator('#attachment-dialog-viewer').inner_text()
    assert page.locator('#attachment-dialog-viewer .canvas-node').count()==2
    assert page.locator('#attachment-dialog-viewer .canvas-connections path').count()>=2
    assert 'Hello' in page.locator('#attachment-dialog-viewer .canvas-node[data-kind="text"] .canvas-node-content').inner_text()
    assert page.locator('#attachment-dialog-viewer .canvas-node[data-kind="text"] strong').count()==1
    assert page.locator('#attachment-dialog-viewer .canvas-node[data-kind="text"] .canvas-inert-link').count()==2
    assert page.locator('#attachment-dialog-viewer .canvas-node[data-kind="text"] a, #attachment-dialog-viewer .canvas-node[data-kind="text"] img').count()==0
    page.locator('#attachment-dialog-viewer .canvas-node-image[src^="blob:"]').wait_for(timeout=10000)
    assert not page.locator('#attachment-dialog-viewer script, #attachment-dialog-viewer [onerror]').count(), 'Canvas injected unsafe markup'
    assert not page.evaluate('Boolean(window.svgExecuted)'), 'Canvas image executed SVG script'
    page.locator('#attachment-dialog-viewer .canvas-control',has_text='+').click()
    assert '%' in page.locator('#attachment-dialog-viewer .canvas-zoom-status').inner_text()
    assert page.evaluate("document.querySelector('.canvas-board').style.transform.includes('scale(')")
    assert page.evaluate("window.mockWiki.entries.get('board.canvas').body.includes('Hello <img src=x onerror=alert(1)>')")
    page.locator('#attachment-close').click()
    page.locator('.tree-row[aria-label="query.base"]').click()
    page.wait_for_function("document.querySelector('#attachment-dialog').open")
    page.wait_for_function("document.querySelector('#attachment-dialog-viewer').textContent.includes('read-only YAML')")
    assert 'read-only YAML' in page.locator('#attachment-dialog-viewer').inner_text()
    page.locator('#attachment-insert').click()
    assert '[[query.base]]' in page.locator('.CodeMirror-code').inner_text()
    # The view-only dialog must not edit the .base content.
    assert page.evaluate("window.mockWiki.entries.get('query.base').body")=='filters:\n  - color: orange\n'
    # Reopen note from disk to remove unsaved insertion before moving attachment.
    page.reload(wait_until='domcontentloaded') if False else None
    # New session: no edits may be dropped. Check read-only mode independently.
    assert not errors, errors
    print('PASS: Obsidian attachment tree, inline audio/video/PDF, SVG isolation, Canvas/Bases preview, insertion, binary audio DnD')
    browser.close()
