const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const text = fs.readFileSync(path.join(__dirname, '../src/renderer.js'),'utf8');
const w = {};
vm.runInNewContext(text, { window:w, console }, { filename:'renderer.js' });
const { prepareSource, convertWikiLinks } = w.LocalWikiRender;
test('markdown wiki odkazy včetně aliasu', () => {
  assert.match(convertWikiLinks('[[Python]]'), /\[Python\]\(wiki:Python\)/);
  assert.match(convertWikiLinks('[[Python|Programování]]'), /\[Programování\]\(wiki:Python\)/);
});
test('matematiku chrání před interpretací Markdown syntaxe', () => {
  const r = prepareSource('Rovnice $x_1 + y_2 = 0$ a \\(z_3\\).\n\n$$\na^2+b^2=c^2\n$$');
  assert.equal(r.expressions.length,3);
  assert.ok(r.expressions.some(x => x.formula === '$x_1 + y_2 = 0$'));
  assert.ok(!r.prepared.includes('x_1'));
  assert.equal(r.expressions[2].formula,'$$\na^2+b^2=c^2\n$$');
});
test('neinterpretuje wiki ani math bloky uvnitř fenced code a inline code', () => {
  const r=prepareSource('`$x$ [[Page]]`\n```abc\n[[Page]] $x$\n```\n[[Page]]');
  assert.equal(r.expressions.length,0);
  assert.match(r.prepared, /`\$x\$ \[\[Page\]\]`/);
  assert.match(r.prepared, /```abc\n\[\[Page\]\] \$x\$\n```/);
  assert.match(r.prepared, /\[Page\]\(wiki:Page\)/);
});
