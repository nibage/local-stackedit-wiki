"""Type-to-create, compact sidebar/footer and StackEdit HTML fidelity in Chromium."""
from pathlib import Path
from urllib.parse import urlsplit,unquote
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
def serve(route):
    url=urlsplit(route.request.url)
    path=(ROOT/unquote(url.path).lstrip('/')).resolve()
    if url.netloc!='wiki-quick-note.test' or not path.is_relative_to(ROOT) or not path.is_file():
        route.fulfill(status=404,body='Not found');return
    mime='text/css' if path.suffix=='.css' else 'application/javascript' if path.suffix=='.js' else 'text/html'
    route.fulfill(status=200,content_type=mime,body=path.read_bytes())

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1680,'height':940})
    page.set_default_timeout(15000)
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.route('**/*',serve)
    html=(ROOT/'index.html').read_text(encoding='utf-8').replace('<head>',
        '<head><base href="https://wiki-quick-note.test/">',1)
    page.set_content(html,wait_until='load')
    page.evaluate("""() => {
      function file(name,body){return {kind:'file',name,body,lastModified:100,
        async getFile(){return new File([this.body],name,{type:'text/markdown',lastModified:this.lastModified})},
        async createWritable(){let data;return{
          write:async value=>data=value,
          close:async()=>{this.body=data;this.lastModified++},abort:async()=>{}
        }}}}
      function dir(name,children=[]){const entries=new Map(children.map(c=>[c.name,c]));
        return {kind:'directory',name,entries,
          async *values(){yield* entries.values()},
          async getFileHandle(n,{create=false}={}){
            let item=entries.get(n);
            if(!item&&create){item=file(n,'');entries.set(n,item)}
            if(!item||item.kind!=='file')throw Error('Missing file '+n);
            return item;},
          async getDirectoryHandle(n,{create=false}={}){
            let item=entries.get(n);
            if(!item&&create){item=dir(n);entries.set(n,item)}
            if(!item||item.kind!=='directory')throw Error('Missing folder '+n);
            return item;},
          async removeEntry(n){entries.delete(n)}
        }}
      window.longName='An-extremely-long-file-name-with-many-words-that-should-be-truncated-with-an-ellipsis-and-have-full-tooltip-and-still-keep-header-compact.md';
      window.mockWiki=dir('demo-wiki-with-a-very-long-root-folder-name',[
        file('Untitled.md','# Existing, should not overwrite'),
        file(window.longName,'# Long title\\n\\nText with [link](https://example.org).\\n\\n> Quoted\\n\\n\u0060\u0060\u0060js\\nconsole.log(42);\\n\u0060\u0060\u0060'),
        dir('Nested',[file('Inner.md','# Subnote')])]);
      window.showDirectoryPicker=async()=>window.mockWiki;
    }""")
    assert page.locator('.topbar .brand #filename').count()==1
    assert page.locator('.topbar .editor-bar #filename').count()==0
    assert page.locator('.statusbar #mode').count()==1
    assert page.locator('.statusbar #count').count()==1
    assert page.locator('.sidebar-head #count').count()==0
    page.locator('#open-folder').click()
    page.wait_for_function("document.querySelector('#root-name').textContent.startsWith('demo-wiki')")
    assert page.locator('#mode').inner_text()=='Read/write'
    assert page.locator('#count').inner_text()=='3 .md · 0 attachments'
    assert page.evaluate("window.LocalWikiDebug.editor.cm.getOption('readOnly')===false")
    assert page.locator('#filename').inner_text()=='No note open'
    page.evaluate("""() => {
      const cm=window.LocalWikiDebug.editor.cm;cm.focus();
      cm.replaceRange('# First thought: žlutý', {line:0,ch:0});
    }""")
    page.wait_for_function("document.querySelector('#filename').textContent==='Untitled 2.md'")
    page.wait_for_function("window.mockWiki.entries.get('Untitled 2.md')?.body==='# First thought: žlutý'")
    assert page.evaluate("window.mockWiki.entries.get('Untitled.md').body")=='# Existing, should not overwrite'
    assert page.locator('#count').inner_text()=='4 .md · 0 attachments'
    assert page.locator('.tree-row[aria-label="Untitled 2.md"]').count()==1
    assert not page.locator('#dirty').inner_text().strip()
    long_name=page.evaluate('window.longName')
    page.locator(f'.tree-row[aria-label="{long_name}"]').click()
    page.wait_for_function("(name)=>document.querySelector('#filename').textContent===name",arg=long_name)
    assert page.locator('#filename').get_attribute('title')==long_name
    filename=page.locator('#filename').evaluate("""el=>({
      visible:el.clientWidth,full:el.scrollWidth,
      overflow:getComputedStyle(el).textOverflow,
      nowrap:getComputedStyle(el).whiteSpace})""")
    assert filename['full']>filename['visible'],filename
    assert filename['overflow']=='ellipsis' and filename['nowrap']=='nowrap',filename
    # Long "previous wiki is remembered" notice uses the free area after
    # the filename; the old RC5 two-line clamp must not hide the message.
    page.evaluate("""() => {
      const box=document.querySelector('#notice');
      box.textContent='The previous wiki is remembered. Chrome needs renewed permission; use Open folder.';
      box.hidden=false;
    }""")
    banner=page.locator('#notice').evaluate("""el=>({
      rect:el.getBoundingClientRect().toJSON(),
      height:el.clientHeight,scrollHeight:el.scrollHeight,
      clamp:getComputedStyle(el).webkitLineClamp,
      overflow:getComputedStyle(el).overflow
    })""")
    assert banner['height']+1>=banner['scrollHeight'],banner
    assert banner['clamp'] in ('none','unset'),banner
    assert banner['overflow']=='visible',banner
    filename_box=page.locator('#filename').bounding_box()
    assert banner['rect']['x']>=filename_box['x']+filename_box['width']-2,(filename_box,banner)
    page.locator('#notice').evaluate('(el)=>el.hidden=true')
    page.locator('#theme-select').select_option('stackedit')
    page.locator('#view-preview').click()
    page.wait_for_function("document.querySelector('#preview h1')")
    assert page.locator('#preview').evaluate("(el)=>getComputedStyle(el).fontSize")=='18px'
    assert 'Lato' in page.locator('#preview').evaluate("(el)=>getComputedStyle(el).fontFamily")
    assert page.locator('#preview a').first.evaluate("(el)=>getComputedStyle(el).color")=='rgb(12, 147, 228)'
    assert page.locator('#preview h1').first.evaluate("(el)=>getComputedStyle(el).borderBottomWidth")=='0px'
    assert page.locator('#preview h1').first.evaluate("(el)=>getComputedStyle(el).fontWeight")=='600'
    assert page.locator('#preview blockquote').first.evaluate("(el)=>getComputedStyle(el).borderLeftWidth")=='5px'
    page.locator('#sidebar-resizer').focus()
    page.keyboard.press('Home')
    page.wait_for_timeout(110)
    layout=page.evaluate("""() => {
      const sidebar=document.querySelector('.sidebar').getBoundingClientRect();
      const root=document.querySelector('#root-name'),toc=document.querySelector('[data-side="toc"]');
      return {sidebar:sidebar.toJSON(),root:root.getBoundingClientRect().toJSON(),
        toc:toc.getBoundingClientRect().toJSON(),
        rootEllipsis:getComputedStyle(root).textOverflow,
        tocEllipsis:getComputedStyle(toc).textOverflow,
        rootScroll:root.scrollWidth,rootClient:root.clientWidth}
    }""")
    assert layout['root']['right']<=layout['sidebar']['right']+1,layout
    assert layout['toc']['right']<=layout['sidebar']['right']+1,layout
    assert layout['rootEllipsis']=='ellipsis' and layout['tocEllipsis']=='ellipsis',layout
    assert layout['rootScroll']>layout['rootClient'],layout
    assert page.locator('#root-name').get_attribute('title')=='demo-wiki-with-a-very-long-root-folder-name'
    # Closing and reopening in read-only mode must NOT offer automatic note creation.
    page.locator('#read-only-toggle').check()
    page.locator('#open-folder').click()
    page.wait_for_function("window.LocalWikiDebug.bridge.getMode()==='readonly'")
    assert page.locator('#mode').inner_text()=='Read-only'
    assert page.locator('#save-status').inner_text()=='No note open'
    assert page.evaluate("window.LocalWikiDebug.editor.cm.getOption('readOnly')===true")
    page.locator('#view-edit').click()
    page.locator('.CodeMirror').click()
    page.keyboard.type('No new note')
    assert page.locator('#filename').inner_text()=='No note open'
    assert page.evaluate("window.mockWiki.entries.has('Untitled 3.md')===false")
    assert not errors,errors
    print('PASS: quick root note, no overwrite, footer mode/count, ellipsized sidebar/title and StackEdit CSS fidelity')
    browser.close()
