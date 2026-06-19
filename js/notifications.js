async function enableNotifications(){

const permission =
await Notification.requestPermission();

if(
permission === "granted"
){

new Notification(
"Welcome to WageWise"
);

}
}