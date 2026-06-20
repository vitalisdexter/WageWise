let earningsChart;

function buildMonthlyChart() {

const history = getHistory();

const monthlyTotals = {};

history.forEach(entry => {

const date = new Date(entry.date);

const monthKey =
date.toLocaleString(
'en-GB',
{
month:'short',
year:'numeric'
}
);

monthlyTotals[monthKey] =
(monthlyTotals[monthKey] || 0)
+ Number(entry.net);

});

const labels =
Object.keys(monthlyTotals);

const values =
Object.values(monthlyTotals);

const ctx =
document
.getElementById('earningsChart')
.getContext('2d');

if(earningsChart){
earningsChart.destroy();
}

earningsChart =
new Chart(ctx,{

type:'line',

data:{

labels:labels,

datasets:[{

label:'Monthly Net Earnings',

data:values,

borderWidth:3,

fill:true,

tension:0.4

}]
},

options:{
responsive:true,
plugins:{
legend:{
display:true
}
}
}

});
}