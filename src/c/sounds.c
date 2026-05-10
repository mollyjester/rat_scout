#include "rat_scout.h"

// ===== Sound Settings (extern in rat_scout.h) =====

bool s_bg_low_sound = false;
bool s_bg_high_sound = false;
bool s_hourly_sound = false;

// ===== Music Theory =====
//
// BG alerts are single-track sequences, SpeakerWaveformTriangle at 100 velocity.
// Each alert plays a three-note broken B minor chord twice:
//   short(125ms)–short–short, pause(250ms), short–short–long(250ms)
// Each track is wrapped in a leading and trailing 350 ms silent buffer.
//
// High alert (ascending) : B3 D4 F#4 | B3 D4 F#4
// Low  alert (descending): F#4 D4 B3 | F#4 D4 B3
//
// Hourly chime: two C6 sine pulses (125 ms each) separated by a 125 ms gap,
//   wrapped in leading and trailing 350 ms silent buffers (single track).

// MIDI pitches
#define MIDI_B3  59
#define MIDI_D4  62
#define MIDI_FS4 66
#define MIDI_C6  84

#define DUR_SHORT 125
#define DUR_LONG  250
#define DUR_SILENT_BUF 350

// ===== Cold-start prefix =====
//
// Every track starts (and ends) with a 350 ms silent rest (midi=0). On flint/asterix the
// audio driver may take a moment to bring the DA7212 codec out of cold state
// (PLL lock, DAI master enable, codec reference settling). The leading rest
// guarantees that any cold-start ramp-up never eats the first audible note.
// The rest is a no-op cost on warm-start (codec already active).
#define SILENCE_BUF { 0, SpeakerWaveformTriangle, DUR_SILENT_BUF, 100, 0 }

// ===== High BG alert (ascending B minor arpeggio) =====

static const SpeakerNote s_bg_high_notes[] = {
    SILENCE_BUF,
    { MIDI_B3,  SpeakerWaveformTriangle, DUR_SHORT, 100, 0 },
    { MIDI_D4,  SpeakerWaveformTriangle, DUR_SHORT, 100, 0 },
    { MIDI_FS4, SpeakerWaveformTriangle, DUR_SHORT, 100, 0 },
    { 0,        SpeakerWaveformTriangle, DUR_LONG,  100, 0 },
    { MIDI_B3,  SpeakerWaveformTriangle, DUR_SHORT, 100, 0 },
    { MIDI_D4,  SpeakerWaveformTriangle, DUR_SHORT, 100, 0 },
    { MIDI_FS4, SpeakerWaveformTriangle, DUR_LONG,  100, 0 },
    SILENCE_BUF,
};

static const SpeakerTrack s_bg_high_tracks[] = {
    { s_bg_high_notes, ARRAY_LENGTH(s_bg_high_notes), NULL },
};

// ===== Low BG alert (descending B minor arpeggio) =====

static const SpeakerNote s_bg_low_notes[] = {
    SILENCE_BUF,
    { MIDI_FS4, SpeakerWaveformTriangle, DUR_SHORT, 100, 0 },
    { MIDI_D4,  SpeakerWaveformTriangle, DUR_SHORT, 100, 0 },
    { MIDI_B3,  SpeakerWaveformTriangle, DUR_SHORT, 100, 0 },
    { 0,        SpeakerWaveformTriangle, DUR_LONG,  100, 0 },
    { MIDI_FS4, SpeakerWaveformTriangle, DUR_SHORT, 100, 0 },
    { MIDI_D4,  SpeakerWaveformTriangle, DUR_SHORT, 100, 0 },
    { MIDI_B3,  SpeakerWaveformTriangle, DUR_LONG,  100, 0 },
    SILENCE_BUF,
};

static const SpeakerTrack s_bg_low_tracks[] = {
    { s_bg_low_notes, ARRAY_LENGTH(s_bg_low_notes), NULL },
};

// ===== Hourly chime =====

static const SpeakerNote s_hourly_track[] = {
    SILENCE_BUF,
    { MIDI_C6, SpeakerWaveformSine, DUR_SHORT, 100, 0 },
    { 0,        SpeakerWaveformTriangle, DUR_SHORT,  100, 0 },
    { MIDI_C6, SpeakerWaveformSine, DUR_SHORT, 100, 0 },
    SILENCE_BUF
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
    // Set the speaker volume exactly once for the lifetime of the app.
    // The DA7212 codec is silent until samples flow, but the speaker service
    // tracks volume in software and applies it on every audio_start. Calling
    // speaker_set_volume() repeatedly per playback adds I2C round-trips and
    // is no-op on cold start anyway (audio_set_volume early-returns until
    // is_running=true). One call here is sufficient; per-playback volume can
    // still be passed via the volume argument of speaker_play_tracks().
    (void)speaker_set_volume(100);
}

void sounds_deinit(void) {
    speaker_set_finish_callback(NULL, NULL);
}

/**
 * Play a SpeakerTrack array, preempting any in-progress sound.
 * No-op on platforms without a speaker (the SDK speaker_* calls
 * silently return on aplite/basalt/diorite — flint/emery have the speaker).
 * speaker_play_tracks() is self-preempting in PebbleOS
 * (speaker_service.c: if state != Idle, prv_stop_internal is
 * called with SpeakerFinishReasonPreempted before the new playback starts),
 * so no explicit idle-check is required here. speaker_stop() is still
 * called explicitly to ensure prv_sound_finish_cb runs synchronously
 * before the new tracks are queued.
 * Volume is set once in sounds_init(); the per-playback volume argument
 * (100) is passed through to speaker_play_tracks for completeness.
 * @param tracks - Array of SpeakerTrack
 * @param num_tracks - Number of tracks in the array
 */
static void play_tracks(const SpeakerTrack *tracks, uint32_t num_tracks) {
    (void)speaker_stop();
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
