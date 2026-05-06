#pragma once
#include <pebble.h>

// ===== Buffer Sizes (compile-time constants for static arrays) =====
#define BUFFER_BG 16
#define BUFFER_DELTA 32
#define BUFFER_TIME_DELTA 16
#define BUFFER_DATE 16
#define BUFFER_WEEK 8
#define BUFFER_ASTRONOMY 16
#define BUFFER_DELTA_RAW 12
#define BUFFER_WEATHER 16
#define BUFFER_STEPS 12

// ===== Staleness Thresholds =====
#define STALE_THRESHOLD_MINUTES 20
#define STALE_WIPE_THRESHOLD_MINUTES 60

// ===== Garbage Bag Constants =====
#define GARBAGE_BAG_NONE    0
#define GARBAGE_BAG_ORGANIC 1
#define GARBAGE_BAG_GREY    2
#define GARBAGE_BAG_BLACK   3

// ===== Persistent Storage Keys =====
enum PersistKeys {
    PERSIST_KEY_BG = 100,
    PERSIST_KEY_BG_DELTA,
    PERSIST_KEY_SUN_TIME,
    PERSIST_KEY_MOON_TIME,
    PERSIST_KEY_WEATHER_TEMP,
    PERSIST_KEY_WEATHER_WIND,
    PERSIST_KEY_MOON_PHASE,
    PERSIST_KEY_SUN_IS_RISING,
    PERSIST_KEY_MOON_IS_RISING,
    PERSIST_KEY_HOURLY_VIBRATION,
    PERSIST_KEY_UMBRELLA_ACTIVE,
    PERSIST_KEY_GARBAGE_BAG,
    PERSIST_KEY_TIMESTAMP,
    PERSIST_KEY_ALERT_OVERLAY_ENABLE,
    PERSIST_KEY_ALERT_OVERLAY_DURATION,
    PERSIST_KEY_AUDIO_ENABLE,
    PERSIST_KEY_AUDIO_VOLUME
};

// ===== Layout Constants (defined in layout.c) =====
extern const GRect RECT_TIME_LAYER;
extern const GRect RECT_GLUCOSE_LAYER;
extern const GRect RECT_DELTA_LAYER;
extern const GRect RECT_DATE_LAYER;
extern const GRect RECT_WEEK_LAYER;
extern const GRect RECT_SUN_LAYER;
extern const GRect RECT_MOON_LAYER;
extern const GRect RECT_SUN_ICON;
extern const GRect RECT_MOON_ICON;
extern const GRect RECT_WEATHER_TEMP_LAYER;
extern const GRect RECT_TEMP_ICON;
extern const GRect RECT_WEATHER_WIND_LAYER;
extern const GRect RECT_WIND_ICON;
extern const GRect RECT_STEPS_LAYER;
extern const GRect RECT_STEPS_ICON;
extern const GRect RECT_WEEKDAY_LAYER;
extern const GRect RECT_STATUS_BAR;

// Compact-mode layout constants (applied when Quick View is visible)
extern const GRect RECT_TIME_LAYER_COMPACT;
extern const GRect RECT_GLUCOSE_LAYER_COMPACT;
extern const GRect RECT_DELTA_LAYER_COMPACT;

// Status bar icon X positions differ between Emery and non-Emery platforms
extern const int STATUS_HOURLY_X;
extern const int STATUS_UMBRELLA_X;
extern const int STATUS_ORGANIC_X;
extern const int STATUS_GREY_X;
extern const int STATUS_BLACK_X;

// Platform-invariant layout constants (zero RAM cost)
#define STATUS_ICON_SIZE       12
#define STATUS_BAR_WIDTH       12
#define STATUS_BAR_HEIGHT       2
#define STATUS_ICON_Y           1
#define STATUS_BAR_Y           14
#define BATTERY_WIDTH          24
#define BATTERY_HEIGHT          9
#define BATTERY_BORDER          1
#define BATTERY_SEGMENT_HEIGHT  7
#define FETCH_INTERVAL_SECONDS 300
#define FETCH_INTERVAL_JITTER    5
#define FALLBACK_FETCH_MINUTES   5
#define STEPS_UPDATE_INTERVAL    5
#define APPMESSAGE_INBOX      1024
#define APPMESSAGE_OUTBOX      512

// ===== Message Type Discriminators =====
#define MSG_TYPE_SETTINGS  0
#define MSG_TYPE_GLUCOSE   1
#define MSG_TYPE_WEATHER   2
#define MSG_TYPE_ASTRONOMY 3
#define MSG_TYPE_VIBE_TEST 4
// Watch→JS alert push (outbox message requesting a Quick View timeline pin)
#define MSG_TYPE_ALERT     5

// ===== Alert Kind Discriminators =====
typedef enum {
    ALERT_KIND_BG_HIGH = 1,
    ALERT_KIND_BG_LOW  = 2,
    ALERT_KIND_HOURLY  = 3
} AlertKind;

// ===== Vibration Pattern Arrays (defined in glucose.c) =====
extern const uint32_t BG_HIGH_VIBE_PATTERN[];
extern const uint32_t BG_LOW_VIBE_PATTERN[];
#define BG_HIGH_VIBE_PATTERN_LEN 3
#define BG_LOW_VIBE_PATTERN_LEN  3

// ===== Shared Global State (defined in rat_scout.c) =====

// Text layers accessed by messaging.c and/or glucose.c
extern TextLayer *s_glucose_layer;
extern TextLayer *s_glucose_delta_layer;
extern TextLayer *s_sun_time_layer;
extern TextLayer *s_moon_time_layer;
extern TextLayer *s_weather_temp_layer;
extern TextLayer *s_weather_wind_layer;

// Astronomy state (draw_procs.c reads; messaging.c writes)
extern bool s_sun_is_rising;
extern bool s_moon_is_rising;
extern Layer *s_sun_corner_layer;
extern Layer *s_moon_corner_layer;

// Battery layer (created in rat_scout.c, marked dirty in draw_procs.c)
extern Layer *s_battery_layer;

// Status bar state (draw_procs.c reads; messaging.c writes)
extern bool s_hourly_vibration;
extern bool s_umbrella_active;
extern Layer *s_status_bar_layer;

// BG thresholds (glucose.c reads; messaging.c writes)
extern bool s_bg_vibration;
extern int s_bg_low_threshold;
extern int s_bg_high_threshold;

// Text buffers (shared across modules)
extern char s_bg_buffer[BUFFER_BG];
extern char s_delta_buffer[BUFFER_DELTA];
extern char s_delta_raw_buffer[BUFFER_DELTA_RAW];
extern char s_sun_time_buffer[BUFFER_ASTRONOMY];
extern char s_moon_time_buffer[BUFFER_ASTRONOMY];
extern char s_weather_temp_buffer[BUFFER_WEATHER];
extern char s_weather_wind_buffer[BUFFER_WEATHER];

// Reading state (shared across modules)
extern time_t s_last_reading_timestamp;
extern time_t s_next_fetch_time;
extern bool s_show_bg_delta;
extern bool s_show_time_delta;
extern bool s_date_format_mmdd;

// Cached garbage bag type (draw_procs.c reads; rat_scout.c writes)
extern char s_cached_garbage_bag;

// ===== Function Prototypes =====

// ui_helpers.c
TextLayer *create_text_layer(GRect bounds, GFont font, GTextAlignment alignment);
BitmapLayer *create_icon_layer(Layer *parent, uint32_t resource_id,
                               GBitmap **bitmap_out, GRect bounds);
void destroy_icon_layer(BitmapLayer *layer, GBitmap *bitmap);
void persist_write_string_if_changed(uint32_t key, const char *value, size_t buf_size);

// draw_procs.c
void battery_draw_proc(Layer *layer, GContext *ctx);
void status_bar_draw_proc(Layer *layer, GContext *ctx);
void sun_corner_draw_proc(Layer *layer, GContext *ctx);
void moon_corner_draw_proc(Layer *layer, GContext *ctx);
void battery_state_handler(BatteryChargeState charge_state);

// glucose.c
void update_delta_display(time_t current_time);
void check_bg_threshold_vibration(const char *bg_str);

// messaging.c
void send_alert_message(uint8_t kind, const char *value);
void inbox_received_callback(DictionaryIterator *iterator, void *context);
void inbox_dropped_callback(AppMessageResult reason, void *context);

// audio.c
// Play the melody associated with an alert kind (no-op if audio disabled or no speaker).
void audio_play_alert(AlertKind kind);
// Initialise from persisted settings; call once from init().
void audio_init(void);
// Update enable flag at runtime (called from handle_settings in messaging.c).
void audio_set_enabled(bool enabled);
// Update volume (0=low/35, 1=medium/70, 2=high/100).
void audio_set_volume(uint8_t level);
void outbox_failed_callback(DictionaryIterator *iterator, AppMessageResult reason, void *context);
void outbox_sent_callback(DictionaryIterator *iterator, void *context);

// rat_scout.c
void update_time(struct tm *tick_time, bool force_date);
void update_moon_icon(int phase);
void update_garbage_bag(int garbage_bag);

// messaging.c
void inbox_received_callback(DictionaryIterator *iterator, void *context);
void inbox_dropped_callback(AppMessageResult reason, void *context);
void outbox_failed_callback(DictionaryIterator *iterator, AppMessageResult reason, void *context);
void outbox_sent_callback(DictionaryIterator *iterator, void *context);
