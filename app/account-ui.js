import {createClient} from '@supabase/supabase-js';
import config from '../supabase/client.json';

const admin=/^\/admin\/?$/.test(location.pathname);
const content=document.querySelector('#content'),message=document.querySelector('#message');
const el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
const offline='Connect to the internet to access WageWise.';
let username='',days=7,search='',offset=0,inboxOffset=0,screen=0,privateView=false;
function view(title){
 screen++;message.textContent='';const card=el('article');card.append(el('h1',title));content.replaceChildren(card);return card;
}
async function request(route,data={}){
 if(!navigator.onLine)throw Error(offline);
 const res=await fetch('/api/'+(admin?'admin/':'account/')+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),cache:'no-store',signal:AbortSignal.timeout(15000)});
 const result=await res.json().catch(()=>({error:'Open WageWise at its Cloudflare Worker address.'}));
 if(!res.ok||result?.error){const e=Error(result?.error||'Please try again.');e.status=res.status;throw e;}
 return result;
}
async function run(button,fn){if(button.disabled)return;button.disabled=true;message.textContent='';
 try{await fn();}catch(e){if(privateView&&e.status===401){privateView=false;login();}message.textContent=e.message;}finally{button.disabled=false;}}
function action(box,name,fn){const b=el('button',name);b.type='button';b.onclick=()=>run(b,fn);box.append(b);return b;}
function form(card,title,fn){
 const f=el('form'),b=el('button',title);b.type='submit';b.className='primary';f.append(b);card.append(f);
 f.onsubmit=e=>{e.preventDefault();run(b,()=>fn(Object.fromEntries(new FormData(f))));};return f;
}
function field(f,key,label,type,auto,value=''){
 const l=el('label',label),i=el('input');i.type=type;i.name=key;i.required=true;i.autocomplete=auto;i.value=value;
 l.append(i);f.insertBefore(l,f.lastChild);return i;
}
function login(){
 privateView=false;document.querySelector('main').className='';
 const c=view(admin?'Administrator sign-in':'Sign in to WageWise');
 const f=form(c,'Sign in',async d=>open(await request('login',d)));
 field(f,'username','Username','text','username',username);field(f,'password','Password','password','current-password');
 if(!admin){action(c,'Create account',signup);action(c,'Forgot password',forgot);action(c,'I have a reset code',reset);}
}
function signup(){
 const c=view('Choose a username'),f=form(c,'Continue',async d=>{
  const r=await request('available',d);if(!r.available)throw Error('This username is taken. Choose another.');
  username=d.username.trim();const next=view('Create your password');next.append(el('p',username));
  const pf=form(next,'Create account',async p=>open(await request('signup',{username,password:p.password})));
  field(pf,'password','Password · at least 12 characters','password','new-password').minLength=12;
  action(next,'Change username',signup);
 });
 field(f,'username','Username','text','username',username);action(c,'Back to sign-in',login);
}
function forgot(){
 const c=view('Request a password reset'),f=form(c,'Send request',async d=>{
  await request('forgot',d);username=d.username;login();message.textContent='If this account exists, the administrator will see your request. Contact them privately so they can verify you and give you a reset code.';
 });field(f,'username','Username','text','username',username);action(c,'Back to sign-in',login);
}
function reset(){
 const c=view('Choose a new password'),f=form(c,'Save new password',async d=>{
  await request('reset',d);username=d.username;login();message.textContent='Password changed. Sign in with your new password.';
 });field(f,'username','Username','text','username',username);field(f,'code','Code from your administrator','text','one-time-code');
 field(f,'password','New password · at least 12 characters','password','new-password').minLength=12;action(c,'Back to sign-in',login);
}
function home(){const date=new URLSearchParams(location.search).get('log');location.replace(/^\d{4}-\d\d-\d\d$/.test(date)?'/?log='+date:'/');}
async function open(session){
 privateView=true;
 if(admin)return dashboard();
 if(session.workspace){localStorage.setItem('ww-session-change',crypto.randomUUID());return home();}
 const c=view('Set up your WageWise account');c.append(el('p','Signed in as '+session.username+'. Choose where to start. Local records can be reviewed and moved in Settings.'));
 const preview=async proof=>{
   const result=await request('preview',proof);
   const box=view('Move existing WageWise data');box.append(el('p',result.payEntries+' saved pay entries and '+result.logDays+' logged days in this workspace. Your other devices will use your new login.'));
   action(box,'Move this workspace',async()=>{await request('setup',proof);home();});action(box,'Go back',()=>open(session));
 };
 const f=form(c,'Find paired records',d=>preview({code:d.code.trim()}));field(f,'code','Previous pairing code','password','off');
 action(c,'Use this paired device',async()=>{
  const legacy=createClient(config.url,config.publishableKey,{auth:{detectSessionInUrl:false,autoRefreshToken:false}});
  const {data}=await legacy.auth.getSession();
  if(!data.session)throw Error('No paired session found here. Use the previous pairing code.');
  await preview({legacyToken:data.session.access_token});
 });
 action(c,'Start a new workspace',async()=>{await request('setup',{newWorkspace:true});home();});
 action(c,'Sign out',logout);
}
async function logout(){await request('logout');login();}
const dateText=d=>new Date(d).toLocaleString('en-GB');
function section(title){const c=el('section');c.append(el('h2',title));content.append(c);return c;}
function table(parent,cols,rows){
 const t=el('table'),h=el('tr');cols.forEach(k=>h.append(el('th',k)));t.append(h);
 for(const row of rows){const tr=el('tr');row.forEach(v=>{const cell=el('td');cell.append(v instanceof Node?v:String(v??''));tr.append(cell);});t.append(tr);}
 parent.append(t);
}
async function issueCode(name,route,data){
 if(!confirm('Have you verified '+name+' through a trusted channel? This signs them out on all devices.'))return;
 const epoch=screen;
 const {code}=await request(route,data);
 if(epoch!==screen||document.hidden||!privateView)return;
 const box=view('Reset code for '+name);
 box.append(el('p','Give this code privately to the verified user. It expires in 30 minutes.'),el('code',code));
 action(box,'Back to dashboard',dashboard);
}
async function dashboard(){
 const epoch=screen,data=await request('dashboard',{days,search,offset,inboxOffset});
 if(epoch!==screen||document.hidden)return;
 const c=view('Account analytics');privateView=true;document.querySelector('main').className='admin';
 for(const d of [7,30]){const b=action(c,d+' days',()=>{days=d;return dashboard();});b.disabled=d===days;}
 action(c,'Refresh',dashboard);action(c,'Sign out',logout);
 const cards=el('div');cards.className='row';c.append(cards);
 const sum=k=>data.daily.reduce((s,row)=>s+row[k],0);
 for(const [label,value] of [['Accounts',data.total],['New accounts',sum('registrations')],['Active users',data.active],['Sign-ins',sum('logins')],['Pending resets',data.pending]]){
  const item=el('div',label);item.className='metric';item.append(el('strong',String(value)));cards.append(item);
 }
 const inbox=section('Password reset inbox');
 if(!data.requests.length)inbox.append(el('p','No open requests.'));
 for(const r of data.requests){
  const row=el('div');row.append(el('strong',r.username),el('p',r.state+' · '+dateText(r.requested)));
  action(row,r.state==='approved'?'Issue replacement code':'Approve reset',()=>issueCode(r.username,'approve',{request:r.id}));
  if(r.state==='pending')action(row,'Decline',async()=>{await request('decline',{request:r.id});await dashboard();});inbox.append(row);
 }
 function pager(box,start,count,set){if(start>0)action(box,'Previous page',()=>{set(start-100);return dashboard();});if(count===100)action(box,'Next page',()=>{set(start+100);return dashboard();});}
 pager(inbox,inboxOffset,data.requests.length,n=>inboxOffset=n);
 const users=section('Users');const f=form(users,'Search',d=>{search=d.search;offset=0;return dashboard();});
 field(f,'search','Find username','search','off',search).required=false;
 table(users,['Username','Registered','Status','Recovery'],data.users.map(r=>{
   const controls=el('span');action(controls,'Reset password',()=>issueCode(r.username,'reset-user',{username:r.username}));
   return [r.username,dateText(r.created_at),r.locked?'Password reset required':'Active',controls];
 }));
 pager(users,offset,data.users.length,n=>offset=n);
 table(section('Sign-in trend · UTC'),['Date','Registrations','Sign-ins'],data.daily.map(r=>[r.day,r.registrations,r.logins]));
 table(section('Reset history'),['User','Action','By','Time'],data.audit.map(r=>[r.username,r.action,r.actor||'Account holder',dateText(r.at)]));
}
async function start(){
 const epoch=screen;
 try{
  if(admin&&!(await request('ready')).enabled){view('Administrator setup pending');return;}
  const session=await request('session');if(epoch===screen)await open(session);
 }catch(e){if(epoch!==screen)return;login();if(e.status!==401)message.textContent=e.message;}
}
function hide(){if(privateView){privateView=false;view('Checking your account…');}}
window.addEventListener('offline',()=>{hide();message.textContent=offline;});
document.addEventListener('visibilitychange',()=>{if(document.hidden)hide();else if(content.querySelector('h1')?.textContent==='Checking your account…')start();});
window.addEventListener('pageshow',e=>{if(e.persisted){hide();start();}});
window.addEventListener('online',start);
if(admin)setInterval(async()=>{
 if(!privateView||document.hidden)return;
 try{await request('session');}catch{hide();await start();}
},15000);
start();
