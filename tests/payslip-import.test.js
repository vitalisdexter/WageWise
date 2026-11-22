const test=require('node:test');
const assert=require('node:assert/strict');
const P=require('../app/payslip-import');
const Tracking=require('../app/tracking');
function parse(rows) {
  const page=rows.flatMap((row,i)=>row.map(([x,text])=>({text,x,y:20*i,w:text.length*4,h:10})));
  return P.parse([page]);
}
test('parallel earnings and deduction panels with below-label amounts',()=>{
  const d=parse([
    [[0,'Example Ltd']],[[0,'Pay date'],[110,'Period'],[200,'Tax code']],
    [[0,'06/11/2026'],[110,'31'],[200,'S1257L']],
    [[0,'Pay & allowances'],[300,'Deductions'],[540,'This period']],
    [[0,'Back pay'],[220,'155.92'],[300,'Tax'],[470,'171.53']],
    [[0,'OT1 Hours'],[110,'19.25x16.5000'],[220,'317.63'],[300,'National Insurance'],[470,'60.21']],
    [[0,'Weekly salary'],[220,'604.13'],[540,'Total pay']],[[550,'1077.68']],
    [[540,'Net pay']],[[550,'845.94']],
    [[0,'Gross pay t/d'],[130,'Tax paid t/d'],[240,'Employee NI t/d']],
    [[0,'20949.54'],[130,'2699.76'],[240,'1036.44']] ]);
  assert.equal(d.date,'2026-11-06');assert.equal(d.period,'31');assert.equal(d.net,84594);
  assert.equal(d.gross,107768);assert.equal(d.ytdGross,null);assert.equal(d.ytdTotal,2094954);
  assert.equal(d.ytdTax,269976);assert.equal(d.ytdNi,103644);
  assert.deepEqual(P.totals(d.lines),{gross:107768,deductions:23174,credits:0,basic:60413,overtime:31763,hours:19.25,tax:17153,ni:6021});
  assert.deepEqual(P.differences(d),{gross:0,net:0});
});
test('monthly columns distinguish current money from YTD even when YTD comes first',()=>{
  for(const reverse of [false,true]){
    const d=parse([[[0,'Pay date: 30/10/2026']],[[0,'Tax month 7']],
      [[0,'Description'],[150,reverse?'Year to date':'Current'],[280,reverse?'Current':'Year to date']],
      ...[['Basic pay','2100.00','14700.00'],['Taxable pay','2000.00','14000.00'],['PAYE','220.00','1540.00'],['Net payment','1880.00','13160.00']].map(([key,a,b])=>[[0,key],[150,reverse?b:a],[280,reverse?a:b]])]);
    assert.equal(d.frequency,'monthly');assert.equal(d.net,188000);assert.equal(d.ytdGross,1400000);assert.equal(d.ytdTax,154000);
    assert.equal(d.lines.find(r=>r.kind==='basic').pence,210000);
  }
});
test('unfamiliar stacked layout retains custom rows, tax refunds and net-only reimbursements',()=>{
  const d=parse(['Pay date: 12 June 2026','Earnings','Basic salary 600.00','Callout premium 60.00','Bonus 25.00','Gross pay 685.00','Deductions','Service charge 15.00','Tax rebate 8.00','Expenses reimbursement 12.00','Take-home pay 690.00'].map(s=>[[0,s]]));
  assert.equal(d.date,'2026-06-12');assert.equal(d.lines.find(r=>r.label==='Callout premium').kind,'earning');
  assert.equal(P.totals(d.lines).tax,-800);assert.deepEqual(P.differences(d),{gross:0,net:0});
});
test('separate hours and rate columns, printed monthly period across the tax year boundary',()=>{
  const d=parse([[[0,'Description'],[150,'Hours'],[250,'Rate'],[350,'Amount']],[[0,'Overtime'],[150,'2.50'],[250,'16.5000'],[350,'41.25']]]);
  assert.deepEqual(d.lines,[{label:'Overtime',kind:'overtime',hours:2.5,rate:16.5,pence:4125}]);
  assert.equal(P.periodFor('2026-04-05','monthly'),'12');assert.equal(P.periodFor('2026-04-06','monthly'),'1');
  assert.equal(P.periodFor('2026-11-06','weekly'),'31');
});
test('unreadable amounts stay blank and mixed-payday documents cannot create a combined record',()=>{
  const d=parse([[[0,'Net pay'],[140,'illegible']]]);
  assert.equal(d.net,null);assert.equal(d.gross,null);assert.equal(d.date,'');
  assert.throws(()=>parse([[[0,'Pay date: 06/11/2026']],[[0,'Pay date: 13/11/2026']]]),/one file per payslip/);
});
test('OCR preprocessing preserves tall glyphs on borderless crops and removes rules in tables',()=>{
  const {removeRules}=require('../app/payslip-reader');
  const width=400,height=180,data=new Uint8ClampedArray(width*height*4).fill(255);
  const pixel=(x,y)=>4*(y*width+x);
  for(let y=30;y<90;y++)data.fill(0,pixel(40,y),pixel(40,y)+3);
  const canvas={width,height,getContext:()=>({getImageData:()=>({data}),putImageData(){}})};
  removeRules(canvas);assert.equal(data[pixel(40,50)],0);
  for(const y of [20,110])for(let x=20;x<380;x++)data.fill(0,pixel(x,y),pixel(x,y)+3);
  removeRules(canvas);assert.equal(data[pixel(100,20)],255);assert.equal(data[pixel(40,50)],0);
});
test('imported records round trip in backups with signed refunds and explicit missing values',()=>{
  const d={...P.blank(),hash:'a'.repeat(64),date:'2026-06-12',frequency:'weekly',period:'10',gross:300,net:400,
    lines:[{label:'PAYE refund',kind:'refund',pence:100,hours:null,rate:null}]};
  const data={format:'wagewise',version:2,log:Tracking.empty(),calculator:{history:[{id:1,date:d.date,gross:3,net:4,imported:d}]}};
  assert.deepEqual(Tracking.readBackup(JSON.stringify(data)).calculator.history[0].imported,d);
  d.lines[0].pence=0.45;assert.throws(()=>Tracking.readBackup(JSON.stringify(data)));
});
