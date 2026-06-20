function saveCalculation(record){

const history =
JSON.parse(
localStorage.getItem('payHistory')
) || [];

history.unshift({

date:new Date().toISOString(),

gross:Number(record.gross),

net:Number(record.net)

});

localStorage.setItem(
'payHistory',
JSON.stringify(history)
);}