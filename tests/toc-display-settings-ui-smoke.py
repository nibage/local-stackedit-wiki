"""TOC links preserve Editor/Preview/Split; center, line numbers and size affect both panes."""
from pathlib import Path
from urllib.parse import urlsplit,unquote
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
def serve(route):
    uri=urlsplit(route.request.url)
    path=(ROOT/unquote(uri.path).lstrip('/')).resolve()
    if uri.netloc!='wiki-toc-settings.test' or not path.is_relative_to(ROOT) or not path.is_file():
        route.fulfill(status=404,body='Not found');return
    mime='text/css' if path.suffix=='.css' else 'application/javascript' if path.suffix=='.js' else 'text/html'
    route.fulfill(status=200,content_type=mime,body=path.read_bytes())

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1660,'height':960})
    page.set_default_timeout(15000)
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.route('**/*',serve)
    html=(ROOT/'index.html').read_text(encoding='utf-8').replace(
        '<head>','<head><base href="https://wiki-toc-settings.test/">',1)
    page.set_content(html,wait_until='load')
    page.evaluate("""() => {
      const body='# Overview\\n\\n'+Array.from({length:100},(_,i)=>
        '## Section '+i+'\\n\\n'+('A reader friendly long paragraph with enough words for scrolling. '.repeat(5))).join('\\n\\n');
      const note={kind:'file',name:'Guide.md',body,lastModified:100,
        async getFile(){return new File([this.body],this.name,{type:'text/markdown',lastModified:this.lastModified})},
        async createWritable(){let next;return{
          write:async value=>next=value,
          close:async()=>{this.body=next;this.lastModified++},abort:async()=>{}
        }}
      };
      const entries=new Map([[note.name,note]]);
      window.showDirectoryPicker=async()=>({kind:'directory',name:'Wiki',entries,
        async *values(){yield* entries.values()},
        async getFileHandle(name){return entries.get(name)}
      });
    }""")
    page.locator('#open-folder').click()
    page.wait_for_function("document.querySelector('#root-name').textContent==='Wiki'")
    page.locator('.tree-row[aria-label="Guide.md"]').click()
    page.wait_for_function("document.querySelector('#filename').textContent==='Guide.md'")
    page.wait_for_function("document.querySelector('#preview h2')")
    # A restored/current wiki is always visible in the history menu, even
    # when IndexedDB has no recent-folders record yet.
    page.evaluate("window.LocalWikiRecent.recentFolders=async()=>[]")
    page.locator('#recent-folder-toggle').click()
    current=page.locator('#recent-folder-options [role="menuitem"]',has_text='Wiki')
    current.wait_for()
    assert current.get_attribute('aria-current')=='true'
    page.evaluate("""() => {
      window.reopenedSameFolder=0;
      window.LocalWikiRecent.ensurePermission=async()=>{
        window.reopenedSameFolder++;throw new Error('Current wiki must never reopen');
      };
    }""")
    current.click()
    assert page.evaluate('window.reopenedSameFolder')==0
    assert page.locator('#filename').inner_text()=='Guide.md'
    page.locator('[data-side="toc"]').click()
    target=page.locator('#toc .toc-item',has_text='Section 79')
    assert target.count()==1

    def layout():
        return page.locator('#editor-grid').get_attribute('data-layout')
    def row():
        return page.evaluate('window.LocalWikiDebug.editor.cm.getCursor().line')
    def scroll():
        return page.locator('#preview').evaluate('(el)=>el.scrollTop')
    for mode in ['edit','preview','split']:
        page.locator('#view-'+mode).click()
        page.evaluate("""() => {
          window.LocalWikiDebug.editor.cm.setCursor({line:0,ch:0});
          document.querySelector('#preview').scrollTop=0;
          window.LocalWikiDebug.editor.cm.scrollTo(null,0);
        }""")
        initial_row=row()
        target.click()
        assert layout()==mode,(mode,layout())
        assert page.locator('#view-'+mode).get_attribute('aria-pressed')=='true'
        if mode=='preview':
            assert scroll()>150,scroll()
            assert row()==initial_row,(row(),initial_row)
        elif mode=='edit':
            assert row()>100,row()
            assert scroll()==0,scroll()
        else:
            assert row()>100,row()
            assert scroll()>150,scroll()
    # Settings stay visible to the left of scroll sync and in all themes.
    positions=page.evaluate("""() => ({
      center:document.querySelector('#center-content-toggle').getBoundingClientRect().x,
      lines:document.querySelector('#line-numbers-toggle').getBoundingClientRect().x,
      size:document.querySelector('#workspace-text-size').getBoundingClientRect().x,
      wrap:document.querySelector('#line-wrap-toggle').getBoundingClientRect().x,
      sync:document.querySelector('#scroll-sync-toggle').getBoundingClientRect().x
    })""")
    assert positions['center']<positions['lines']<positions['size']<positions['wrap']<positions['sync'],positions
    for theme in ['light','dark','stackedit']:
        page.locator('#theme-select').select_option(theme)
        page.locator('#view-preview').click()
        page.locator('#center-content-toggle').check()
        centered=page.locator('#preview').evaluate('(el)=>parseFloat(getComputedStyle(el).paddingLeft)')
        assert centered>50,(theme,centered)
        page.locator('#center-content-toggle').uncheck()
        left=page.locator('#preview').evaluate('(el)=>parseFloat(getComputedStyle(el).paddingLeft)')
        assert left==24,(theme,left)
        assert page.locator('#line-numbers-toggle').is_disabled()
        assert page.locator('#line-wrap-toggle').is_disabled()
        assert page.locator('#center-content-toggle').is_enabled()
        page.locator('#view-edit').click()
        assert page.locator('#center-content-toggle').is_enabled()
        assert page.locator('#line-numbers-toggle').is_enabled()
        assert page.locator('#line-wrap-toggle').is_enabled()
        page.locator('#center-content-toggle').check()
        page.locator('#view-split').click()
        assert page.locator('#center-content-toggle').is_disabled()
        assert page.locator('#line-numbers-toggle').is_enabled()
        assert page.locator('html').get_attribute('data-centered')=='true'
        # The native CodeMirror gutter remains fixed, with every digit fully
        # before the separator, for all sizes and both wrapping modes.
        def gutter_geometry():
            return page.evaluate("""() => {
              const root=document.querySelector('.edit-pane .CodeMirror');
              const gutter=root.querySelector('.CodeMirror-gutters').getBoundingClientRect();
              const digit=root.querySelector('.CodeMirror-code .CodeMirror-gutter-wrapper .CodeMirror-linenumber');
              const d=digit.getBoundingClientRect();
              const lines=root.querySelector('.CodeMirror-lines').getBoundingClientRect();
              const scroller=root.querySelector('.CodeMirror-scroll');
              return {gutterLeft:gutter.left,separator:gutter.right,
                left:d.left,right:d.right,font:getComputedStyle(digit).fontSize,
                transform:getComputedStyle(root.querySelector('.CodeMirror-gutters')).transform,
                linesX:lines.x,scrollLeft:scroller.scrollLeft};
            }""")
        for size in ['12','22','26']:
            page.locator('#workspace-text-size').select_option(size)
            assert page.locator('#preview').evaluate('(el)=>getComputedStyle(el).fontSize')==size+'px'
            assert page.locator('.edit-pane .CodeMirror').evaluate('(el)=>getComputedStyle(el).fontSize')==size+'px'
            for wrap in [True,False]:
                if wrap:page.locator('#line-wrap-toggle').check()
                else:page.locator('#line-wrap-toggle').uncheck()
                assert page.evaluate("window.LocalWikiDebug.editor.cm.getOption('lineWrapping')")==wrap
                geom=gutter_geometry()
                assert geom['font']==size+'px',geom
                assert geom['left']>=geom['gutterLeft']-1,geom
                assert geom['right']<=geom['separator']+1,geom
                assert geom['separator']-geom['right']<16,geom
                assert geom['transform']=='none',geom
                assert abs(geom['linesX']-geom['gutterLeft'])<75,geom
        # A horizontal scrollbar may move the markdown, but never the gutter.
        page.locator('#line-wrap-toggle').uncheck()
        page.evaluate("""() => {
          const cm=window.LocalWikiDebug.editor.cm;
          cm.replaceRange('UNWRAPPED LONG LINE '.repeat(130),{line:0,ch:0},{line:0,ch:cm.getLine(0).length});
          cm.scrollTo(650,null);
        }""")
        page.wait_for_timeout(200)
        after=gutter_geometry()
        assert after['scrollLeft']>100,after
        assert after['left']>=after['gutterLeft']-1 and after['right']<=after['separator']+1,after
        page.locator('#line-wrap-toggle').check()
        page.locator('#line-numbers-toggle').uncheck()
        assert page.evaluate("window.LocalWikiDebug.editor.cm.getOption('lineNumbers')===false")
        page.locator('#line-numbers-toggle').check()
        assert page.evaluate("window.LocalWikiDebug.editor.cm.getOption('lineNumbers')===true")
        page.locator('#workspace-text-size').select_option('default')
    assert not errors,errors
    print('PASS: TOC respects all three layouts; Center, Line numbers and Text size work in every theme')
    browser.close()
