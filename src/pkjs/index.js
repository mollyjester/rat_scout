// Listen for when the watchface is opened
Pebble.addEventListener('ready', 
  function(e) {
    console.log('PebbleKit JS ready!');

    getScoutReading();
  }
);

// Listen for when an AppMessage is received
Pebble.addEventListener('appmessage',
  function(e) {
    console.log('AppMessage received!');
  }                     
);

function getScoutReading() {
    var url = 'https://daf9.ns.gluroo.com/pebble?token=daf9b6a4-05d6-4603-91fd-07cb5ac5f8a5&count=1';
        //pos.coords.latitude + '&lon=' + pos.coords.longitude + '&appid=' + myAPIKey;
    
    xhrRequest(url, 'GET', 
        function(responseText) {
        // responseText contains a JSON object with weather info
        var json = JSON.parse(responseText);

        var reading = Math.round(json.bgs[0].sgv / 18);
        console.log('Glocose is ' + reading);

        var delta = Math.round(json.bgs[0].bgdelta / 18);
        console.log('Delta is ' + delta);
        }      
  );
}