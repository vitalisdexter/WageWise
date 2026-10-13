const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Payroll=require('../payroll');
// A minimal DOM test double runs the actual app script, not a duplicate implementation.
function app(saved){
  const elements=new Map();
  function element(id){if(!elements.has(id))elements.set(id,{
    value:'',checked:false,disabled:false,hidden:false,textContent:'',innerHTML:'',listeners:{},
    classList:{add(){},remove(){},toggle(){}},
    addEventListener(type,fn){this.listeners[type]=fn;},setAttribute(){},removeAttribute(){},toggleAttribute(){},hasAttribute(){return false;},focus(){},click(){}
  });return elements.get(id);}
  const storage=new Map(saved?[['wagewise-v5',JSON.stringify(saved)]]:[]);
  const TestDate=class extends Date{constructor(...args){super(...(args.length?args:['2026-10-13T12:00:00Z']));}static now(){return Date.parse('2026-10-13T12:00:00Z');}};
  const ctx={Payroll,console,Intl,Date:TestDate,Number,JSON,Math,URL,Blob,setTimeout(){},clearTimeout(){},confirm(){return true;},location:{protocol:'http:'},navigator:{userAgent:'test'},
    document:{getElementById:element,createElement:()=>element('created'),head:{appendChild(){}},documentElement:element('root'),querySelectorAll:()=>[],querySelector:()=>null},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},addEventListener(){},print(){}};
  ctx.window=ctx;
  let script=[...fs.readFileSync('wagewise.html','utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  const end=script.lastIndexOf('})();');
  script=script.slice(0,end)+'window.api={state,calc,calcWith,getPayslipData,buildPayslipHTML,shiftResult,renderResults,renderDashboard,enterDetailEdit,updateDePreview,setSource:function(v){_psSource=v;},setDetail:function(v){_did=v;},saveYtd};'+script.slice(end);
  vm.runInNewContext(script,ctx,{timeout:2000});
  return {api:ctx.api,element,storage,fire:(id,type='click')=>element(id).listeners[type].call(element(id),{target:element(id),preventDefault(){}})};
}
test('app boots and keeps empty overtime after reload',()=>{const a=app({otEntries:[],payDate:'2026-09-18'});assert.equal(a.api.state.otEntries.length,0);assert.ok(a.element('out-net').textContent.startsWith('£'));});
test('shift rollover, equal times and break handling',()=>{const a=app();assert.equal(a.api.shiftResult({startTime:'22:00',endTime:'06:00',breakMins:30}).hours,7.5);assert.equal(a.api.shiftResult({startTime:'08:00',endTime:'08:00'}).hours,0);assert.equal(a.api.shiftResult({startTime:'08:00',endTime:'09:00',breakMins:90}).hours,0);});
test('saved manual payslip does not recalculate with current settings',()=>{
 const a=app({history:[{id:1,date:'2026-06-05',manual:true,gross:700,net:555,tax:100,ni:35}],basic:900});a.api.setSource(1);
 const d=a.api.getPayslipData();assert.equal(d.gross,700);assert.equal(d.net,555);assert.equal(d.customDedRes.total,10);assert.equal(d.taxW,100);
 const html=a.api.buildPayslipHTML(d,false);assert.match(html,/£555.00/);assert.match(html,/£100.00/);assert.doesNotMatch(html,/NaN|undefined/);
});
test('payslip uses current tax deduction, not cumulative liability',()=>{
 const a=app({payDate:'2026-09-18',basic:800,otEntries:[],ytd:{enabled:true,gross:'12000',tax:'1450',ni:'600',week:'23',year:2026}});
 const d=a.api.getPayslipData(),r=a.api.calc(),html=a.api.buildPayslipHTML(d,true);
 assert.match(html,new RegExp('£'+Math.abs(r.taxW).toFixed(2).replace('.','\\.')));assert.equal(d.taxBreakdown[0].tax,r.taxW);
});
test('names and deduction names are escaped, not executable HTML',()=>{
 const a=app({employeeName:'<img src=x onerror=alert(1)>',employerName:'<script>bad</script>',customDeductions:[{name:'<img src=x>',type:'amount',value:5}]});
 const h=a.api.buildPayslipHTML(a.api.getPayslipData(),false);assert.doesNotMatch(h,/<img|<script>/);assert.match(h,/&lt;img/);
});
test('changing date invalidates incompatible YTD and disables saving',()=>{
 const a=app({payDate:'2026-09-18',ytd:{enabled:true,gross:'12000',tax:'1450',ni:'',week:'23',year:2026}});a.api.state.payDate='2026-09-25';a.api.renderResults();assert.equal(a.element('save-pay-btn').disabled,true);assert.equal(a.element('out-net').textContent,'—');
});
test('save carries calculation and deductions snapshot',()=>{
 const a=app({payDate:'2026-09-18',customDeductions:[{name:'Union',type:'amount',value:4}]});a.element('edate-calc').value='2026-09-18';a.fire('save-calc-btn');
 const e=a.api.state.history[0];assert.equal(e.snapshot.customDedRes.total,4);assert.equal(e.allowance,12570);assert.equal(e.customDeductions[0].value,4);
 a.api.state.customDeductions=[];a.api.setSource(e.id);assert.equal(a.api.getPayslipData().net,e.net);
});
test('manual entry preserves unknown tax and permits a zero net',()=>{
 const a=app();a.element('edate-manual').value='2026-06-05';a.element('m-gross').value='100';a.element('m-net').value='0';a.fire('save-manual-btn');assert.equal(a.api.state.history[0].tax,null);assert.equal(a.api.state.history[0].net,0);
});
test('dashboard YTD starts 6 April and excludes future entries',()=>{
 const a=app({history:[{id:1,date:'2026-04-01',gross:100,net:100},{id:2,date:'2026-04-06',gross:200,net:200},{id:3,date:'2099-01-01',gross:300,net:300}]});a.api.renderDashboard();assert.match(a.element('dash-stats').innerHTML,/YTD Net<\/div><div class="stat-value">£200.00/);
});
