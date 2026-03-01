module.exports = function(minifiedClay) {
  var MSG_TYPE_VIBE_TEST = 4;

  this.on(this.EVENTS.AFTER_BUILD, function() {
    var clayConfig = this;

    function sendVibeTest(patternId, id) {
      Pebble.sendAppMessage(
        { 'MSG_TYPE': MSG_TYPE_VIBE_TEST, 'VIBE_TEST': patternId },
        function() { console.log('Vibe test sent: ' + id); },
        function() { console.error('Vibe test failed: ' + id); }
      );
    }

    function attachVibeButton(id, patternId) {
      var item = clayConfig.getItemById(id);
      if (!item) {
        console.warn('Clay item not found: ' + id);
        return;
      }
      // Clay text items do not auto-wire click events like inputs/toggles;
      // attach handler directly to the underlying DOM element
      var el = item.$element && item.$element[0];
      if (!el) return;
      el.style.cursor = 'pointer';
      el.addEventListener('click', function() {
        sendVibeTest(patternId, id);
      });
    }

    attachVibeButton('vibe-test-high',   1);
    attachVibeButton('vibe-test-low',    2);
    attachVibeButton('vibe-test-hourly', 3);
  });
};
