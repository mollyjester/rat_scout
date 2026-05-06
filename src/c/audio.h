#pragma once
#include "rat_scout.h"

// ===== Audio Alert Module =====
// Plays a short Speaker melody simultaneously with every vibration alert.
// Disabled by default; enabled and configured via Clay settings.
//
// Melody specs (Sine waveform, velocity 0 = SDK default):
//   BG High  — C4 (MIDI 60, 500 ms) → C5 (MIDI 72, 1000 ms)   [ascending]
//   BG Low   — C5 (MIDI 72, 500 ms) → C4 (MIDI 60, 1000 ms)   [descending]
//   Hourly   — G4 (MIDI 67, 300 ms) → rest (0, 100 ms) → G4 (300 ms)
//
// Volume mapping (audio_set_volume level parameter):
//   0 = low     → 35
//   1 = medium  → 70
//   2 = high    → 100
//
// The speaker_play_notes() SDK call is universal; on hardware without a
// speaker (e.g. Basalt) it is a no-op.  No #if platform guards are used.

// Initialise from persisted settings; call once from init() before window push.
void audio_init(void);

// Update enable flag at runtime (called from handle_settings in messaging.c).
void audio_set_enabled(bool enabled);

// Update volume level (0=low, 1=medium, 2=high).
void audio_set_volume(uint8_t level);

// Play the melody for the given alert kind.
// No-op if audio is disabled or speaker_play_notes() is unavailable.
void audio_play_alert(AlertKind kind);
