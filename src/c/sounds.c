#include "rat_scout.h"

// ===== Sound Settings (extern in rat_scout.h) =====

bool s_bg_low_sound = false;
bool s_bg_high_sound = false;
bool s_hourly_sound = false;

// ===== Music Theory =====
//
// All BG alert tracks are derived from a single "low" voicing at 160 BPM:
//   beat = quarter note = 60000 / 160 = 375 ms
//   8th  = 188 ms (one of the pair uses 187 ms so the bar totals exactly 750)
//
// Low alert (forward sequence) — half-measure of 4/4:
//   Track 1 (lead) : 4th E5 | 8th B4 | 8th A4
//   Track 2 (alto) : 4th D4 | 4th C4
//   Track 3 (tenor): 4th A3 | 4th A3
//   Track 4 (bass) : 4th B2 | 4th A2
//
// High alert reverses the sequence within each track so the contour rises
// instead of falling, signalling a high BG with the opposite gesture.
//
// Hourly chime: a simple two-pulse C5 at half-second each (single track).

// MIDI pitches
#define MIDI_E5  76
#define MIDI_B4  71
#define MIDI_A4  69
#define MIDI_D4  62
#define MIDI_C4  60
#define MIDI_A3  57
#define MIDI_B2  47
#define MIDI_A2  45
#define MIDI_C5  72

#define BEAT_QUARTER  375
#define BEAT_EIGHTH_A 188
#define BEAT_EIGHTH_B 187

// ===== Low BG alert =====

static const SpeakerNote s_bg_low_track1[] = {
    { MIDI_E5, SpeakerWaveformSine, BEAT_QUARTER,  100, 0 },
    { MIDI_B4, SpeakerWaveformSine, BEAT_EIGHTH_A, 100, 0 },
    { MIDI_A4, SpeakerWaveformSine, BEAT_EIGHTH_B, 100, 0 },
};

static const SpeakerNote s_bg_low_track2[] = {
    { MIDI_D4, SpeakerWaveformSine, BEAT_QUARTER, 90, 0 },
    { MIDI_C4, SpeakerWaveformSine, BEAT_QUARTER, 90, 0 },
};

static const SpeakerNote s_bg_low_track3[] = {
    { MIDI_A3, SpeakerWaveformSquare, BEAT_QUARTER, 70, 0 },
    { MIDI_A3, SpeakerWaveformSquare, BEAT_QUARTER, 70, 0 },
};

static const SpeakerNote s_bg_low_track4[] = {
    { MIDI_B2, SpeakerWaveformSquare, BEAT_QUARTER, 70, 0 },
    { MIDI_A2, SpeakerWaveformSquare, BEAT_QUARTER, 70, 0 },
};

static const SpeakerTrack s_bg_low_tracks[] = {
    { s_bg_low_track1, ARRAY_LENGTH(s_bg_low_track1), NULL },
    { s_bg_low_track2, ARRAY_LENGTH(s_bg_low_track2), NULL },
    { s_bg_low_track3, ARRAY_LENGTH(s_bg_low_track3), NULL },
    { s_bg_low_track4, ARRAY_LENGTH(s_bg_low_track4), NULL },
};

// ===== High BG alert (reversed sequence per track) =====

static const SpeakerNote s_bg_high_track1[] = {
    { MIDI_A4, SpeakerWaveformSine, BEAT_EIGHTH_B, 100, 0 },
    { MIDI_B4, SpeakerWaveformSine, BEAT_EIGHTH_A, 100, 0 },
    { MIDI_E5, SpeakerWaveformSine, BEAT_QUARTER,  100, 0 },
};

static const SpeakerNote s_bg_high_track2[] = {
    { MIDI_C4, SpeakerWaveformSine, BEAT_QUARTER, 90, 0 },
    { MIDI_D4, SpeakerWaveformSine, BEAT_QUARTER, 90, 0 },
};

static const SpeakerNote s_bg_high_track3[] = {
    { MIDI_A3, SpeakerWaveformSquare, BEAT_QUARTER, 70, 0 },
    { MIDI_A3, SpeakerWaveformSquare, BEAT_QUARTER, 70, 0 },
};

static const SpeakerNote s_bg_high_track4[] = {
    { MIDI_A2, SpeakerWaveformSquare, BEAT_QUARTER, 70, 0 },
    { MIDI_B2, SpeakerWaveformSquare, BEAT_QUARTER, 70, 0 },
};

static const SpeakerTrack s_bg_high_tracks[] = {
    { s_bg_high_track1, ARRAY_LENGTH(s_bg_high_track1), NULL },
    { s_bg_high_track2, ARRAY_LENGTH(s_bg_high_track2), NULL },
    { s_bg_high_track3, ARRAY_LENGTH(s_bg_high_track3), NULL },
    { s_bg_high_track4, ARRAY_LENGTH(s_bg_high_track4), NULL },
};

// ===== Hourly chime =====

static const SpeakerNote s_hourly_track[] = {
    { MIDI_C5, SpeakerWaveformSine, 500, 100, 0 },
    { MIDI_C5, SpeakerWaveformSine, 500, 100, 0 },
};

static const SpeakerTrack s_hourly_tracks[] = {
    { s_hourly_track, ARRAY_LENGTH(s_hourly_track), NULL },
};

// ===== Public API =====

static void prv_sound_finish_cb(SpeakerFinishReason reason, void *context) {
    (void)reason;
    (void)context;
}

void sounds_init(void) {
    speaker_set_finish_callback(prv_sound_finish_cb, NULL);
}

void sounds_deinit(void) {
    speaker_set_finish_callback(NULL, NULL);
}

/**
 * Play a SpeakerTrack array, preempting any in-progress sound.
 * No-op on platforms without a speaker (the SDK speaker_* calls
 * silently return on aplite/basalt/diorite — emery has the speaker).
 * @param tracks - Array of SpeakerTrack
 * @param num_tracks - Number of tracks in the array
 */
static void play_tracks(const SpeakerTrack *tracks, uint32_t num_tracks) {
    (void)speaker_stop();
    (void)speaker_set_volume(100);
    (void)speaker_play_tracks(tracks, num_tracks, 100);
}

void play_bg_low_alert(void) {
    play_tracks(s_bg_low_tracks, ARRAY_LENGTH(s_bg_low_tracks));
}

void play_bg_high_alert(void) {
    play_tracks(s_bg_high_tracks, ARRAY_LENGTH(s_bg_high_tracks));
}

void play_hourly_alert(void) {
    play_tracks(s_hourly_tracks, ARRAY_LENGTH(s_hourly_tracks));
}

void sounds_stop(void) {
    (void)speaker_stop();
}
