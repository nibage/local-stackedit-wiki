"""Offline Chromium smoke: guarded Bases YAML source editing and no note rewrites."""
from pathlib import Path
from urllib.parse import urlsplit,unquote
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
def serve(route):
    parsed=urlsplit(route.request.url)
    path=(ROOT/unquote(parsed.path).lstrip('/')).resolve()
    if parsed.netloc!='wiki-base-edit.test' or not path.is_relative_to(ROOT) or not path.is_file():
        route.fulfill(status=404,body='Not found');return
    mime='text/css' if path.suffix=='.css' else 'application/javascript' if path.suffix=='.js' else 'text/html'
    route.fulfill(status=200,content_type=mime,body=path.read_bytes())

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1450,'height':940})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_default_timeout(16000)
    page.route('**/*',serve)
    html=(ROOT/'index.html').read_text(encoding='utf-8').replace(
        '<head>','<head><base href="https://wiki-base-edit.test/">',1)
    page.set_content(html,wait_until='load')
    page.evaluate("""() => {
      function file(name,body){
        return {name,kind:'file',body,lastModified:100,
          async getFile(){return new File([this.body],name,{lastModified:this.lastModified})},
          async createWritable(){let next;return {
            write:async value=>{next=value},
            close:async()=>{this.body=next;this.lastModified++},
            abort:async()=>{}
          }}
        };
      }
      const yaml='# preserved comment\\nunknownSetting: preserve-me\\nviews:\\n  - type: table\\n    name: Old view\\n    order:\\n      - file.name\\n      - status\\n';
      const md='---\\nstatus: done\\n---\\n# Note';
      const entries=new Map([file('sample.base',yaml),file('Note.md',md)].map(x=>[x.name,x]));
      window.mockWiki={name:'Wiki',kind:'directory',entries,
        async *values(){yield* entries.values()},
        async getFileHandle(name){return entries.get(name)}
      };
      window.showDirectoryPicker=async()=>window.mockWiki;
    }""")
    page.locator('#open-folder').click()
    page.wait_for_function("document.querySelector('#root-name').textContent==='Wiki'")
    initial_note=page.evaluate("window.mockWiki.entries.get('Note.md').body")
    page.locator('.tree-row[aria-label="sample.base"]').click()
    page.wait_for_function("document.querySelector('#attachment-dialog .bases-table tbody tr')")
    assert page.locator('#attachment-edit-base').is_visible()
    page.locator('#attachment-edit-base').click()
    area=page.locator('#attachment-dialog .bases-edit-text')
    area.wait_for()
    assert '# preserved comment' in area.input_value()
    assert 'unknownSetting: preserve-me' in area.input_value()
    area.fill(area.input_value().replace('Old view','New view'))
    assert page.locator('.bases-source-editor').get_attribute('data-dirty')=='true'
    page.locator('#attachment-dialog .dialog-actions .asset-footer-save').click()
    page.wait_for_function("document.querySelector('.bases-edit-message')?.textContent.includes('saved safely')")
    body=page.evaluate("window.mockWiki.entries.get('sample.base').body")
    assert 'New view' in body and '# preserved comment' in body
    assert 'unknownSetting: preserve-me' in body
    assert page.evaluate("window.mockWiki.entries.get('Note.md').body")==initial_note
    page.locator('#attachment-dialog .dialog-actions .asset-back-to-preview').click()
    page.wait_for_function("document.querySelector('#attachment-dialog .bases-tab')?.textContent==='New view'")
    page.locator('#attachment-close').click()

    # Unsupported YAML is blocked before any file write.
    page.locator('.tree-row[aria-label="sample.base"]').click()
    page.locator('#attachment-edit-base').click()
    area=page.locator('#attachment-dialog .bases-edit-text')
    area.fill(area.input_value()+'unsafe: !execute\\n')
    page.locator('#attachment-dialog .dialog-actions .asset-footer-save').click()
    page.wait_for_function("document.querySelector('.bases-edit-message')?.textContent.includes('Save failed')")
    assert 'unsafe: !execute' not in page.evaluate("window.mockWiki.entries.get('sample.base').body")
    # Repair YAML but detect a new external version.
    area.fill(area.input_value().replace('unsafe: !execute\\n','').replace('New view','Attempted view'))
    page.evaluate("""() => {
      const file=window.mockWiki.entries.get('sample.base');
      file.body=file.body+'# external revision\\n';
      file.lastModified++;
    }""")
    page.locator('#attachment-dialog .dialog-actions .asset-footer-save').click()
    page.wait_for_function("document.querySelector('.bases-edit-message')?.textContent.includes('External modification detected')")
    assert 'Attempted view' not in page.evaluate("window.mockWiki.entries.get('sample.base').body")
    # Same compact Save/Discard decision as Canvas; no extra dialog row.
    footer=page.locator('.bases-edit-footer')
    footer_height=footer.bounding_box()['height']
    dialog_height=page.locator('#attachment-dialog').bounding_box()['height']
    page.locator('#attachment-close').click()
    assert page.locator('#attachment-dialog').evaluate("(el)=>el.open")
    confirm=page.locator('#attachment-dialog .dialog-actions .bases-edit-confirm')
    assert confirm.is_visible()
    assert confirm.locator('button').count()==2
    assert 'Discard' in confirm.inner_text()
    assert 'Save' in confirm.inner_text()
    assert confirm.locator('.asset-confirm-save').evaluate(
      '(el)=>getComputedStyle(el).borderTopColor')=='rgb(88, 163, 106)'
    assert 'asset-exit-pending' in (page.locator('#attachment-close').get_attribute('class') or '')
    assert footer.bounding_box()['height']==footer_height
    assert abs(page.locator('#attachment-dialog').bounding_box()['height']-dialog_height)<3
    page.locator('.bases-edit-confirm button',has_text='Discard').click()
    page.wait_for_function("!document.querySelector('#attachment-dialog').open")
    assert not errors,errors
    browser.close()
    print('PASS: source-preserving Base YAML editing, conflict, unsupported syntax and unsaved-close safety')
