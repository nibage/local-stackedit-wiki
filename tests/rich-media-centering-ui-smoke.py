"""Live preview + standalone HTML/A4 print centering for mixed rich media.

The test verifies *geometry*, not just the presence of centering CSS. Wide
Markdown tables must remain scrollable and Base tables keep their own scroll
holder rather than moving individual cells or breaking column resizing.
"""
from pathlib import Path
from urllib.parse import urlsplit, unquote
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent

def serve(route):
    url=urlsplit(route.request.url)
    path=(ROOT/unquote(url.path).lstrip('/')).resolve()
    if url.netloc!='wiki-rich-media.test' or not path.is_relative_to(ROOT) or not path.is_file():
        route.fulfill(status=404,body='Not found')
        return
    mime=('text/css' if path.suffix=='.css' else
          'application/javascript' if path.suffix=='.js' else 'text/html')
    route.fulfill(status=200,content_type=mime,body=path.read_bytes())

def box_center(locator):
    rect=locator.bounding_box()
    assert rect and rect['width']>1 and rect['height']>1,rect
    return rect['x']+rect['width']/2

def assert_centered(page,root,selector,tolerance=7):
    el=page.locator(selector)
    el.wait_for()
    source=page.locator(root)
    assert abs(box_center(el)-box_center(source))<tolerance,(selector,
        el.bounding_box(),source.bounding_box())

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':900})
    page.set_default_timeout(20000)
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.route('**/*',serve)
    html=(ROOT/'index.html').read_text(encoding='utf-8').replace(
        '<head>','<head><base href="https://wiki-rich-media.test/">',1)
    page.set_content(html,wait_until='load')
    page.locator('#view-preview').click()
    page.evaluate("""() => {
      const p=document.querySelector('#preview');
      const svg='<svg xmlns="http://www.w3.org/2000/svg" width="220" height="96" '+
        'viewBox="0 0 220 96"><rect width="220" height="96" fill="#cde8f2"/></svg>';
      p.innerHTML='<h2>Centered rich content</h2>'+
        '<p>Normal paragraphs remain left-aligned.</p>'+
        '<p><img alt="Standalone image" width="220" height="96" '+
          'src="data:image/svg+xml,'+encodeURIComponent(svg)+'"></p>'+
        '<table id="narrow" class="markdown-table"><thead><tr><th>A</th><th>B</th></tr></thead>'+
          '<tbody><tr><td>One</td><td>Two</td></tr></tbody></table>'+
        '<div class="visualization visualization-mermaid">'+
          '<svg width="235" height="100" viewBox="0 0 235 100">'+
          '<rect width="235" height="100" fill="#ddd"/></svg>'+
          '<button class="diagram-export">Export SVG</button></div>'+
        '<div class="visualization visualization-abc">'+
          '<svg width="320" height="110" viewBox="0 0 320 110">'+
          '<path d="M0 35h320" stroke="black"/></svg></div>'+
        '<div class="wiki-attachment-embed"><span class="attachment-label">tone.mp3</span>'+
          '<audio controls></audio></div>'+
        '<div class="wiki-attachment-embed"><span class="attachment-label">video.webm</span>'+
          '<video controls width="300" height="140"></video></div>'+
        '<div class="wiki-bases-viewer"><div class="bases-table-scroll" style="width:340px">'+
          '<table class="bases-table"><thead><tr><th>Note</th></tr></thead>'+
          '<tbody><tr><td>Base content</td></tr></tbody></table></div></div>'+
        '<div class="wiki-drawio-viewer">'+
          '<svg width="280" height="96" viewBox="0 0 280 96">'+
          '<rect width="280" height="96" fill="#eee"/></svg></div>'+
        '<table id="wide" class="markdown-table"><tbody><tr><td>'+
          '<span style="white-space:nowrap">'+('Unwrapped column '.repeat(80))+
          '</span></td><td>Other</td></tr></tbody></table>'+
        '<p>End of document.</p>';
    }""")
    for selector in [
        '#preview p > img[alt="Standalone image"]',
        '#preview #narrow',
        '#preview .visualization-mermaid > svg',
        '#preview .visualization-abc > svg',
        '#preview .wiki-attachment-embed audio',
        '#preview .wiki-attachment-embed video',
        '#preview .bases-table-scroll',
        '#preview .wiki-drawio-viewer > svg'
    ]:
        assert_centered(page,'#preview',selector)
    # A Mermaid toolbar button remains right-aligned, not centered with art.
    assert (page.locator('#preview .diagram-export').bounding_box()['x'] >
        page.locator('#preview .visualization-mermaid > svg').bounding_box()['x'])
    assert page.locator('#preview > p').first.evaluate(
        "(el)=>getComputedStyle(el).textAlign")!='center'
    assert page.locator('#narrow td').first.evaluate(
        "(el)=>getComputedStyle(el).textAlign")!='center'
    wide=page.locator('#wide')
    assert wide.evaluate('(el)=>el.scrollWidth>el.clientWidth'),"wide Markdown table lost horizontal scroll"
    assert wide.bounding_box()['width']<=page.locator('#preview').bounding_box()['width']

    standalone=page.evaluate("""async()=>await window.LocalWikiPreviewExport.build(
      document.querySelector('#preview'),{title:'Centered.md',theme:'current'})""")
    printable=page.evaluate("""async()=>await window.LocalWikiPreviewExport.build(
      document.querySelector('#preview'),{title:'Centered.md',theme:'light'})""")
    for markup,printing in [(standalone,False),(printable,True)]:
        out=browser.new_page(viewport={'width':1440,'height':900})
        network=[]
        out.route('**/*',lambda route:(network.append(route.request.url),route.abort()))
        out.set_content(markup,wait_until='load')
        if printing:out.emulate_media(media='print')
        for selector in [
            '.wiki-export-preview p > img[alt="Standalone image"]',
            '.wiki-export-preview #narrow',
            '.wiki-export-preview .visualization-mermaid > svg',
            '.wiki-export-preview .visualization-abc > svg',
            '.wiki-export-preview .wiki-attachment-embed audio',
            '.wiki-export-preview .wiki-attachment-embed video',
            '.wiki-export-preview .bases-table-scroll',
            '.wiki-export-preview .wiki-drawio-viewer > svg'
        ]:
            assert_centered(out,'.wiki-export-preview',selector,tolerance=10)
        assert out.locator('.wiki-export-preview td').first.evaluate(
            '(el)=>getComputedStyle(el).textAlign')!='center'
        assert out.locator('#wide').bounding_box()['width'] <= (
            out.locator('main').bounding_box()['width']+2)
        if printing:
            pdf=out.pdf(format='A4',print_background=True,prefer_css_page_size=True)
            assert pdf.startswith(b'%PDF') and len(pdf)>2000
        assert not network,network
        out.close()
    assert not errors,errors
    print('PASS: centered image, tables, Mermaid/ABC, audio/video, Bases, draw.io in live and exported HTML/PDF')
    browser.close()
