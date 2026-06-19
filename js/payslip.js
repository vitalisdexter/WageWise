function generatePayslip(data){

return `
<div class="payslip">

<h3>WageWise Payslip</h3>

<p>Gross Pay: £${data.gross}</p>

<p>Tax: £${data.tax}</p>

<p>NI: £${data.ni}</p>

<p>Net Pay: £${data.net}</p>

</div>
`;
}