const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/canvas-editor.js'),'utf8');
function api() {
  const w={};
  vm.runInNewContext(source,{window:w,TextEncoder,console});
  return w.LocalWikiCanvasEditor;
}
const sample=()=>({
  metadata:{futureField:'keep'},nodes:[
    {id:'A',type:'text',x:0,y:0,width:210,height:130,text:'Hi',custom:{unknown:true}},
    {id:'B',type:'file',x:350,y:0,width:200,height:120,file:'Images/test.png',customFlag:8}
  ],edges:[{id:'E',fromNode:'A',toNode:'B',toEnd:'arrow',future:{safe:2}}]
});
test('draft preserves unknown top-level, node and edge properties through editing',()=>{
  const draft=api().createDraft(sample());
  draft.change(doc=>{doc.nodes[0].x=30;doc.nodes[0].text='Edited';});
  assert.equal(draft.dirty,true);
  assert.equal(draft.data.metadata.futureField,'keep');
  assert.equal(draft.data.nodes[0].custom.unknown,true);
  assert.equal(draft.data.edges[0].future.safe,2);
  draft.markSaved();
  assert.equal(draft.dirty,false);
  assert.equal(draft.data.nodes[0].text,'Edited');
});
test('Undo, Redo, Discard restore exact drafts without touching input',()=>{
  const original=sample(), draft=api().createDraft(original);
  draft.change(doc=>{doc.nodes[0].x+=25;});
  draft.change(doc=>{doc.nodes[1].height+=30;});
  assert.equal(draft.data.nodes[1].height,150);
  assert.ok(draft.undo());
  assert.equal(draft.data.nodes[1].height,120);
  assert.ok(draft.redo());
  assert.equal(draft.data.nodes[1].height,150);
  draft.discard();
  assert.equal(draft.dirty,false);
  assert.equal(draft.data.nodes[0].x,0);
  assert.equal(original.nodes[0].x,0);
});
test('invalid edits cannot add dangling edges, duplicate IDs or corrupt source draft',()=>{
  const draft=api().createDraft(sample());
  assert.throws(()=>draft.change(doc=>{doc.edges.push({id:'broken',fromNode:'lost',toNode:'B'});}),/dangling/);
  assert.throws(()=>draft.change(doc=>{doc.nodes.push({...doc.nodes[0]});}),/duplicate/);
  assert.equal(draft.data.edges.length,1);
  assert.equal(draft.dirty,false);
});
test('Canvas size and coordinate limits are enforced before save',()=>{
  const canvas=sample();
  canvas.nodes[0].x=Infinity;
  assert.throws(()=>api().validate(canvas),/Invalid/);
  canvas.nodes[0].x=0;
  canvas.nodes=Array.from({length:401},(_,i)=>({...canvas.nodes[0],id:String(i)}));
  assert.throws(()=>api().validate(canvas),/limit/);
});
