const basicPay = document.getElementById("basicPay");
const otHours = document.getElementById("otHours");
const otRate = document.getElementById("otRate");

function calculate() {

    const basic = Number(basicPay.value) || 0;
    const hours = Number(otHours.value) || 0;
    const rate = Number(otRate.value) || 0;

    const overtimePay = hours * rate;

    const totalPay = basic + overtimePay;

    const taxableAmount =
        (totalPay * 52) - 12570;

    const tax =
        Math.max(0, (taxableAmount * 0.21) / 52);

    const ni =
        Math.max(0, (taxableAmount * 0.10) / 52);

    const netPay =
        totalPay - tax - ni;

    document.getElementById("otPay").textContent =
        `£${overtimePay.toFixed(2)}`;

    document.getElementById("totalPay").textContent =
        `£${totalPay.toFixed(2)}`;

    document.getElementById("tax").textContent =
        `£${tax.toFixed(2)}`;

    document.getElementById("ni").textContent =
        `£${ni.toFixed(2)}`;

    document.getElementById("netPay").textContent =
        `£${netPay.toFixed(2)}`;
}

basicPay.addEventListener("input", calculate);
otHours.addEventListener("input", calculate);
otRate.addEventListener("input", calculate);

calculate();

function showPage(pageId){

document
.querySelectorAll('.page')
.forEach(page => {

page.classList.remove(
'active'
);

});

document
.getElementById(pageId)
.classList.add('active');
}

function loadHistory(){

const history =
getHistory();

const container =
document.getElementById(
'historyList'
);

container.innerHTML='';

history.forEach(item=>{

container.innerHTML += `

<div class="history-item">

<div>
${item.date}
</div>

<div>
Gross:
£${item.gross}
</div>

<div>
Net:
£${item.net}
</div>

</div>

`;

});
}

const themeToggle =
document.getElementById(
'themeToggle'
);

themeToggle.addEventListener(
'change',
function(){

document.body.classList.toggle(
'light'
);

localStorage.setItem(
'theme',
document.body.classList.contains(
'light'
)
);
}
);

if(
localStorage.getItem('theme')
==='true'
){
document.body.classList.add(
'light'
);
themeToggle.checked=true;
}
function loadDashboard(){

const history =
getHistory();

if(history.length===0){
return;
}

const totalNet =
history.reduce(
(sum,item)=>
sum + Number(item.net),
0
);

const monthlyAverage =
totalNet /
Math.max(history.length,1);

const currentMonth =
new Date().getMonth();

const currentYear =
new Date().getFullYear();

let monthTotal=0;
let yearlyTotal=0;

history.forEach(item=>{

const date =
new Date(item.date);

if(
date.getMonth()===currentMonth &&
date.getFullYear()===currentYear
){
monthTotal += Number(item.net);
}

if(
date.getFullYear()===currentYear
){
yearlyTotal += Number(item.net);
}

});

document.getElementById(
'weeklyAverage'
).textContent =
`£${monthlyAverage.toFixed(2)}`;

document.getElementById(
'monthlyTotal'
).textContent =
`£${monthTotal.toFixed(2)}`;

document.getElementById(
'yearlyTotal'
).textContent =
`£${yearlyTotal.toFixed(2)}`;

document.getElementById(
'entryCount'
).textContent =
history.length;

buildMonthlyChart();
}
loadHistory();
loadDashboard();