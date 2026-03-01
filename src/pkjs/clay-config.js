module.exports = function(minifiedClay) {
  var Clay = minifiedClay;

  var MSG_TYPE_VIBE_TEST = 4;
  var VIBE_PATTERN = { HIGH_BG: 1, LOW_BG: 2, HOURLY: 3 };

  this.on(Clay.EVENTS.AFTER_BUILD, function() {

    var btnHigh = document.getElementById('vibe-test-high');
    if (btnHigh) {
      btnHigh.addEventListener('click', function() {
        if (window.Pebble) {
          Pebble.sendAppMessage(
            { 'MSG_TYPE': MSG_TYPE_VIBE_TEST, 'VIBE_TEST': VIBE_PATTERN.HIGH_BG },
            function() { console.log('High BG vibe test sent'); },
            function() { console.error('High BG vibe test failed'); }
          );
        }
      });
    }

    var btnLow = document.getElementById('vibe-test-low');
    if (btnLow) {
      btnLow.addEventListener('click', function() {
        if (window.Pebble) {
          Pebble.sendAppMessage(
            { 'MSG_TYPE': MSG_TYPE_VIBE_TEST, 'VIBE_TEST': VIBE_PATTERN.LOW_BG },
            function() { console.log('Low BG vibe test sent'); },
            function() { console.error('Low BG vibe test failed'); }
          );
        }
      });
    }

    var btnHourly = document.getElementById('vibe-test-hourly');
    if (btnHourly) {
      btnHourly.addEventListener('click', function() {
        if (window.Pebble) {
          Pebble.sendAppMessage(
            { 'MSG_TYPE': MSG_TYPE_VIBE_TEST, 'VIBE_TEST': VIBE_PATTERN.HOURLY },
            function() { console.log('Hourly vibe test sent'); },
            function() { console.error('Hourly vibe test failed'); }
          );
        }
      });
    }

  });
};
