const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');

// Exercise the production Worker and migrations in disposable PostgreSQL.
// Only the external GoTrue password service is replaced by a fixture.
test('account registration, workspace migration, isolation and admin recovery',async t=>{
 const {handleAccounts}=await import('../accounts.mjs');
 const db=await PGlite.create();
 const identity=new Map(),origin='https://test.wagewise.invalid',env={WAGEWISE_SUPABASE_SECRET:'sb_secret_fixture'};
 const config={url:'https://auth.invalid',publishableKey:'sb_publishable_fixture'};
 const sql=(query,params)=>db.query(query,params);
 t.after(()=>db.close());
 await db.exec("create role authenticated;create role anon;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb);create function auth.uid() returns uuid language sql as 'select null::uuid';");
 for(const migration of ['202611180001_wagewise_sync','202611220001_wagewise_accounts','202611230001_retire_pairing','202611230002_admin_reset','202611230003_register_updated_credentials','202611230004_link_admin_account'])
   await db.exec(readFileSync('supabase/migrations/'+migration+'.sql','utf8'));
 async function create({email,password,app_metadata}){
   const id=crypto.randomUUID();
   await db.transaction(async tx=>{
     await tx.query("insert into auth.users values($1,$2,'{}')",[id,email]);
     await tx.query('update auth.users set raw_app_meta_data=$2 where id=$1',[id,JSON.stringify(app_metadata)]);
   });
   identity.set(id,{id,email,password});return id;
 }
 t.mock.method(global,'fetch',async(url,options)=>{
   const path=new URL(url).pathname,data=options.body?JSON.parse(options.body):{};
   try{
    if(path.endsWith('/ww_admin_reset')){
     await sql('select public.ww_admin_reset($1,$2,$3)',[data.sid,data.username_input,data.code_digest]);return new Response(null,{status:204});
    }
    if(path.endsWith('/ww_account_api')){
     const r=await sql('select public.ww_account_api($1,$2,$3) as result',[data.op,JSON.stringify(data.p),data.sid]);return Response.json(r.rows[0].result);
    }
    if(path.endsWith('/admin/users'))return Response.json({id:await create(data)});
    if(path.includes('/admin/users/')&&options.method==='DELETE'){
     const id=path.split('/').at(-1);await sql('delete from auth.users where id=$1',[id]);identity.delete(id);return Response.json({});
    }
    if(path.endsWith('/token')){
     const user=[...identity.values()].find(v=>v.email===data.email&&v.password===data.password);
     return Response.json(user?{user:{id:user.id}}:{},{status:user?200:400});
    }
    throw Error('Unexpected Auth route');
   }catch(e){return Response.json({code:e.code},{status:400});}
 });
 async function call(route,data={},cookie=''){
  const res=await handleAccounts(new Request(origin+'/api/'+route,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(data)}),env,config);
  return {status:res.status,value:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]||''};
 }
 const user={username:'Test.Member',password:'entirely synthetic password'};
 assert.equal((await call('admin/ready')).value.enabled,false);
 const [one,two]=await Promise.all([call('account/signup',user),call('account/signup',user)]);
 const registered=[one,two].filter(v=>v.status===200);assert.equal(registered.length,1);
 const first=registered[0].cookie;
 const second=(await call('account/login',{...user,username:'TEST.MEMBER'})).cookie;
 assert.ok(second&&second!==first);
 assert.equal((await call('admin/dashboard',{},first)).status,401);
 const peer=await call('account/signup',{...user,username:'other-user'});
 const code='WW-'+'t'.repeat(43),ws=crypto.randomUUID();
 await sql("insert into wagewise_private.workspaces values($1,sha256(convert_to($2,'UTF8')))",[ws,code]);
 assert.equal((await call('account/preview',{code},first)).value.workspace,ws);
 const claims=await Promise.all([call('account/setup',{code},first),call('account/setup',{code},peer.cookie)]);
 assert.deepEqual(claims.map(r=>r.status),[200,409]);
 const snap={format:'wagewise',version:2,log:{days:{}},calculator:{history:[]}};
 assert.equal((await call('account/write',{workspace:ws,revision:0,mutation:crypto.randomUUID(),snapshot:snap},first)).value,1);
 assert.equal((await call('account/read',{workspace:ws},peer.cookie)).status,403);
 await call('account/forgot',user);await call('account/forgot',user);
 assert.equal((await call('account/session',{},second)).status,200);
 await create({email:'private@test.invalid',password:user.password,app_metadata:{ww_role:'admin',ww_username:'operator'}});
 const admin=(await call('admin/login',{username:'operator',password:user.password})).cookie;
 const dash=await call('admin/dashboard',{days:7,search:'member'},admin);
 assert.equal(dash.value.pending,1);assert.equal(dash.value.daily.length,7);assert.equal(dash.value.users.length,1);
 const request=dash.value.requests[0].id;
 const approval=await call('admin/approve',{request},admin);assert.ok(approval.value.code);
 assert.equal((await call('account/session',{},first)).status,401);
 assert.equal((await call('account/session',{},second)).status,401);
 assert.equal((await call('account/login',user)).status,403);
 const next={...user,password:'new entirely synthetic password',code:approval.value.code};
 assert.equal((await call('account/reset',next)).status,200);
 assert.equal((await call('account/reset',next)).status,400);
 assert.equal((await call('account/login',user)).status,401);
 const restored=await call('account/login',next);
 assert.deepEqual((await call('account/read',{workspace:ws},restored.cookie)).value.data,snap);
 assert.equal((await call('account/logout',{},restored.cookie)).status,200);
 assert.equal((await call('account/session',{},restored.cookie)).status,401);
 assert.equal((await call('admin/reset-user',{username:'other-user'},peer.cookie)).status,401);
 assert.ok((await call('admin/reset-user',{username:'other-user'},admin)).value.code);
 assert.equal((await call('account/session',{},peer.cookie)).status,401);
 await db.exec(readFileSync('tests/account-db.sql','utf8'));
 const linked=await call('account/login',next);
 assert.equal(linked.value.canAdmin,false);
 await sql('insert into wagewise_private.accounts(id,username,admin,admin_source) values(gen_random_uuid(),$1,true,$2)',
   [user.username.toLowerCase(),linked.value.id]);
 assert.equal((await call('account/session',{},linked.cookie)).value.canAdmin,true);
 assert.equal((await call('admin/dashboard',{},linked.cookie)).status,401);
 const operator=await call('admin/login',next);
 assert.equal(operator.value.admin,true);
 assert.equal((await call('admin/dashboard',{},operator.cookie)).status,200);
 assert.equal((await call('account/read',{workspace:ws},operator.cookie)).status,401);
 assert.equal((await call('admin/reset-user',{username:user.username},operator.cookie)).status,409);
 await sql('update wagewise_private.accounts set generation=generation+1 where id=$1',[linked.value.id]);
 assert.equal((await call('admin/session',{},operator.cookie)).status,401);
});
