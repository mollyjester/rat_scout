module.exports = function(minifiedClay) {
  var MSG_TYPE_VIBE_TEST = 4;

  this.on(this.EVENTS.AFTER_BUILD, function() {
    var clayConfig = this;

    function attachVibeButton(id, patternId) {
      var item = clayConfig.getItemById(id);
      if (!item) {
        console.warn('Clay item not found: ' + id + '. Verify config.json has type: button');
        return;
      }
      item.on('click', function() {
        Pebble.sendAppMessage(
          { 'MSG_TYPE': MSG_TYPE_VIBE_TEST, 'VIBE_TEST': patternId },
          function() { console.log('Vibe test sent: ' + id); },
          function() { console.error('Vibe test failed: ' + id); }
        );
      });
    }

    attachVibeButton('vibe-test-high',   1);
    attachVibeButton('vibe-test-low',    2);
    attachVibeButton('vibe-test-hourly', 3);
  });
};
