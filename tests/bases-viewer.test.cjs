/* Pure contract tests for the safe, offline Obsidian Bases parser. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),
 path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/bases-viewer.js'),'utf8');
function api(){const w={};vm.runInNewContext(source,{window:w});return w.LocalWikiBases;}
test('parse nested views and filters from Obsidian .base YAML',()=>{
 const a=api(), base=a.parseYaml('filters:\n  and:\n    - file.ext == "md"\nviews:\n  - type: table\n    name: My table\n    order:\n      - file.name\n      - note.status\n  - type: table\n    name: Second\n');
 assert.equal(base.views.length,2);
 assert.equal(base.views[0].order[1],'note.status');
 assert.equal(base.filters.and[0],'file.ext == "md"');
 const row=a.fileData('Folder/Test.md',{status:'done'});
 assert.equal(a.filterFunction(base.filters)(row),true);
 assert.equal(a.property(row,'note.status'),'done');
 assert.equal(a.property(row,'file.folder'),'Folder');
});
test('basic filters, tags, folders and comparisons',()=>{
 const a=api(),row=a.fileData('Attachments/Book.md',{status:'done',rating:8,tags:['books']});
 assert.equal(a.filterFunction({and:['file.ext == "md"','note.rating >= 7','file.inFolder("Attachments")']})(row),true);
 assert.equal(a.filterFunction({or:['status == "todo"','file.hasTag("books")']})(row),true);
 assert.equal(a.filterFunction({not:['status == "done"']})(row),false);
 assert.throws(()=>a.filterFunction('formula.custom > 5'),/Unsupported/);
 assert.throws(()=>a.filterFunction('file.hasLink("secret")'),/Unsupported/);
});
test('parse literal frontmatter but never execute code or YAML features',()=>{
 const a=api();
 assert.equal(a.readFrontmatter('---\nstatus: done\ntags: [one, two]\n---\n# Body').status,'done');
 assert.equal(a.readFrontmatter('# no YAML').status,undefined);
 assert.throws(()=>a.parseYaml('bad: !evil'),/Unsupported/);
 assert.throws(()=>a.parseYaml('constructor: nope'),/Unsafe/);
 assert.throws(()=>a.parseYaml('bad:\n\tvalue: 4'),/indentation/);
});

test('temporary Bases filters handle text, numeric and tags without mutating rows',()=>{
 const a=api();
 const rows=[
  a.fileData('Notes/First.md',{status:'done',score:9,tags:['work']}),
  a.fileData('Notes/Second.md',{status:'todo',score:2,tags:['home']}),
  a.fileData('Notes/Third.md',{status:'done',score:4,tags:['home']})
 ];
 const rules=[{key:'status',op:'equals',value:'done'},{key:'score',op:'greater',value:'5'}];
 assert.equal(a.applyTemporary(rows,rules,'and',false).length,1);
 assert.equal(a.applyTemporary(rows,rules,'or',false).length,2);
 assert.equal(a.applyTemporary(rows,rules,'and',true).length,2);
 assert.equal(a.applyTemporary(rows,[{key:'file.tags',op:'tag',value:'#work'}]).length,1);
 assert.equal(a.applyTemporary(rows,[{key:'file.name',op:'contains',value:'second'}]).length,1);
 assert.equal(rows.length,3);
});
test('unsupported temporary filters cannot evaluate expressions',()=>{
 const a=api(),rows=[a.fileData('A.md',{value:'x'})];
 assert.equal(a.applyTemporary(rows,[{key:'formula.hidden',op:'equals',value:'x'}]).length,0);
 assert.equal(a.applyTemporary(rows,[{key:'value',op:'badOperator',value:'x'}]).length,0);
 assert.throws(()=>a.applyTemporary(rows,Array.from({length:9},()=>({key:'value',op:'equals',value:'x'}))),/eight/);
});
