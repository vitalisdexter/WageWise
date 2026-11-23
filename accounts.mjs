const usernamePattern=/^[a-z0-9][a-z0-9_.-]{2,31}$/;
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const codePattern=/^[A-Za-z0-9_-]{32}$/;
const cookieName=admin=>admin?'__Host-ww-admin':'__Host-ww-session';
const json=(body,status=200,headers={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
class Problem extends Error { constructor(status,message){super(message);this.status=status;} }
function fail(status,message){throw new Problem(status,message);}
const random=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replaceAll('+','-').replaceAll('/','_');
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
export function normalizeUsername(value){
 const name=typeof value==='string'?value.trim().toLowerCase():'';
 if(!usernamePattern.test(name))fail(400,'Use 3–32 letters, digits, dots, hyphens or underscores. Start with a letter or digit.');
 return name;
}
function password(value,creating){
 if(typeof value!=='string'||value.length<(creating?12:1)||new TextEncoder().encode(value).length>72)
   fail(400,creating?'Use a password of at least 12 characters and at most 72 UTF-8 bytes.':'Check your username and password.');
 return value;
}
function cookie(admin,token,age){return cookieName(admin)+'='+token+'; HttpOnly; Secure; Path=/; SameSite=Strict; Max-Age='+age;}
function readCookie(request,admin){
 const prefix=cookieName(admin)+'=';
 const token=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(prefix))?.slice(prefix.length);
 return token&&codePattern.test(token)?token:'';
}
async function body(request,max){
 if(!request.headers.get('content-type')?.startsWith('application/json'))fail(415,'Use the WageWise form.');
 const reader=request.body?.getReader();if(!reader)fail(400,'Empty request.');
 const decoder=new TextDecoder();let size=0,raw='';
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
   if(size>max){await reader.cancel();fail(413,'The request is too large.');}raw+=decoder.decode(value,{stream:true});}
 try{const result=JSON.parse(raw+decoder.decode());if(result&&typeof result==='object'&&!Array.isArray(result))return result;}catch{}
 fail(400,'Invalid request.');
}
export function backend(env,config){
 const key=env.WAGEWISE_SUPABASE_SECRET?.trim();
 if(!key)fail(503,'Account access is being configured. Try again shortly.');
 async function call(path,options={},publicKey=false){
   const apiKey=publicKey?config.publishableKey:key;
   const headers={apikey:apiKey,'Content-Type':'application/json',...(!apiKey.startsWith('sb_')?{Authorization:'Bearer '+apiKey}:{}),...options.headers};
   const response=await fetch(config.url+path,{...options,headers,redirect:'error'});
   const result=await response.json().catch(()=>null);
   return {ok:response.ok,status:response.status,result};
 }
 async function rpc(op,p={},sid=''){
   const r=await call('/rest/v1/rpc/ww_account_api',{method:'POST',body:JSON.stringify({op,p,sid})});
   if(!r.ok){
     if(r.result?.code==='42501')fail(401,'Sign in again to continue.');
     if(['P0001','23505','40001','40P01'].includes(r.result?.code))fail(409,'This record changed or is unavailable. Refresh and try again.');
     if(['22P02','23514','22023'].includes(r.result?.code))fail(400,'Check the information you entered.');
     fail(503,'The account service is unavailable. Please try again.');
   }
   return r.result;
 }
 return {rpc,call};
}
export async function accountSession(request,env,config,admin=false){
 const token=readCookie(request,admin);
 if(!token)fail(401,'Please sign in.');
 const sid=await digest(token);
 const session=await backend(env,config).rpc('session',{},sid);
 if(session.admin!==admin)fail(403,'This account cannot open this area.');
 return {...session,sid};
}
async function accounts(request,env,config){
 const url=new URL(request.url),admin=url.pathname.startsWith('/api/admin/'),route=url.pathname.split('/').at(-1);
 if(request.method!=='POST'||request.headers.get('origin')!==url.origin)fail(403,'Use the WageWise app.');
 const data=await body(request,route==='write'?6*1024*1024:16384);
 const db=backend(env,config);
 const limit=async (group,key,max)=>{
   if(!await db.rpc('limit',{key:await digest(group+':'+key),max}))fail(429,'Too many attempts. Try again in 15 minutes.');
 };
 const ip=request.headers.get('CF-Connecting-IP')||'local';
 if(route==='ready'&&admin)return json({enabled:await db.rpc('admin_ready')});
 if(['available','signup','login','forgot','reset'].includes(route)){
   if(admin&&route!=='login')fail(404,'Unknown action.');
   await limit(route,ip,route==='available'?60:route==='forgot'?12:40);
   const username=normalizeUsername(data.username);
   if(route==='available')return json({available:await db.rpc('available',{username})});
   if(route==='forgot'){
     await db.rpc('forgot',{username});return json({ok:true});
   }
   await limit(route+':user',username,route==='signup'?10:20);
   async function createIdentity(pass,metadata){
     const created=await db.call('/auth/v1/admin/users',{method:'POST',body:JSON.stringify({
       email:crypto.randomUUID()+'@accounts.wagewise.invalid',password:pass,email_confirm:true,app_metadata:metadata
     })});
     if(!created.ok)fail(created.status>=500?503:400,'Could not create the account credentials. Check the password and try again.');
     return created.result.id;
   }
   if(route==='reset'){
     const pass=password(data.password,true),code=data.code;
     if(typeof code!=='string'||!codePattern.test(code))fail(400,'Check the reset code.');
     const proof=await digest(code),id=await db.rpc('redeem',{username,digest:proof});
     if(!id)fail(400,'That code is invalid or expired.');
     const credential=await createIdentity(pass,{ww_recovery:id});
     let old;
     try{old=await db.rpc('finish_reset',{username,credential,digest:proof});}
     catch(e){
       // A referenced credential cannot be deleted, even if a commit response was lost.
       await db.call('/auth/v1/admin/users/'+credential,{method:'DELETE'}).catch(()=>{});throw e;
     }
     await db.call('/auth/v1/admin/users/'+old,{method:'DELETE'}).catch(()=>{});
     return json({ok:true});
   }
   const pass=password(data.password,route==='signup');
   if(route==='signup'){
     if(!await db.rpc('available',{username}))fail(409,'This username is taken.');
     await createIdentity(pass,{ww_username:username});
   }
   const account=await db.rpc('lookup',{username,admin});
   const checked=await db.call('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({
     email:account?.email??'unknown@accounts.wagewise.invalid',password:pass
   })},true);
   if(!checked.ok||!account||checked.result.user?.id!==account.credential)fail(401,'Check your username and password.');
   if(account.locked)fail(403,'Your account requires a new password. Use the reset code provided by the administrator.');
   const token=random(),session=await db.rpc('login',{id:account.id,generation:account.generation},await digest(token));
   return json(session,200,{'Set-Cookie':cookie(admin,token,admin?28800:1209600)});
 }
 const {sid,...session}=await accountSession(request,env,config,admin);
 if(route==='session')return json(session);
 if(route==='logout'){
   await db.rpc('logout',{},sid);return json({ok:true},200,{'Set-Cookie':cookie(admin,'',0)});
 }
 if(admin){
   if(route==='dashboard')return json(await db.rpc('dashboard',{days:data.days,search:String(data.search||'').slice(0,32),
     offset:Math.max(0,Math.min(1e6,Number(data.offset)||0)),inboxOffset:Math.max(0,Math.min(1e6,Number(data.inboxOffset)||0))},sid));
   if(['approve','decline'].includes(route)&&uuid.test(data.request)){
     const code=random();
     await db.rpc(route,{request:data.request,digest:await digest(code)},sid);
     return json(route==='approve'?{code,minutes:30}:{ok:true});
   }
 }else{
   if(route==='setup'||route==='preview'){
     await limit('claim',session.id,40);
     let proof={};
     if(data.code){
       if(!/^WW-[a-zA-Z0-9_-]{43}$/.test(data.code))fail(400,'Enter the full legacy pairing code.');
       proof={code:data.code};
     }else if(data.legacyToken){
       if(typeof data.legacyToken!=='string'||data.legacyToken.length>8192)fail(400,'Invalid paired session.');
       const r=await db.call('/auth/v1/user',{headers:{Authorization:'Bearer '+data.legacyToken}},true);
       if(!r.ok||!r.result.is_anonymous)fail(403,'Open your paired device or use its legacy pairing code.');
       proof={device:r.result.id};
     }else if(data.newWorkspace!==true||route!=='setup')fail(400,'Choose a workspace.');
     return json(await db.rpc(route,proof,sid));
   }
   if(['read','write'].includes(route)){
     if(!uuid.test(data.workspace)||data.workspace!==session.workspace)fail(403,'Sign in to the correct workspace.');
     if(route==='write'&&(!uuid.test(data.mutation)||!Number.isSafeInteger(data.revision)||data.revision<0))fail(400,'Invalid sync revision.');
     return json(await db.rpc(route,{workspace:data.workspace,revision:data.revision,mutation:data.mutation,snapshot:data.snapshot},sid));
   }
 }
 fail(404,'Unknown action.');
}
export async function handleAccounts(request,env,config){
 try{return await accounts(request,env,config);}catch(e){return json({error:e instanceof Problem?e.message:'The account service is unavailable.'},e instanceof Problem?e.status:503);}
}
