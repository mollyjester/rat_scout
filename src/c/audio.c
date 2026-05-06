#include "audio.h"

// ===== Private State =====

static bool    s_audio_enabled = false;
static uint8_t s_audio_volume  = 70;   // Default: medium

// ===== Melody Tables =====
// SpeakerNote fields: { midi_note, waveform, duration_ms, velocity }
// velocity = 0 → SDK uses the global volume passed to speaker_play_notes().
// Waveform 0 = Sine (SpeakerWaveformSine via the SDK enum).

// BG High: C4 → C5, ascending
// __attribute__((unused)): speaker_play_notes is a no-op macro on non-Emery platforms,
// which causes the compiler to report these arrays as unused on those targets.
static const SpeakerNote s_notes_bg_high[] __attribute__((unused)) = {
    {60, SpeakerWaveformSine, 500,  0, 0},  // C4
    {72, SpeakerWaveformSine, 1000, 0, 0},  // C5
};

// BG Low: C5 → C4, descending
static const SpeakerNote s_notes_bg_low[] __attribute__((unused)) = {
    {72, SpeakerWaveformSine, 500,  0, 0},  // C5
    {60, SpeakerWaveformSine, 1000, 0, 0},  // C4
};

// Hourly: G4, short rest (midi_note=0), G4
static const SpeakerNote s_notes_hourly[] __attribute__((unused)) = {
    {67, SpeakerWaveformSine, 300, 0, 0},  // G4
    {0,  SpeakerWaveformSine, 100, 0, 0},  // rest
    {67, SpeakerWaveformSine, 300, 0, 0},  // G4
};

// ===== Public API =====

void audio_init(void) {
    if (persist_exists(PERSIST_KEY_AUDIO_ENABLE)) {
        s_audio_enabled = persist_read_bool(PERSIST_KEY_AUDIO_ENABLE);
    }
    if (persist_exists(PERSIST_KEY_AUDIO_VOLUME)) {
        uint8_t level = (uint8_t)persist_read_int(PERSIST_KEY_AUDIO_VOLUME);
        audio_set_volume(level);
    }
}

void audio_set_enabled(bool enabled) {
    s_audio_enabled = enabled;
}

void audio_set_volume(uint8_t level) {
    switch (level) {
        case 0:  s_audio_volume = 35;  break;
        case 2:  s_audio_volume = 100; break;
        default: s_audio_volume = 70;  break;   // level 1 or any other
    }
}

void audio_play_alert(AlertKind kind) {
    if (!s_audio_enabled) return;

    switch (kind) {
        case ALERT_KIND_BG_HIGH:
            (void)speaker_play_notes(s_notes_bg_high,
                               ARRAY_LENGTH(s_notes_bg_high), s_audio_volume);
            break;
        case ALERT_KIND_BG_LOW:
            (void)speaker_play_notes(s_notes_bg_low,
                               ARRAY_LENGTH(s_notes_bg_low), s_audio_volume);
            break;
        case ALERT_KIND_HOURLY:
            (void)speaker_play_notes(s_notes_hourly,
                               ARRAY_LENGTH(s_notes_hourly), s_audio_volume);
            break;
        default:
            break;
    }
}
