const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sandbox = { window: {}, console };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8'), sandbox);
const { prepareSource, convertEmbeds, convertWikiLinks, extractFrontmatter } = sandbox.window.LocalWikiRender;

test('YAML frontmatter se oddělí od vykreslovaného Markdownu, ale nemění soubor na disku', () => {
  const result = prepareSource('---\ntitle: Poznámka\ntags: [wiki, česky]\n---\n# Nadpis');
  assert.equal(result.frontmatter, 'title: Poznámka\ntags: [wiki, česky]');
  assert.equal(result.prepared, '# Nadpis');
  assert.equal(extractFrontmatter('---\nnení ukončeno').frontmatter, null);
});
test('Obsidian callouty jsou oddělené bloky a nezasahují do code fences', () => {
  const result = prepareSource('> [!TIP] Užitečné\n> Tělo\n\n```md\n> [!TIP] Neplatné\n```');
  assert.match(result.prepared, /> \[!TIP\] Užitečné\n>\n> Tělo/);
  assert.match(result.prepared, /```md\n> \[!TIP\] Neplatné\n```/);
});
test('Obsidian obrázek je rozpoznán včetně volitelné šířky', () => {
  assert.equal(convertEmbeds('![[obrazky/schema.png|320]]'), '![schema.png](<obsidian-asset:obrazky%2Fschema.png?width=320>)');
  assert.match(convertEmbeds('![[fotka s mezerou.png]]'), /obsidian-asset:fotka%20s%20mezerou.png/);
  assert.equal(convertEmbeds('![[stránka.md]]'), '![[stránka.md]]');
});
test('Nezachytí poznámkové embeds jako obrázky nebo wiki odkazy', () => {
  assert.equal(convertWikiLinks('![[stránka.md]] a [[stránka.md]]'), '![[stránka.md]] a [stránka.md](wiki:str%C3%A1nka.md)');
});
test('Obsidian embed ani callout v inline či fenced code se nepřepíše', () => {
  const result = prepareSource('`![[schema.png]]`\n```md\n![[schema.png]]\n> [!note] test\n```\n![[schema.png]]');
  assert.match(result.prepared, /^`!\[\[schema.png\]\]`/);
  assert.match(result.prepared, /```md\n!\[\[schema.png\]\]\n> \[!note\] test\n```/);
  assert.match(result.prepared, /obsidian-asset:schema.png/);
});
