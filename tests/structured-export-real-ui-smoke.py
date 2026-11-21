"""Export actual asynchronous Obsidian Canvas/Bases/draw.io into HTML and printable PDF with clickable TOC."""
from pathlib import Path
from urllib.parse import urlsplit,unquote
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
def serve(route):
    u=urlsplit(route.request.url)
    p=(ROOT/unquote(u.path).lstrip('/')).resolve()
    if u.netloc!='wiki-real-embedded-export.test' or not p.is_relative_to(ROOT) or not p.is_file():
        route.fulfill(status=404,body='Not found');return
    mime='text/css' if p.suffix=='.css' else 'application/javascript' if p.suffix=='.js' else 'text/html'
    route.fulfill(status=200,content_type=mime,body=p.read_bytes())

drawio=(ROOT/'demo-wiki'/'Attachments'/'example.drawio').read_text(encoding='utf-8')
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
    context=browser.new_context(accept_downloads=True,viewport={'width':1620,'height':980})
    context.add_init_script("window.print=()=>window.__printed=true;")
    page=context.new_page()
    errors=[]
    page.on('pageerror',lambda err:errors.append(str(err)))
    page.route('**/*',serve)
    html=(ROOT/'index.html').read_text(encoding='utf-8').replace('<head>',
        '<head><base href="https://wiki-real-embedded-export.test/">',1)
    page.set_content(html,wait_until='load')
    page.evaluate(r"""(drawio) => {
      function file(name,body,mime){return {name,kind:'file',body,mime,lastModified:100,
        async getFile(){return new File([this.body],name,{type:this.mime,lastModified:this.lastModified})},
        async createWritable(){throw Error('No writes expected')}
      }}
      const note='# Export with attachments\n\n## Canvas section\n\n![[graph.canvas]]\n\n'+
        '## Bases section\n\n![[query.base]]\n\n'+
        '## draw.io section\n\n![[diagram.drawio]]\n\n'+
        '## Last section\n\n[Jump to Canvas](#Canvas%20section)\n\nEnd of exported note.';
      const graph=JSON.stringify({nodes:[
        {id:'t1',type:'text',text:'Canvas card visible in export',x:0,y:0,width:330,height:180},
        {id:'t2',type:'text',text:'Second card in export',x:400,y:0,width:250,height:160}
      ],edges:[{id:'e1',fromNode:'t1',toNode:'t2',fromSide:'right',toSide:'left',toEnd:'arrow'}]});
      const base='views:\n  - type: table\n    name: All notes\n    order:\n      - file.name\n      - status\n';
      const docs=[file('index.md',note,'text/markdown'),
        file('Completed.md','---\nstatus: done\n---\n# Completed task','text/markdown'),
        file('graph.canvas',graph,'application/json'),
        file('query.base',base,'text/yaml'),
        file('diagram.drawio',drawio,'application/xml')];
      const entries=new Map(docs.map(d=>[d.name,d]));
      window.mockWiki={name:'Wiki',kind:'directory',entries,
        async *values(){yield* entries.values()},
        async getFileHandle(n){return entries.get(n)}
      };
      window.showDirectoryPicker=async()=>window.mockWiki;
    }""",drawio)
    page.locator('#open-folder').click()
    page.wait_for_function("document.querySelector('#filename').textContent==='index.md'")
    page.locator('#view-edit').click()
    page.wait_for_function("!document.querySelector('#preview-export-toggle').disabled")
    # Export immediately. The three structured embeds may still be loading;
    # the export must await the actual asynchronous render promises.
    page.evaluate("""() => {
      const original=window.LocalWikiPreviewExport.build;
      window.LocalWikiPreviewExport.build=async(...args)=>{
        window.__exportSnapshotDiagnostics={
          bases:document.querySelector('#preview .wiki-bases-viewer')?.textContent?.slice(-500),
          rows:document.querySelectorAll('#preview .bases-table tbody tr').length,
          embeds:document.querySelectorAll('#preview .wiki-structured-embed').length
        };
        return original(...args);
      };
    }""")
    page.locator('#preview-export-toggle').click()
    with page.expect_download() as generated:
        page.locator('#preview-export-html').click()
    exported=Path(generated.value.path()).read_text(encoding='utf-8')
    print('EXPORT EMBED DIAGNOSTIC',page.evaluate("""() => ({
      canvas:document.querySelectorAll('#preview .wiki-canvas-viewer').length,
      bases:document.querySelectorAll('#preview .wiki-bases-viewer').length,
      basesTable:document.querySelectorAll('#preview .bases-table').length,
      basesText:document.querySelector('#preview .wiki-bases-viewer')?.innerText?.slice(0,400),
      drawio:document.querySelectorAll('#preview .wiki-drawio-viewer').length,
      placeholders:[...document.querySelectorAll('#preview .structured-embed-body')].map(e=>e.innerText.slice(0,200))
    })"""), 'html snippets', {
      'bases-class':'bases-table' in exported,
      'done-note':'Completed' in exported,
      'fallback':exported.find('Cannot show Bases'),
      'loading':'Loading local' in exported
    },flush=True)
    print('BUILD-TIME LIVE STATE',page.evaluate('window.__exportSnapshotDiagnostics'),flush=True)
    marker=exported.find('Obsidian Bases')
    print('EXPORT BASES MARKUP',repr(exported[max(0,marker-250):marker+3000]),flush=True)
    print('EXPORTED TABLE TAG COUNT',exported.count('<table'),flush=True)
    assert 'Canvas card visible in export' in exported, 'Canvas was empty'
    assert 'Completed' in exported and 'bases-table' in exported, 'Bases was empty'
    assert 'drawio-graph' in exported and 'wiki-drawio-viewer' in exported, 'draw.io was empty'
    assert 'Loading local' not in exported
    assert '<nav class="wiki-export-toc"' in exported
    assert 'href="#wiki-heading-1"' in exported
    offline=browser.new_page(viewport={'width':1400,'height':1000})
    offline.route('**/*',lambda route:route.abort())
    offline.set_content(exported,wait_until='load')
    assert offline.locator('.wiki-export-toc a[href^="#"]').count()>=4
    for el in offline.locator('.wiki-export-toc a').all():
        destination=el.get_attribute('href')[1:]
        assert offline.locator('[id="'+destination+'"]').count()==1,destination
    assert offline.locator('.wiki-export-static-graph .canvas-node').count()==2
    assert offline.locator('.wiki-bases-viewer .bases-table tbody tr').count()>=1
    assert offline.locator('.wiki-drawio-viewer>svg').count()==1
    offline.close()

    page.locator('#preview-export-toggle').click()
    with page.expect_popup() as popup_info:
        page.locator('#preview-export-pdf').click()
    popup=popup_info.value
    popup.wait_for_function("document.querySelector('.wiki-export-toc')!==null",timeout=20000)
    popup.wait_for_function("window.__printed===true",timeout=20000)
    assert popup.locator('.wiki-export-static-graph .canvas-node').count()==2
    assert popup.locator('.wiki-bases-viewer .bases-table tbody tr').count()>=1
    assert popup.locator('.wiki-drawio-viewer>svg').count()==1
    assert popup.locator('.wiki-export-toc a[href="#wiki-heading-1"]').count()==1
    popup.emulate_media(media='print')
    for selector in ['.wiki-export-static-graph','.wiki-bases-viewer .bases-table','.wiki-drawio-viewer>svg']:
        box=popup.locator(selector).bounding_box()
        assert box and box['width']>15 and box['height']>15,(selector,box)
    pdf=popup.pdf(print_background=True,format='A4',prefer_css_page_size=True)
    assert pdf.startswith(b'%PDF') and len(pdf)>9000,len(pdf)
    # Chrome records hyperlinks as annotations, including internal heading
    # links. This checks the output PDF, not just the printable HTML.
    assert b'/Annots' in pdf or b'/Dest' in pdf or b'/URI' in pdf,'PDF has no link annotations'
    assert not errors,errors
    print('PASS: actual Canvas/Bases/draw.io embeds export to self-contained HTML and linked, nonempty A4 PDF')
    browser.close()
