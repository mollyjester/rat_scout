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
    PERSIST_KEY_TIMESTAMP
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

extern const int STATUS_ICON_SIZE;
extern const int STATUS_BAR_WIDTH;
extern const int STATUS_BAR_HEIGHT;
extern const int STATUS_ICON_Y;
extern const int STATUS_BAR_Y;
extern const int STATUS_HOURLY_X;
extern const int STATUS_UMBRELLA_X;
extern const int STATUS_ORGANIC_X;
extern const int STATUS_GREY_X;
extern const int STATUS_BLACK_X;

extern const int BATTERY_WIDTH;
extern const int BATTERY_HEIGHT;
extern const int BATTERY_BORDER;
extern const int BATTERY_SEGMENT_HEIGHT;

extern const int FETCH_INTERVAL_SECONDS;
extern const int FETCH_INTERVAL_JITTER;
extern const int FALLBACK_FETCH_MINUTES;

extern const int APPMESSAGE_INBOX;
extern const int APPMESSAGE_OUTBOX;

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
void update_delta_display(void);
void check_bg_threshold_vibration(const char *bg_str);

// rat_scout.c
void update_time(struct tm *tick_time, bool force_date);
void update_moon_icon(int phase);
void update_garbage_bag(int garbage_bag);

// messaging.c
void inbox_received_callback(DictionaryIterator *iterator, void *context);
void inbox_dropped_callback(AppMessageResult reason, void *context);
void outbox_failed_callback(DictionaryIterator *iterator, AppMessageResult reason, void *context);
void outbox_sent_callback(DictionaryIterator *iterator, void *context);
