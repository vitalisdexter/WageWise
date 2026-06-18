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