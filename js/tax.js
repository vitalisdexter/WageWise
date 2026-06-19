export function calculateScottishTax(annualIncome){

const bands = [

{limit:14876, rate:0.19},

{limit:26561, rate:0.20},

{limit:43662, rate:0.21},

{limit:75000, rate:0.42},

{limit:125140, rate:0.45},

{limit:Infinity, rate:0.48}

];

let tax = 0;
let previous = 12570;

for(const band of bands){

if(annualIncome > previous){

const taxable = Math.min(
annualIncome,
band.limit
) - previous;

tax += taxable * band.rate;
}

previous = band.limit;
}

return tax;
}