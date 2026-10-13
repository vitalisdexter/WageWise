const {test}=require('node:test');
const assert=require('node:assert/strict');
const P=require('../payroll');
test('free pay uses code chunks and upward penny rounding',()=>{assert.equal(P.freePay(12570),241.92);assert.equal(P.freePay(0),0);assert.equal(P.freePay(5000),96.33);assert.equal(P.freePay(10000),192.49);});
test('tax year and week across DST and year boundary',()=>{
 assert.equal(P.week('2026-10-26'),30);assert.equal(P.week('2027-03-29'),52);assert.equal(P.week('2027-04-05'),53);assert.equal(P.week('2026-04-06'),1);assert.equal(P.year('2026-04-05'),2025);
});
test('missing history produces a Week 1 estimate, not zero tax',()=>{const r=P.calculate({gross:848.85,date:'2026-09-18'});assert.ok(r.taxW>0);assert.equal(r.cumulativeGross,null);assert.match(r.mode,/estimate/);});
test('zero YTD is a valid explicit prior, never divided by 52',()=>{const r=P.calculate({gross:848.85,date:'2026-09-18',prior:{gross:0,tax:0,week:23,year:2026}});assert.equal(r.cumulativeGross,848.85);assert.equal(r.taxW,0);});
test('cumulative refunds and 50% regulatory limit',()=>{
 assert.equal(P.calculate({gross:100,date:'2026-04-17',prior:{gross:100,tax:20,year:2026,week:1}}).taxW,-20);
 assert.equal(P.calculate({gross:101.01,date:'2026-04-17',prior:{gross:90000,tax:0,year:2026,week:1}}).taxW,50.50);
});
test('NI thresholds and independent band rounding',()=>{assert.equal(P.ni(242).ni,0);assert.equal(P.ni(967).ni,58);assert.equal(P.ni(983.49).ni,58.33);});
test('week 53 uses Week 1 liability',()=>{assert.equal(P.calculate({gross:549.65,date:'2027-04-05'}).taxW,P.calculate({gross:549.65,date:'2026-04-06'}).taxW);});
test('pay date selects rates',()=>{assert.notEqual(P.calculate({gross:800,date:'2025-06-06'}).taxW,P.calculate({gross:800,date:'2026-06-05'}).taxW);});
test('reject unsupported dates and invalid prior data',()=>{
 for(const date of ['2026-02-30','garbage','2027-04-06'])assert.throws(()=>P.calculate({gross:800,date}));
 assert.throws(()=>P.calculate({gross:Infinity,date:'2026-06-05'}));
 assert.throws(()=>P.calculate({gross:800,date:'2026-06-05',prior:{gross:1,tax:0,year:2026,week:9}}));
 assert.throws(()=>P.calculate({gross:800,date:'2026-06-05',prior:{gross:1,tax:0,year:2025,week:8}}));
 assert.throws(()=>P.freePay(12575));
});
test('each deduction is rounded before net calculation',()=>{const r=P.calculate({gross:550.01,date:'2026-06-05',deductions:[{type:'percent',value:1},{type:'percent',value:1}]});assert.equal(r.customDedRes.total,11);assert.equal(r.net,P.round(r.gross-r.taxW-r.niRes.ni-11));});
