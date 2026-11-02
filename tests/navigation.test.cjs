const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const window = {};
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../src/navigation.js'), 'utf8'), {window});
const {splitTarget, headingSlug, findHeading} = window.LocalWikiNavigation;
const plain = obj => JSON.parse(JSON.stringify(obj));

test('Rozlišení kotvy v Obsidian a Markdown odkazech', () => {
  assert.deepEqual(plain(splitTarget('wiki:Python%23Instalace%20na%20Windows')),
    {isWiki:true,path:'Python',anchor:'Instalace na Windows'});
  assert.deepEqual(plain(splitTarget('wiki:%23Instalace')),
    {isWiki:true,path:'',anchor:'Instalace'});
  assert.deepEqual(plain(splitTarget('Poznamky/Python.md#instalace-na-windows')),
    {isWiki:false,path:'Poznamky/Python.md',anchor:'instalace-na-windows'});
  assert.deepEqual(plain(splitTarget('#instalace')),
    {isWiki:false,path:'',anchor:'instalace'});
  assert.equal(splitTarget('soubor%23cislo.md').anchor,null);
  assert.equal(splitTarget('wiki:Python').anchor,null);
});
test('Hledání nadpisu podle názvu, hashe, diakritiky i duplicit', () => {
  const headings = ['Úvod', 'Instalace na Windows', 'Příklad: 1 + 1', 'Úvod'].map((s,i)=>({id:`wiki-heading-${i}`,textContent:s}));
  const container = {querySelectorAll:()=>headings};
  assert.equal(findHeading(container,'Instalace na Windows'),headings[1]);
  assert.equal(findHeading(container,'instalace-na-windows'),headings[1]);
  assert.equal(findHeading(container,'priklad-1-1'),headings[2]);
  assert.equal(findHeading(container,'uvod-1'),headings[3]);
  assert.equal(findHeading(container,'wiki-heading-2'),headings[2]);
  assert.equal(findHeading(container,'^blockid'),null);
  assert.equal(headingSlug('Přehled: síťové prvky'), 'prehled-sitove-prvky');
});
