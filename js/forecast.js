function forecastAnnualIncome(){

const history =
getHistory();

const avg =
history.reduce(
(a,b)=>a+Number(b.net),
0
)/history.length;

return avg * 52;
}