"""Offline export regression: SVG, Canvas, draw.io, wide tables and A4 print geometry.

All visual elements are fully rendered DOM (as they are in the live preview).
The test exports from Editor-only, where the actual preview is display:none.
"""
from pathlib import Path
from urllib.parse import urlsplit,unquote
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
def serve(route):
    url=urlsplit(route.request.url)
    path=(ROOT/unquote(url.path).lstrip('/')).resolve()
    if url.netloc!='wiki-export-visuals.test' or not path.is_relative_to(ROOT) or not path.is_file():
        route.fulfill(status=404,body='Not found');return
    mime='text/css' if path.suffix=='.css' else 'application/javascript' if path.suffix=='.js' else 'text/html'
    route.fulfill(status=200,content_type=mime,body=path.read_bytes())

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1500,'height':960})
    page.set_default_timeout(16000)
    errors=[]
    page.on('pageerror',lambda err:errors.append(str(err)))
    page.route('**/*',serve)
    html=(ROOT/'index.html').read_text(encoding='utf-8').replace(
        '<head>','<head><base href="https://wiki-export-visuals.test/">',1)
    page.set_content(html,wait_until='load')
    page.locator('#theme-select').select_option('dark')
    page.locator('#view-edit').click()
    # A connected preview element with the same classes/structure as the
    # app's renderer, deliberately hidden by the Editor-only layout.
    page.evaluate(r"""() => {
      const preview=document.querySelector('#preview');
      const diagram='<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="360" viewBox="0 0 1250 360">'+
        '<rect x="0" y="0" width="1250" height="360" fill="#dbedf7" stroke="#225588" stroke-width="5"/>'+
        '<text x="30" y="150" font-size="46" fill="#123456">Mermaid drawn node</text></svg>';
      const abc='<svg xmlns="http://www.w3.org/2000/svg" width="900" height="160" viewBox="0 0 900 160">'+
        '<path d="M25 60 L875 60 M25 80 L875 80" stroke="black" stroke-width="4"/>'+
        '<text x="60" y="120" font-size="32">ABC score</text></svg>';
      const drawing='<svg class="drawio-graph" xmlns="http://www.w3.org/2000/svg"'+
        ' width="1400" height="460" viewBox="0 0 1400 460">'+
        '<rect x="35" y="30" width="1300" height="390" fill="#d8edf8" stroke="#226688" stroke-width="4"/>'+
        '<text x="50" y="180" font-size="54">draw.io diagram</text></svg>';
      const note='A very long multi-paragraph document. '.repeat(90);
      preview.innerHTML='<h1>Graphical export test</h1>'+
        '<details class="obsidian-properties"><summary>Properties</summary>'+
        '<pre>category: demo\nstatus: ready</pre></details>'+
        '<nav><a href="#after-all-graphical-content">Jump to section</a></nav>'+
        '<p>'+note+'</p><div class="visualization visualization-mermaid">'+diagram+'</div>'+
        '<div class="visualization visualization-abc">'+abc+'</div>'+
        '<div class="wiki-attachment-embed wiki-structured-embed">'+
          '<div class="structured-embed-header">Interactive grey wrapper</div>'+
          '<div class="structured-embed-body"><div class="wiki-canvas-viewer">'+
          '<div class="canvas-viewport"><div class="canvas-board"'+
          ' style="width:1900px;height:1250px;transform:translate(-120px,-60px) scale(0.45)">'+
            '<svg class="canvas-connections" xmlns="http://www.w3.org/2000/svg"'+
            ' width="1900" height="1250" viewBox="0 0 1900 1250">'+
              '<path d="M110 100 L850 300" stroke="#555" stroke-width="5" fill="none"/>'+
            '</svg><div class="canvas-cards">'+
              '<div class="canvas-node" data-kind="text"'+
              ' style="position:absolute;top:80px;left:110px;width:430px;height:240px">'+
              '<div class="canvas-node-content">Visible Canvas card title</div></div>'+
              '<div class="canvas-node" data-kind="text"'+
              ' style="position:absolute;top:300px;left:850px;width:450px;height:250px">'+
              '<div class="canvas-node-content">Second Canvas card</div></div>'+
            '</div></div></div></div></div></div>'+
        '<div class="wiki-drawio-viewer"><div class="drawio-viewport">'+
          '<div class="drawio-board" style="width:1400px;height:460px;transform:translate(-10px,0px) scale(0.45)">'+
            drawing+'</div></div></div>'+
        '<div class="bases-table-scroll" style="width:500px;overflow:auto;max-height:90px">'+
          '<table class="bases-table" style="table-layout:fixed;min-width:1150px;width:1150px">'+
          '<colgroup><col style="width:350px"><col style="width:450px"><col style="width:350px"></colgroup>'+
          '<thead><tr><th>Very long heading</th><th>Another column</th><th>Third column</th></tr></thead>'+
          '<tbody><tr><td><button class="bases-open-note">Record Alpha</button></td>'+
          '<td>'+('Text that must wrap '.repeat(8))+'</td><td>Right column</td></tr></tbody></table></div>'+
        '<pre><code>'+('averyverylongunbrokentoken'.repeat(30))+'</code></pre>'+
        '<h2>After all graphical content</h2><p>Last paragraph is not clipped.</p>';
      // Recreate the REAL renderer DOM (as found in Bases-Zaznam-Hotovo.html):
      // fixed-height <p><span class="wiki-structured-embed">...</span></p>
      // with nested <div>s. Building nodes instead of parsing HTML is
      // important because a string parser would silently reparent <div>s.
      const details=preview.querySelector('details.obsidian-properties');
      details.style.height='36px'; // recorded CLOSED computed height
      details.querySelector('pre').style.height='83px';
      const canvasEmbed=preview.querySelector('.wiki-structured-embed');
      const canvasSpan=document.createElement('span');
      canvasSpan.className=canvasEmbed.className;
      canvasSpan.style.cssText='display:block;height:583px;background:#f7f8fa;';
      while(canvasEmbed.firstChild)canvasSpan.append(canvasEmbed.firstChild);
      const canvasParagraph=document.createElement('p');
      canvasParagraph.style.cssText='height:583px;margin:18px 0;';
      canvasEmbed.replaceWith(canvasParagraph);
      canvasParagraph.append('Text before canvas ',canvasSpan,' text after canvas');
      const drawio=preview.querySelector('.wiki-drawio-viewer');
      const drawioParagraph=document.createElement('p');
      drawioParagraph.style.cssText='height:583px;margin:18px 0;';
      const drawioSpan=document.createElement('span');
      drawioSpan.className='wiki-attachment-embed wiki-structured-embed';
      drawioSpan.style.cssText='display:block;height:583px;background:#f7f8fa;';
      const drawioHeader=document.createElement('div');
      drawioHeader.className='structured-embed-header';
      drawioHeader.textContent='Attachments/example.drawio';
      const drawioBody=document.createElement('div');
      drawioBody.className='structured-embed-body';
      const drawioInner=document.createElement('div');
      drawio.replaceWith(drawioParagraph);
      drawioInner.append(drawio);drawioBody.append(drawioInner);
      drawioSpan.append(drawioHeader,drawioBody);
      drawioParagraph.append(drawioSpan);
    }""")
    assert page.locator('#preview').evaluate('(el)=>getComputedStyle(el).display')=='none' or \
        page.locator('.preview-pane').evaluate('(el)=>getComputedStyle(el).display')=='none'
    exporter='window.LocalWikiPreviewExport.build(document.querySelector("#preview"),'
    dark=page.evaluate(f"""() => {exporter}{{title:'Graphs.md',theme:'current'}})""")
    light=page.evaluate(f"""() => {exporter}{{title:'Graphs.md',theme:'light'}})""")
    for text in [dark,light]:
        assert '<script' not in text.lower()
        assert 'Mermaid drawn node' in text
        assert 'ABC score' in text
        assert 'Visible Canvas card title' in text
        assert 'draw.io diagram' in text
        assert 'After all graphical content' in text
        assert 'href="#wiki-export-heading-1"' in text
        assert 'Record Alpha' in text
        assert 'bases-open-note' not in text
        assert 'wiki-export-static-graph' in text
        assert 'Interactive grey wrapper' not in text
        # The standalone stylesheet now contains a valid selector for audio
        # attachment wrappers. Assert absence of *elements*, not CSS text.
        assert text.count('wiki-export-structured')>=2
        assert 'Text before canvas' in text and 'text after canvas' in text
        assert '<summary' in text
        assert 'height: 583px' not in text and 'height:583px' not in text
        assert 'scale(' in text
        assert 'translate(-120px,-60px)' not in text
        assert 'blob:' not in text
    html_page=browser.new_page(viewport={'width':1400,'height':900})
    unexpected=[]
    html_page.route('**/*',lambda route:(unexpected.append(route.request.url),route.abort()))
    html_page.set_content(dark,wait_until='load')
    assert html_page.locator('main').bounding_box()['width']>=760
    assert html_page.locator('.visualization svg').count()==2
    assert html_page.locator('.wiki-export-static-graph .canvas-node').count()==2
    assert html_page.locator('.wiki-attachment-embed').count()==0
    disclosure=html_page.locator('details.obsidian-properties')
    assert not disclosure.evaluate('(el)=>el.open')
    disclosure.locator('summary').click()
    assert disclosure.evaluate('(el)=>el.open')
    assert disclosure.locator('pre').bounding_box()['height']>20
    # Opening YAML must increase the native details height AND push the
    # heading down: the original fixed 36px panel overlapped the heading.
    detail_box=disclosure.bounding_box()
    next_element_top=disclosure.evaluate('(el)=>el.nextElementSibling.getBoundingClientRect().top')
    assert detail_box['height']>100,detail_box
    assert next_element_top>=detail_box['y']+detail_box['height'],(detail_box,next_element_top)
    assert html_page.locator('p:has(.wiki-export-structured)').count()==0
    assert html_page.locator('.wiki-export-structured').count()==2
    drawio_box=html_page.locator('.wiki-export-structured:has(.wiki-drawio-viewer)').bounding_box()
    svg_box=html_page.locator('.wiki-drawio-viewer > svg').bounding_box()
    assert drawio_box['height']<svg_box['height']+40,(drawio_box,svg_box)
    assert abs(drawio_box['y']-svg_box['y'])<25,(drawio_box,svg_box)
    graph=html_page.locator('.wiki-export-static-graph').bounding_box()
    main=html_page.locator('main').bounding_box()
    assert abs(graph['x']+graph['width']/2-main['x']-main['width']/2)<18,(graph,main)
    assert html_page.locator('.wiki-drawio-viewer>svg').count()==1
    assert html_page.locator('.visualization-mermaid svg').bounding_box()['width']>=500
    html_page.locator('nav a[href="#wiki-export-heading-1"]').click()
    assert html_page.evaluate('location.hash')=='#wiki-export-heading-1'
    for selector in ['.visualization-mermaid svg','.visualization-abc svg',
                     '.wiki-export-static-graph','.wiki-drawio-viewer>svg']:
        assert html_page.locator(selector).bounding_box()['height']>25,selector
    assert not unexpected,unexpected
    html_page.close()

    printed=browser.new_page(viewport={'width':1440,'height':960})
    printed.route('**/*',lambda route:route.abort())
    printed.set_content(light,wait_until='load')
    printed.emulate_media(media='print')
    assert printed.locator('main').evaluate('(el)=>getComputedStyle(el).backgroundColor')=='rgb(255, 255, 255)'
    dims=printed.evaluate("""() => {
      const main=document.querySelector('main'),rect=main.getBoundingClientRect();
      return {main:rect.toJSON(),scroll:document.documentElement.scrollWidth,
        items:[...document.querySelectorAll('.visualization svg,.wiki-export-static-graph,.wiki-drawio-viewer>svg,.bases-table')]
          .map(el=>({name:el.className?.baseVal||el.className,
            rect:el.getBoundingClientRect().toJSON()}))}
    }""")
    for item in dims['items']:
        rect=item['rect']
        assert rect['width']>10 and rect['height']>10,item
        assert rect['right']<=dims['main']['right']+5,(item,dims['main'])
        assert rect['left']>=dims['main']['left']-5,(item,dims['main'])
    assert printed.locator('.visualization-mermaid svg').bounding_box()['width']>=400
    assert dims['scroll']<=1445,dims
    assert printed.locator('.bases-table').evaluate('(el)=>getComputedStyle(el).tableLayout')=='auto'
    assert printed.locator('pre code').last.locator('..').evaluate('(el)=>getComputedStyle(el).whiteSpace')=='pre-wrap'
    pdf=printed.pdf(print_background=True,format='A4',prefer_css_page_size=True)
    assert pdf.startswith(b'%PDF') and len(pdf)>4000,len(pdf)
    assert not errors,errors
    print('PASS: hidden Editor preview exports nonempty Mermaid, ABC, Canvas and draw.io, with unclipped A4 content')
    browser.close()
