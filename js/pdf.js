async function downloadPDF(){

const { jsPDF } = window.jspdf;

const pdf =
new jsPDF();

pdf.text(
"WageWise Payslip",
20,
20
);

pdf.text(
document
.getElementById(
"payslipContainer"
).innerText,
20,
40
);

pdf.save(
"payslip.pdf"
);
}