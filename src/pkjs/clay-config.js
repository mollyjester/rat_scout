module.exports = function(minifiedClay) {
  var Clay = minifiedClay;

  var MSG_TYPE_VIBE_TEST = 4;
  var VIBE_PATTERN = { HIGH_BG: 1, LOW_BG: 2, HOURLY: 3 };

  /**
   * Convert a Clay "text" element (rendered as a <p> inside its container)
   * into a real tappable <button>, and wire up the Pebble.sendAppMessage call.
   *
   * Clay renders "type":"text" items inside a wrapper element whose id matches
   * the "id" field from config.json. We find that wrapper, pull out the <p>,
   * replace it with a styled <button>, and attach the click handler.
   *
   * @param {string} id - The "id" value from config.json for this text item
   * @param {number} vibePattern - The VIBE_PATTERN value to send on click
   */
  function makeVibeButton(id, vibePattern) {
    var container = document.getElementById(id);
    if (!container) return;

    var p = container.querySelector('p');
    if (!p) return;

    var label = p.textContent || p.innerText || '';

    var btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = [
      'display:block',
      'width:90%',
      'margin:6px auto',
      'padding:10px 16px',
      'font-size:14px',
      'background:#555',
      'color:#fff',
      'border:none',
      'border-radius:4px',
      'cursor:pointer',
      '-webkit-appearance:none'
    ].join(';');

    btn.addEventListener('click', function() {
      if (window.Pebble) {
        Pebble.sendAppMessage(
          { 'MSG_TYPE': MSG_TYPE_VIBE_TEST, 'VIBE_TEST': vibePattern },
          function() { console.log('Vibe test sent: pattern=' + vibePattern); },
          function() { console.error('Vibe test failed: pattern=' + vibePattern); }
        );
      }
    });

    p.parentNode.replaceChild(btn, p);
  }

  this.on(Clay.EVENTS.AFTER_BUILD, function() {
    makeVibeButton('vibe-test-high',   VIBE_PATTERN.HIGH_BG);
    makeVibeButton('vibe-test-low',    VIBE_PATTERN.LOW_BG);
    makeVibeButton('vibe-test-hourly', VIBE_PATTERN.HOURLY);
  });
};
