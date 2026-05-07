module.exports = function(minifiedClay) {
  this.on(this.EVENTS.AFTER_BUILD, function() {
    var clayConfig = this;

    function attachFlagButton(id, flagKey, flagValue) {
      var item = clayConfig.getItemById(id);
      if (!item) {
        console.warn('Clay item not found: ' + id + '. Verify config.json has type: button');
        return;
      }
      item.on('click', function() {
        var settings = clayConfig.serialize();
        settings[flagKey] = flagValue;
        var returnTo = window.returnTo || 'pebblejs://close#';
        location.href = returnTo + encodeURIComponent(JSON.stringify(settings));
      });
    }

    function attachVibeButton(id, patternId) {
      attachFlagButton(id, '_vibeTest', patternId);
    }

    attachVibeButton('vibe-test-high',   1);
    attachVibeButton('vibe-test-low',    2);
    attachVibeButton('vibe-test-hourly', 3);
    attachFlagButton('overlay-test', '_overlayTest', 1);
  });
};
