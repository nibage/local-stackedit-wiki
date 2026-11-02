"""Offline UI smoke: explicit renderer installer flow, with simulated picker and CDN responses.
Does not prove real CDN download or file:// permissions in a user's Chrome/Edge.
"""
from pathlib import Path
from urllib.parse import urlsplit, unquote
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent

def route_local(route):
    rel = unquote(urlsplit(route.request.url).path).lstrip('/')
    target = (ROOT / rel).resolve()
    if not target.is_relative_to(ROOT) or not target.is_file():
        route.fulfill(status=404, body='Not found')
        return
    mime = 'text/css' if target.suffix == '.css' else 'application/javascript' if target.suffix == '.js' else 'text/html'
    route.fulfill(status=200, content_type=mime, body=target.read_bytes())

def run():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        page = browser.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.route('https://local-wiki.test/**', route_local)
        responses = []
        def route_cdn(route):
            url = route.request.url
            responses.append(url)
            data = b'/* harmless simulated JS */' + b'/' * (130000 if 'mermaid' in url else 65000)
            route.fulfill(status=200, content_type='application/javascript',
                          headers={'access-control-allow-origin': '*'}, body=data)
        page.route('https://cdnjs.cloudflare.com/**', route_cdn)
        mock_fs = '''
          window.__fakeVendorBytes = {};
          function fileHandle(path, bytes) {
            let data = bytes;
            return {
              async getFile() { return new Blob([data]); },
              async createWritable() { return {
                async write(bytes) { this.bytes = new Uint8Array(bytes); },
                async close() { data = this.bytes; window.__fakeVendorBytes[path] = data.length; },
                async abort() {}
              }; }
            };
          }
          const files = {
            'mermaid/mermaid.min.js': fileHandle('mermaid/mermaid.min.js', new Uint8Array(100)),
            'abcjs/abcjs-basic-min.js': fileHandle('abcjs/abcjs-basic-min.js', new Uint8Array(100))
          };
          window.showDirectoryPicker = async function(options) {
            window.__pickerOptions = options;
            return {
              async getFileHandle(name) { return {
                async getFile() { return new Blob(['Local StackEdit Wiki <script src="src/renderer-installer.js"></script>']); }
              }; },
              async getDirectoryHandle(name) {
                return { async getDirectoryHandle(folder) {
                  return { async getFileHandle(file) { return files[folder + '/' + file]; } };
                } };
              }
            };
          };
        '''
        html = (ROOT / 'index.html').read_text('utf8').replace('<head>', '<head><base href="https://local-wiki.test/">')
        page.set_content(html, wait_until='load')
        page.evaluate(mock_fs)
        page.locator('#renderer-check').click()
        assert 'chybí knihovna' in page.locator('#renderer-details').inner_text()
        page.locator('#renderer-install').click()
        
        try:
            page.wait_for_function("document.querySelector('#renderer-install-status').textContent.includes('Obnov')", timeout=8000)
        except Exception:
            print('status:', page.locator('#renderer-install-status').inner_text())
            print('errors:', errors)
            print('fetched:', responses)
            raise
        assert page.evaluate('window.__fakeVendorBytes["mermaid/mermaid.min.js"]') > 100000
        assert page.evaluate('window.__fakeVendorBytes["abcjs/abcjs-basic-min.js"]') > 50000
        assert page.evaluate('window.__pickerOptions.mode') == 'readwrite'
        assert len(responses) == 2, responses
        assert not errors, errors
        print('PASS: UI installer selects app folder, fetches two libraries, saves both, shows reload notice')
        browser.close()

if __name__ == '__main__':
    run()
