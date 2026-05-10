#include "rat_scout.h"

// ===== Sound Settings (extern in rat_scout.h) =====

bool s_bg_low_sound = false;
bool s_bg_high_sound = false;
bool s_hourly_sound = false;

// ===== Music Theory =====
//
// BG alerts are single-track sequences, SpeakerWaveformTriangle at 100 velocity.
// Each alert plays a three-note broken B minor chord twice:
//   short(250ms)–short–short, pause(500ms), short–short–long(500ms)
//
// High alert (ascending) : B3 D4 F#4 | B3 D4 F#4
// Low  alert (descending): F#4 D4 B3 | F#4 D4 B3
//
// Hourly chime: a simple two-pulse C5 at half-second each (single track).

// MIDI pitches
#define MIDI_B3  59
#define MIDI_D4  62
#define MIDI_FS4 66
#define MIDI_C5  72

#define DUR_SHORT 250
#define DUR_LONG  500

// ===== High BG alert (ascending B minor arpeggio) =====

static const SpeakerNote s_bg_high_notes[] = {
    { MIDI_B3,  SpeakerWaveformTriangle, DUR_SHORT, 100, 0 },
    { MIDI_D4,  SpeakerWaveformTriangle, DUR_SHORT, 100, 0 },
    { MIDI_FS4, SpeakerWaveformTriangle, DUR_SHORT, 100, 0 },
    { 0,        SpeakerWaveformTriangle, DUR_LONG,  100, 0 },
    { MIDI_B3,  SpeakerWaveformTriangle, DUR_SHORT, 100, 0 },
    { MIDI_D4,  SpeakerWaveformTriangle, DUR_SHORT, 100, 0 },
    { MIDI_FS4, SpeakerWaveformTriangle, DUR_LONG,  100, 0 },
    { 0,        SpeakerWaveformTriangle, DUR_SHORT,  100, 0 },
};

static const SpeakerTrack s_bg_high_tracks[] = {
    { s_bg_high_notes, ARRAY_LENGTH(s_bg_high_notes), NULL },
};

// ===== Low BG alert (descending B minor arpeggio) =====

static const SpeakerNote s_bg_low_notes[] = {
    { MIDI_FS4, SpeakerWaveformTriangle, DUR_SHORT, 100, 0 },
    { MIDI_D4,  SpeakerWaveformTriangle, DUR_SHORT, 100, 0 },
    { MIDI_B3,  SpeakerWaveformTriangle, DUR_SHORT, 100, 0 },
    { 0,        SpeakerWaveformTriangle, DUR_LONG,  100, 0 },
    { MIDI_FS4, SpeakerWaveformTriangle, DUR_SHORT, 100, 0 },
    { MIDI_D4,  SpeakerWaveformTriangle, DUR_SHORT, 100, 0 },
    { MIDI_B3,  SpeakerWaveformTriangle, DUR_LONG,  100, 0 },
    { 0,        SpeakerWaveformTriangle, DUR_SHORT,  100, 0 },
};

static const SpeakerTrack s_bg_low_tracks[] = {
    { s_bg_low_notes, ARRAY_LENGTH(s_bg_low_notes), NULL },
};

// ===== Hourly chime =====

static const SpeakerNote s_hourly_track[] = {
    { MIDI_C5, SpeakerWaveformSine, DUR_SHORT, 100, 0 },
    { 0,        SpeakerWaveformTriangle, DUR_SHORT,  100, 0 },
    { MIDI_C5, SpeakerWaveformSine, DUR_SHORT, 100, 0 },
    { 0,        SpeakerWaveformTriangle, DUR_SHORT,  100, 0 },
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
 * silently return on aplite/basalt/diorite — flint/emery have the speaker).
 * speaker_play_tracks() is self-preempting in PebbleOS
 * (speaker_service.c:513-518: if state != Idle, prv_stop_internal is
 * called with SpeakerFinishReasonPreempted before the new playback starts),
 * so no explicit idle-check is required here. speaker_stop() is still
 * called explicitly to ensure prv_sound_finish_cb runs synchronously
 * before the new tracks are queued.
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
