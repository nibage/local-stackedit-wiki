/* Contract tests for the safe JSON Canvas 1.0 input normalizer. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/canvas-viewer.js'),'utf8');
function api(){const w={};vm.runInNewContext(source,{window:w});return w.LocalWikiCanvas;}
test('graph supports valid nodes, edges, directions and colors',()=>{
 const model=api().cleanGraph({nodes:[
  {id:'a',type:'text',x:0,y:-5,width:180,height:120,text:'<script>alert(1)</script>',color:'5'},
  {id:'b',type:'group',x:250,y:2,width:250,height:200,label:'Group',color:'#abc'}
 ],edges:[{fromNode:'a',toNode:'b',fromSide:'right',toSide:'left',label:'arrow'}]});
 assert.equal(model.nodes.length,2);
 assert.equal(model.edges.length,1);
 assert.equal(model.nodes[0].text,'<script>alert(1)</script>');
 assert.equal(model.edges[0].toArrow,true);
 assert.equal(model.skipped,0);
 assert.equal(model.nodes[1].color,'#abc');
});
test('malformed nodes, dangling edges and CSS injection are ignored',()=>{
 const m=api().cleanGraph({nodes:[
  {id:'a',type:'text',x:0,y:0,width:100,height:100,color:'url(javascript:bad)'},
  {id:'b',type:'widget',x:10,y:10,width:100,height:100},
  {id:'a',type:'text',x:10,y:10,width:100,height:100}],
 edges:[{fromNode:'missing',toNode:'a'}]});
 assert.equal(m.nodes.length,1);assert.equal(m.edges.length,0);assert.equal(m.skipped,3);
 assert.equal(m.nodes[0].color,'#718096');
});
test('local file paths are vault-root-relative, never traversal or remote URLs',()=>{
 const p=api().canonicalPath;
 assert.equal(p('Attachments\\photo.png'),'Attachments/photo.png');
 for(const input of ['../secret.svg','folder/../secret.svg','/etc/passwd','https://example.org/a.svg','javascript:foo','a//x.png','x.svg?remote=1','C:\\file.svg']){
  assert.equal(p(input),null,input);
 }
});
test('limit large untrusted canvases',()=>{
 assert.throws(()=>api().cleanGraph({nodes:Array.from({length:401},(_,i)=>({id:String(i),type:'text',x:0,y:0,width:100,height:100}))}),/limit/);
 assert.throws(()=>api().cleanGraph([]),/Invalid/);
});
