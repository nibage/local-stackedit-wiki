"""UI smoke: Move button does not shift neighbors; tree scrolls on both axes;
sidebar is resizable up to a responsive maximum and remembers requested width.
Uses mocked File System Access API; real file:// picker permissions need manual checks.
"""
from pathlib import Path
from urllib.parse import urlsplit, unquote
import argparse
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser()
parser.add_argument('--chromium',default=None)
opts=parser.parse_args()

def serve(route):
    parsed=urlsplit(route.request.url)
    asset=(ROOT/unquote(parsed.path).lstrip('/')).resolve()
    if parsed.netloc!='wiki-tree-layout.test' or not asset.is_relative_to(ROOT) or not asset.is_file():
        route.fulfill(status=404,body='Not found');return
    media='text/css' if asset.suffix=='.css' else 'application/javascript'
    route.fulfill(status=200,content_type=media,body=asset.read_bytes())

with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=opts.chromium,headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1480,'height':850})
    page.set_default_timeout(10000)
    errors=[]
    page.on('pageerror',lambda err:errors.append(str(err)))
    page.route('https://wiki-tree-layout.test/**',serve)
    html=(ROOT/'index.html').read_text().replace('<head>','<head><base href="https://wiki-tree-layout.test/">',1)
    page.set_content(html,wait_until='load')
    page.evaluate("""() => {
      function file(name,body='# Example'){return {kind:'file',name,body,lastModified:100,
        async getFile(){return new File([this.body],name,{type:'text/markdown',lastModified:this.lastModified})},
        async createWritable(){let next;return{write:async x=>{next=x},close:async()=>{this.body=next;this.lastModified++},abort:async()=>{}}}
      }}
      function dir(name,items=[]){const entries=new Map(items.map(x=>[x.name,x]));return {
        kind:'directory',name,entries,async *values(){yield* entries.values()},
        async getDirectoryHandle(n){const c=entries.get(n);if(!c)throw Error('Missing folder');return c},
        async getFileHandle(n){const c=entries.get(n);if(!c)throw Error('Missing note');return c},
        async removeEntry(n){entries.delete(n)}
      }}
      let nested=file('Deep-'+ 'X'.repeat(100)+'.md');
      for(let i=7;i>=1;i--) nested=dir('Level-'+i+'-with-a-long-label',[nested]);
      const many=dir('Many',Array.from({length:45},(_,i)=>file('Example-'+String(i+1).padStart(2,'0')+'.md')));
      window.mockWiki=dir('Demo',[file('Intro.md'),nested,many]);
      window.showDirectoryPicker=async()=>window.mockWiki;
    }""")
    page.locator('#open-folder').click()
    page.wait_for_function("document.querySelector('#root-name').textContent==='Demo'")
    def geometry():
        return page.evaluate("""() => {
          const rect=id=>{const r=document.querySelector(id).getBoundingClientRect();
            return [r.x,r.y,r.width,r.height]};
          return {note:rect('#new-file'),folder:rect('#new-folder'),move:rect('#rename-file'),tree:rect('#tree'),
            action:rect('.file-actions')};
        }""")
    before=geometry()
    page.locator('#rename-file').click()
    assert page.locator('#rename-file').get_attribute('aria-pressed')=='true'
    assert page.locator('#rename-file').evaluate("(el)=>getComputedStyle(el).borderTopWidth")=='1px'
    during=geometry()
    for element in before:
        assert all(abs(x-y)<0.2 for x,y in zip(before[element],during[element])),(element,before[element],during[element])
    page.locator('#rename-file').click()
    after=geometry()
    for element in before:
        assert all(abs(x-y)<0.2 for x,y in zip(before[element],after[element])),(element,before[element],after[element])
    page.locator('#expand-all').click()
    metrics=page.evaluate("""() => {
      const t=document.querySelector('#tree');
      return {sw:t.scrollWidth,cw:t.clientWidth,sh:t.scrollHeight,ch:t.clientHeight};
    }""")
    assert metrics['sw']>metrics['cw']+60, metrics
    assert metrics['sh']>metrics['ch']+60, metrics
    page.evaluate("document.querySelector('#tree').scrollLeft=9999")
    assert page.evaluate("document.querySelector('#tree').scrollLeft")>0
    page.evaluate("document.querySelector('#tree').scrollTop=9999")
    assert page.evaluate("document.querySelector('#tree').scrollTop")>0
    # One trash control must stay a few pixels from the same scrollbar, even
    # when long/nested rows extend far beyond the horizontal viewport.
    assert page.locator('#tree-delete-overlay svg').count()==1
    anchored=page.evaluate("""() => {
      const tree=document.querySelector('#tree');
      const candidates=[...tree.querySelectorAll('.tree-row[data-delete-path]')]
        .filter(row=>row.dataset.deletePath);
      const choose=kind=>candidates.find(row=>row.dataset.deleteKind===kind);
      const button=document.querySelector('#tree-delete-overlay');
      function show(row) {
        row.dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));
        const t=tree.getBoundingClientRect(),b=button.getBoundingClientRect();
        return {left:b.left, rightGap:t.right-b.right, visible:!button.hidden,
          label:button.getAttribute('aria-label')};
      }
      const folder=show(choose('directory')),note=show(choose('file'));
      return {folder,note,single:document.querySelectorAll('#tree-delete-overlay').length};
    }""")
    assert anchored['single']==1,anchored
    assert anchored['folder']['visible'] and anchored['note']['visible'],anchored
    assert abs(anchored['folder']['left']-anchored['note']['left'])<1,anchored
    assert 0<=anchored['folder']['rightGap']<=30,anchored
    assert anchored['note']['label'].startswith('Delete file '),anchored
    page.locator('#sidebar-resizer').focus()
    page.keyboard.press('End')
    layout=page.evaluate("""() => {
      const ws=document.querySelector('.workspace'),sb=document.querySelector('.sidebar'),main=document.querySelector('.main-area');
      return {total:ws.clientWidth,nav:sb.getBoundingClientRect().width,editor:main.getBoundingClientRect().width,
        ariaMax:+document.querySelector('#sidebar-resizer').getAttribute('aria-valuemax')};
    }""")
    assert layout['nav']>520,layout
    assert layout['nav']<=layout['total']*.70+2,layout
    assert layout['editor']>=389,layout
    assert abs(layout['nav']-layout['ariaMax'])<=2,layout
    preferred=layout['nav']
    page.set_viewport_size({'width':1000,'height':850})
    page.wait_for_function("document.querySelector('.main-area').getBoundingClientRect().width >= 389")
    smaller=page.evaluate("document.querySelector('.sidebar').getBoundingClientRect().width")
    main=page.evaluate("document.querySelector('.main-area').getBoundingClientRect().width")
    assert smaller<preferred and main>=389,(smaller,main,preferred)
    page.set_viewport_size({'width':1480,'height':850})
    page.wait_for_function("(width)=>Math.abs(document.querySelector('.sidebar').getBoundingClientRect().width-width)<2",arg=preferred)
    expanded=page.evaluate("document.querySelector('.sidebar').getBoundingClientRect().width")
    assert abs(expanded-preferred)<2,(expanded,preferred)
    assert not errors, errors
    print('PASS: Move stable geometry, bidirectional tree scroll, flexible sidebar width and resize restoration')
    browser.close()
