"""Offline Chromium smoke: temporary Bases filters, sort and column resizing."""
from pathlib import Path
from urllib.parse import urlsplit,unquote
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent

def serve(route):
    parsed=urlsplit(route.request.url)
    path=(ROOT/unquote(parsed.path).lstrip('/')).resolve()
    if parsed.netloc!='wiki-base-filter.test' or not path.is_relative_to(ROOT) or not path.is_file():
        route.fulfill(status=404,body='Not found')
        return
    mime='text/css' if path.suffix=='.css' else 'application/javascript' if path.suffix=='.js' else 'text/html'
    route.fulfill(status=200,content_type=mime,body=path.read_bytes())

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1400,'height':900})
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_default_timeout(15000)
    page.route('**/*',serve)
    html=(ROOT/'index.html').read_text(encoding='utf-8').replace(
        '<head>','<head><base href="https://wiki-base-filter.test/">',1)
    page.set_content(html,wait_until='load')
    page.evaluate("""() => {
      function file(name,body){return {name,kind:'file',body,lastModified:100,
        async getFile(){return new File([this.body],name,{lastModified:this.lastModified})},
        async createWritable(){throw Error('The viewer must not write')}
      }}
      const base='views:\\n  - type: table\\n    name: All\\n    order:\\n      - file.name\\n      - status\\n      - score\\n  - type: table\\n    name: Again\\n    order:\\n      - file.name\\n      - status\\n';
      const entries=new Map([
        file('example.base',base),
        file('One.md','---\\nstatus: done\\nscore: 8\\n---\\n# One'),
        file('Two.md','---\\nstatus: planned\\nscore: 3\\n---\\n# Two'),
        file('Three.md','---\\nstatus: done\\nscore: 6\\n---\\n# Three')
      ].map(f=>[f.name,f]));
      window.mockWiki={name:'Wiki',kind:'directory',entries,
        async *values(){yield* entries.values()},
        async getFileHandle(name){return entries.get(name)}
      };
      window.showDirectoryPicker=async()=>window.mockWiki;
    }""")
    page.locator('#open-folder').click()
    page.wait_for_function("document.querySelector('#root-name').textContent==='Wiki'")
    original=page.evaluate("window.mockWiki.entries.get('example.base').body")
    page.locator('.tree-row[aria-label="example.base"]').click()
    page.wait_for_function("document.querySelector('#attachment-dialog .bases-table tbody tr')!==null")
    assert page.locator('#attachment-dialog .bases-table tbody tr').count()==3
    # View tabs and temporary filter tools share a horizontal header, with
    # the controls on the right side of a visual divider.
    tabs=page.locator('#attachment-dialog .bases-controls-row .bases-tabs').bounding_box()
    tools=page.locator('#attachment-dialog .bases-controls-row .bases-toolbar').bounding_box()
    assert abs(tabs['y']-tools['y'])<10,(tabs,tools)
    assert tools['x']>=tabs['x']+tabs['width']-1,(tabs,tools)
    assert page.locator('#attachment-dialog .bases-controls-row .bases-toolbar').evaluate(
      '(el)=>getComputedStyle(el).borderLeftWidth')=='1px'
    page.locator('#attachment-dialog .bases-filter-toggle').click()
    negate=page.locator('#attachment-dialog .bases-filter-negate')
    checkbox=negate.locator('input[type="checkbox"]')
    label=negate.locator('span')
    assert abs(checkbox.bounding_box()['y']-label.bounding_box()['y'])<8
    assert checkbox.bounding_box()['x'] < label.bounding_box()['x']
    assert checkbox.bounding_box()['width']<=20
    page.locator('#attachment-dialog .bases-add-filter').click()
    page.locator('#attachment-dialog .bases-filter-key').select_option('status')
    page.locator('#attachment-dialog .bases-filter-value').fill('done')
    assert page.locator('#attachment-dialog .bases-table tbody tr').count()==2
    assert 'temporary filter' in page.locator('#attachment-dialog .bases-status').inner_text()
    page.locator('#attachment-dialog .bases-filter-combination').select_option('or')
    page.locator('#attachment-dialog .bases-add-filter').click()
    page.locator('#attachment-dialog .bases-filter-key').nth(1).select_option('score')
    page.locator('#attachment-dialog .bases-filter-operator').nth(1).select_option('less')
    page.locator('#attachment-dialog .bases-filter-value').nth(1).fill('5')
    assert page.locator('#attachment-dialog .bases-table tbody tr').count()==3

    # Header sort cycles asc/desc; widths are adjustable via keyboard.
    heading=page.locator('#attachment-dialog .bases-sortable-heading').first
    heading.click()
    assert heading.get_attribute('aria-sort')=='ascending'
    grip=page.locator('#attachment-dialog .bases-column-grip').first
    before=page.locator('#attachment-dialog .bases-table col').first.get_attribute('style')
    grip.focus()
    grip.press('ArrowRight')
    after=page.locator('#attachment-dialog .bases-table col').first.get_attribute('style')
    assert before!=after,(before,after)
    page.locator('#attachment-dialog .bases-reset').click()
    assert page.locator('#attachment-dialog .bases-table tbody tr').count()==3
    assert page.locator('#attachment-dialog .bases-filter-rule').count()==0
    page.locator('#attachment-dialog .bases-tab').nth(1).click()
    assert page.locator('#attachment-dialog .bases-table tbody tr').count()==3
    assert page.evaluate("window.mockWiki.entries.get('example.base').body") == original
    # Header stays glued to the *vertical table scroller*, including in
    # StackEdit mode. A second outer dialog scroller used to break sticky.
    page.locator('#theme-select').select_option('stackedit')
    area=page.locator('#attachment-dialog .bases-table-scroll')
    area.evaluate("(el)=>el.style.maxHeight='72px'")
    assert area.evaluate('(el)=>el.scrollHeight>el.clientHeight')
    header=page.locator('#attachment-dialog .bases-sortable-heading').first
    start=header.bounding_box()
    first_row=page.locator('#attachment-dialog .bases-table tbody tr').first.bounding_box()
    area.evaluate("(el)=>el.scrollTop=56")
    page.wait_for_timeout(120)
    now=header.bounding_box()
    moved_row=page.locator('#attachment-dialog .bases-table tbody tr').first.bounding_box()
    assert abs(start['y']-now['y'])<=2,(start,now)
    assert moved_row['y']<first_row['y']-10,(first_row,moved_row)
    assert header.evaluate('(el)=>getComputedStyle(el).position')=='sticky'
    opaque=header.evaluate("""el=>{
      const cs=getComputedStyle(el),bg=cs.backgroundColor;
      return {background:bg,border:cs.borderBottomWidth,
        borderColor:cs.borderBottomColor,shadow:cs.boxShadow};
    }""")
    assert opaque['background']=='rgb(246, 246, 246)',opaque
    assert opaque['border']=='2px',opaque
    assert opaque['shadow']!='none',opaque
    page.locator('#theme-select').select_option('light')
    light=header.evaluate('el=>({bg:getComputedStyle(el).backgroundColor,border:getComputedStyle(el).borderBottomWidth})')
    assert light['bg']=='rgb(238, 243, 248)' and light['border']=='2px',light
    page.locator('#attachment-close').click()
    page.evaluate("""() => {
      const note=window.mockWiki.entries.get('Three.md');
      note.body+='\\n\\n![[example.base]]';
      note.lastModified++;
    }""")
    page.locator('.tree-row[aria-label="Three.md"]').click()
    inline=page.locator('#preview .wiki-bases-viewer .bases-table thead th').first
    inline.wait_for()
    inline_scroll=page.locator('#preview .bases-table-scroll')
    inline_scroll.evaluate("(el)=>{el.style.maxHeight='60px';el.scrollTop=45;}")
    assert inline.evaluate("(el)=>getComputedStyle(el).backgroundColor")=='rgb(238, 243, 248)'
    assert inline.evaluate("(el)=>getComputedStyle(el).borderBottomWidth")=='2px'
    page.locator('#theme-select').select_option('stackedit')
    assert inline.evaluate("(el)=>getComputedStyle(el).backgroundColor")=='rgb(246, 246, 246)'
    assert inline.evaluate("(el)=>getComputedStyle(el).borderBottomWidth")=='2px'
    assert not errors,errors
    browser.close()
    print('PASS: Bases temporary filters, sort, widths, multi-view and no source writes')
