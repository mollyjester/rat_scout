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

    getScoutReading();
  }                     
);

function getScoutReading() {
    console.log('Getting a reading');
    var url = 'https://daf9.ns.gluroo.com/pebble?token=daf9b6a4-05d6-4603-91fd-07cb5ac5f8a5&count=1';
    var req = new XMLHttpRequest();

    req.open('GET', url, true);
    req.onload = 
      function(e) 
      {
        if (req.readyState == 4) 
        {
          if (req.status == 200) 
          {
            var response = JSON.parse(req.responseText);

            if (response) 
            {
              var sgv = response.bgs[0].sgv;
              console.log('SGV: ' + sgv);

              var bgdelta = response.bgs[0].bgdelta;
              console.log('BGDELTA: ' + bgdelta);

              var dictionary = {
                'SGV': sgv,
                'TREND': 0,
                'DIRECTION': '',
                'DATETIME': 0,
                'BGDELTA': bgdelta,
                'COB': 0,
                'IOB': 0
              };

              Pebbble.sendAppMessage(dictionary,
                function(e) {
                  console.log('BG data sent to Pebble successfullly.');
                },
                function(e) {
                  console.log('Error sending BG data to Pebble.');
                }
              )
            }
          } 
          else 
          {
            console.log('Error fetching reading');
          }
      }
    }

    req.send(null);
};