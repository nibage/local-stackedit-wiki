/* Safe folder moves, including unknown binary files and link migration. */
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const context={TextDecoder,TextEncoder,Uint8Array,console};context.window=context;
for(const name of ['file-system.js','wiki-index.js','link-migration.js']){
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src',name),'utf8'),context,{filename:name});
}
class File {
 constructor(name,content){this.name=name;this.kind='file';this.bytes=Buffer.from(content);this.lastModified=100;this.mutateOnWrite=null;}
 async getFile(){const bytes=Buffer.from(this.bytes);return {size:bytes.length,lastModified:this.lastModified,
   arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)}}
 async createWritable(){let written;return {write:async value=>{written=Buffer.from(value)},
   close:async()=>{this.bytes=written;this.lastModified++;if(this.mutateOnWrite)this.mutateOnWrite()},
   abort:async()=>{}}}
}
class Dir {
 constructor(name,items=[]){this.name=name;this.kind='directory';this.entries=new Map(items.map(i=>[i.name,i]));this.failDelete=false;}
 async *values(){yield* this.entries.values();}
 async getDirectoryHandle(name,{create=false}={}){
   let dir=this.entries.get(name);
   if(!dir&&create){dir=new Dir(name);this.entries.set(name,dir)}
   if(!dir||dir.kind!=='directory')throw Error('Missing directory: '+name);
   return dir;
 }
 async getFileHandle(name,{create=false}={}){
   let file=this.entries.get(name);
   if(!file&&create){file=new File(name,'');this.entries.set(name,file)}
   if(!file||file.kind!=='file')throw Error('Missing file: '+name);
   return file;
 }
 async removeEntry(name,{recursive=false}={}){
   if(this.failDelete)throw Error('Deletion blocked');
   const obj=this.entries.get(name);
   if(!obj)throw Error('Missing item');
   if(obj.kind==='directory'&&obj.entries.size&&!recursive)throw Error('Not empty');
   this.entries.delete(name);
 }
}
async function create(){
 const image=Buffer.from([0,1,255,128,5,0]);
 const source=new Dir('Group',[new File('child.md','# Child\n\n[Root](../Root.md) ![x](pic.png)\n'),
   new File('pic.png',image),new File('odd.xyz',Buffer.from([5,255,19]))]);
 const dest=new Dir('Dest');
 const root=new Dir('Wiki',[new File('Root.md','[Child](Group/child.md) ![[Group/pic.png]]'),source,dest]);
 context.showDirectoryPicker=async()=>root;
 const bridge=context.LocalWikiFS.createBridge();await bridge.openWritable();
 return {bridge,root,source,dest,image};
}
test('moves nested folder and preserves all bytes, including unknown extensions',async()=>{
 const {bridge,root,dest,image}=await create();
 const snapshots=await context.LocalWikiMigration.snapshotAll(bridge);
 const plan=context.LocalWikiMigration.planDirectory(snapshots,'Group','Dest/Group',bridge.getAssetPaths());
 assert.equal(plan.oldPath,'Group');
 assert.ok(plan.totalLinks>=3,plan);
 const res=await context.LocalWikiMigration.executeDirectory(bridge,plan,snapshots);
 assert.equal(res.moved,'Dest/Group');
 assert.equal(root.entries.has('Group'),false);
 assert.equal(dest.entries.has('Group'),true);
 assert.equal(bridge.hasFile('Dest/Group/child.md'),true);
 assert.equal(bridge.hasAsset('Dest/Group/pic.png'),true);
 assert.equal(dest.entries.get('Group').entries.get('pic.png').bytes.equals(image),true);
 assert.equal(dest.entries.get('Group').entries.get('odd.xyz').bytes.equals(Buffer.from([5,255,19])),true);
 assert.equal((await bridge.readRaw('Root.md')).text.includes('Dest/Group/child.md'),true);
 assert.equal((await bridge.readRaw('Root.md')).text.includes('Dest/Group/pic.png'),true);
 assert.equal((await bridge.readRaw('Dest/Group/child.md')).text.includes('../../Root.md'),true);
 assert.equal((await bridge.readRaw('Dest/Group/child.md')).text.includes('![x](pic.png)'),true);
});
test('refuses destination inside source and case-insensitive existing names',async()=>{
 const {bridge,root}=await create();
 await assert.rejects(()=>bridge.moveDirectory('Group','Group/deep'),/descendant|itself/);
 await assert.rejects(()=>bridge.moveDirectory('Group','Dest'),/exists/);
 assert.equal(root.entries.has('Group'),true);
});
test('read-only mode and unknown/hidden configs do not move folders',async()=>{
 const {bridge,source,root}=await create();
 source.entries.set('.git',new Dir('.git',[new File('config','secret')]));
 await assert.rejects(()=>bridge.moveDirectory('Group','Dest/Group'),/protected/);
 assert.equal(root.entries.has('Group'),true);
});
test('copy verification detects changes and preserves source folder',async()=>{
 const {bridge,source,root,dest}=await create();
 // The source changes as the first destination file is written.
 const oldGet=dest.getDirectoryHandle.bind(dest);
 dest.getDirectoryHandle=async(name,opts)=>{
   const dir=await oldGet(name,opts);
   dir.getFileHandle=async(fileName,{create=false}={})=>{
     let child=dir.entries.get(fileName);
     if(!child&&create){
       child=new File(fileName,'');
       child.mutateOnWrite=()=>{ const sourceNote=source.entries.get('child.md');
         sourceNote.bytes=Buffer.from('# externally edited');sourceNote.lastModified++; };
       dir.entries.set(fileName,child);
     }
     return child;
   };
   return dir;
 };
 await assert.rejects(()=>bridge.moveDirectory('Group','Dest/Group'),/changed/);
 assert.equal(root.entries.has('Group'),true);
 assert.equal(dest.entries.has('Group'),false);
});
test('folder migration does not modify code blocks or external URLs',async()=>{
 const {bridge}=await create();
 const snaps=await context.LocalWikiMigration.snapshotAll(bridge);
 snaps.get('Root.md').text+='\n`[skip](Group/child.md)`\n```md\n[skip](Group/child.md)\n```\n';
 const p=context.LocalWikiMigration.planDirectory(snaps,'Group','Dest/Group',bridge.getAssetPaths());
 const root=p.changes.find(x=>x.path==='Root.md').after;
 assert.ok(root.includes('`[skip](Group/child.md)`'));
 assert.ok(root.includes('\n[skip](Group/child.md)\n```'));
});
