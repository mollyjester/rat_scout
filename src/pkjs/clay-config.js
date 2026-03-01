module.exports = function(minifiedClay) {
  this.on(this.EVENTS.AFTER_BUILD, function() {
    var clayConfig = this;

    function attachVibeButton(id, patternId) {
      var item = clayConfig.getItemById(id);
      if (!item) {
        console.warn('Clay item not found: ' + id + '. Verify config.json has type: button');
        return;
      }
      item.on('click', function() {
        // Serialize current settings and add the vibe test flag
        var settings = clayConfig.serialize();
        settings._vibeTest = patternId;

        // Close the config page with the settings + vibe test payload
        var returnTo = window.returnTo || 'pebblejs://close#';
        location.href = returnTo + encodeURIComponent(JSON.stringify(settings));
      });
    }

    attachVibeButton('vibe-test-high',   1);
    attachVibeButton('vibe-test-low',    2);
    attachVibeButton('vibe-test-hourly', 3);
  });
};
