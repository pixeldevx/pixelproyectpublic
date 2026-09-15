const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync('lib/platform/server.ts','utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
class AccessError extends Error { constructor(message,status=403){super(message);this.status=status;} }
const actor = { id:'global-id',email:'global@example.test',email_confirmed_at:'2026-09-01T00:00:00Z' };
function fixture(options={}) {
  const calls=[];
  const client={auth:{getUser:async(token)=>{calls.push(['token',token]);return {data:{user:options.user===undefined?actor:options.user},error:null};}},from(table){
    calls.push(['table',table]);
    const q={select(){return q;},eq(key,value){calls.push(['eq',key,value]);return q;},async maybeSingle(){return {error:null,data:table==='app_workspace_members'
      ? {workspace_id:'original-space',role:options.memberRole||'owner',suspended_at:options.suspended?'now':null}
      : {owner_id:options.ownerId||'global-id',legacy_storage:options.legacy!==false}};}};return q;
  }};
  const loaded={exports:{}};
  new Function('require','module','exports',source)((name)=>name==='@/lib/workspaces/server'?{
    createPlatformClient:()=>client,isPlatformAdministrator:(u)=>u.email===actor.email,
    requestAccessToken:(r)=>(r.headers.get('authorization')||'').replace(/^Bearer /,''),WorkspaceAccessError:AccessError,
  }:require(name),loaded,loaded.exports);
  return {...loaded.exports,calls};
}
const request=(token='verified-token')=>new Request('https://pixel.test/api/platform?actor_id=forged',{headers:token?{authorization:`Bearer ${token}`,'x-workspace-id':'forged'}:{}});
test('global endpoint denies visitors and ordinary workspace admins before listing data',async()=>{
  const anonymous=fixture();await assert.rejects(anonymous.requirePlatformAdmin(request('')),(e)=>e.status===401);assert.equal(anonymous.calls.length,0);
  const ordinary=fixture({user:{...actor,id:'tenant-id',email:'tenant@example.test',user_metadata:{role:'admin',is_platform_admin:true}}});
  await assert.rejects(ordinary.requirePlatformAdmin(request()),(e)=>e.status===403);
  assert.equal(ordinary.calls.filter(c=>c[0]==='table').length,0);
});
test('global authorization requires confirmed email and the original unsuspended owner membership',async()=>{
  for(const options of [{user:{...actor,email_confirmed_at:null}},{memberRole:'admin'},{legacy:false},{suspended:true},{ownerId:'someone-else'}]){
    await assert.rejects(fixture(options).requirePlatformAdmin(request()));
  }
});
test('global authorization derives identity from verified token, never request headers or metadata',async()=>{
  const f=fixture();const result=await f.requirePlatformAdmin(request());assert.equal(result.actor.id,'global-id');
  assert.ok(f.calls.some(c=>c[0]==='eq'&&c[1]==='user_id'&&c[2]==='global-id'));
  assert.ok(!f.calls.some(c=>c.includes('forged')));
});
test('support mutations reject missing reason and ignore unauthorized field injection',()=>{
  const f=fixture();assert.throws(()=>f.supportReason(' '));assert.throws(()=>f.supportReason('a'.repeat(501)));
  assert.deepEqual(f.allowedChanges({name:'Valid',owner_id:'attacker',tenant_id:'attacker',reason:'Reason'},['name']),{name:'Valid'});
  assert.throws(()=>f.allowedChanges({owner_id:'attacker'},['name']));
});
test('global responses never allow shared caching and internal database failures stay generic',async()=>{
  const f=fixture();const response=f.platformJson({ok:true});assert.equal(response.headers.get('cache-control'),'private, no-store');
  await assert.rejects(f.platformRpc({rpc:async()=>({error:{code:'XX000',message:'private data'}})},'test',{}),(e)=>e.status===500&&!e.message.includes('private data'));
});
