(() => {
 'use strict';
 let identity=null,valid=false,checking;
 const lock=document.getElementById('account-lock');
 const cover=(text='Checking your account…')=>{
   valid=false;document.documentElement.classList.add('account-locked');lock.textContent=text;
   for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
 };
 function login(){
   cover();const date=new URL(location.href).searchParams.get('log');
   location.replace('/account.html'+(/^\d{4}-\d\d-\d\d$/.test(date)?'?log='+date:''));
 }
 async function request(route,data={}){
   if(!navigator.onLine){cover('Connect to the internet to open WageWise.');throw Error('Offline');}
   let response;
   try{response=await fetch('/api/account/'+route,{method:'POST',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});}
   catch(e){cover('Connection lost. Reconnect to open WageWise.');throw e;}
   if(response.status===401||response.status===403){login();throw Error('Sign in again.');}
   const result=await response.json();
   if(!response.ok)throw Error(result.error||'Could not reach WageWise.');
   return result;
 }
 let initialized=false;
 function reveal(){if(identity&&valid&&initialized&&navigator.onLine&&!document.hidden)document.documentElement.classList.remove('account-locked');}
 async function verify(){
   const s=await request('session');
   if(!s.workspace||s.admin||identity&&s.id!==identity.id){login();throw Error('Sign in to this account.');}
   identity=s;valid=true;reveal();return s;
 }
 const ready=verify().catch(e=>{
   cover('Reconnect or reload to open WageWise.');
   if(location.hostname.endsWith('.pages.dev')){
     const link=document.createElement('a');link.href='https://wagewise.vitalisdexter.workers.dev/';
     link.textContent='Open WageWise to sign in';lock.replaceChildren(link);
   }
   throw e;
 });
 const check=()=>checking??=verify().catch(()=>cover('Reconnect to verify your account.')).finally(()=>{checking=null;});
 function resume(){if(!initialized){location.reload();return;}check();}
 document.addEventListener('visibilitychange',()=>{if(document.hidden)cover();else resume();});
 window.addEventListener('pagehide',()=>cover());window.addEventListener('pageshow',e=>{if(e.persisted)resume();});
 window.addEventListener('offline',()=>cover('Connect to the internet to open WageWise.'));
 window.addEventListener('online',resume);
 window.addEventListener('storage',event=>{if(event.key==='ww-session-change'){cover();resume();}});
 setInterval(()=>{if(!document.hidden&&initialized)check();},15000);
 window.addEventListener('wagewise-ready',()=>{initialized=true;reveal();},{once:true});
 window.WageWiseAccess={ready,request,login,get valid(){return valid&&navigator.onLine;},get identity(){return identity;}};
})();
