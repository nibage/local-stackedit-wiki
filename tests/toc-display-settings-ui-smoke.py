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
      sync:document.querySelector('#scroll-sync-toggle').getBoundingClientRect().x
    })""")
    assert positions['center']<positions['lines']<positions['size']<positions['sync'],positions
    for theme in ['light','dark','stackedit']:
        page.locator('#theme-select').select_option(theme)
        page.locator('#view-split').click()
        page.locator('#center-content-toggle').check()
        centered=page.locator('#preview').evaluate('(el)=>parseFloat(getComputedStyle(el).paddingLeft)')
        assert centered>20,centered
        page.locator('#center-content-toggle').uncheck()
        left=page.locator('#preview').evaluate('(el)=>parseFloat(getComputedStyle(el).paddingLeft)')
        assert left==24,(theme,left)
        assert page.locator('.edit-pane .CodeMirror-lines').evaluate(
          '(el)=>getComputedStyle(el).maxWidth')=='none'
        page.locator('#center-content-toggle').check()
        assert page.locator('html').get_attribute('data-centered')=='true'
        page.locator('#workspace-text-size').select_option('22')
        assert page.locator('#preview').evaluate('(el)=>getComputedStyle(el).fontSize')=='22px'
        assert page.locator('.edit-pane .CodeMirror').evaluate('(el)=>getComputedStyle(el).fontSize')=='22px'
        page.locator('#line-numbers-toggle').uncheck()
        assert page.evaluate("window.LocalWikiDebug.editor.cm.getOption('lineNumbers')===false")
        page.locator('#line-numbers-toggle').check()
        assert page.evaluate("window.LocalWikiDebug.editor.cm.getOption('lineNumbers')===true")
        page.locator('#workspace-text-size').select_option('default')
    assert not errors,errors
    print('PASS: TOC respects all three layouts; Center, Line numbers and Text size work in every theme')
    browser.close()
