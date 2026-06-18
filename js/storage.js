function saveCalculation(record){

const history =
JSON.parse(
localStorage.getItem(
'payHistory'
)
)||[];

history.unshift(record);

localStorage.setItem(
'payHistory',
JSON.stringify(history)
);
}

function getHistory(){

return JSON.parse(
localStorage.getItem(
'payHistory'
)
)||[];
}

function clearHistory(){

localStorage.removeItem(
'payHistory'
);

loadHistory();
}