function calculatePay(){

const basic =
Number(
document.getElementById(
'basicPay'
).value
)||0;

const hours =
Number(
document.getElementById(
'otHours'
).value
)||0;

const rate =
Number(
document.getElementById(
'otRate'
).value
)||0;

const overtime =
hours * rate;

const total =
basic + overtime;

const taxable =
(total * 52) - 12570;

const tax =
Math.max(
0,
(taxable * 0.21)/52
);

const ni =
Math.max(
0,
(taxable * 0.10)/52
);

const net =
total - tax - ni;

document.getElementById(
'netPay'
).textContent =
`£${net.toFixed(2)}`;

saveCalculation({
date:new Date().toLocaleDateString(),
gross:total.toFixed(2),
net:net.toFixed(2)
});

loadHistory();
}