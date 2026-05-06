#include "rat_scout.h"
#include "audio.h"

// ===== Shared Globals (extern declarations in rat_scout.h) =====

// Text layers accessed by messaging.c and/or glucose.c
TextLayer *s_glucose_layer;
TextLayer *s_glucose_delta_layer;
TextLayer *s_sun_time_layer;
TextLayer *s_moon_time_layer;
TextLayer *s_weather_temp_layer;
TextLayer *s_weather_wind_layer;

// Astronomy state
bool s_sun_is_rising = true;
bool s_moon_is_rising = true;
Layer *s_sun_corner_layer;
Layer *s_moon_corner_layer;

// Battery layer
Layer *s_battery_layer;

// Status bar state
bool s_hourly_vibration = false;
bool s_umbrella_active = false;
Layer *s_status_bar_layer;

// BG thresholds
bool s_bg_vibration = false;
int s_bg_low_threshold = 0;
int s_bg_high_threshold = 0;

// Text buffers
char s_bg_buffer[BUFFER_BG];
char s_delta_buffer[BUFFER_DELTA];
char s_delta_raw_buffer[BUFFER_DELTA_RAW];
char s_sun_time_buffer[BUFFER_ASTRONOMY];
char s_moon_time_buffer[BUFFER_ASTRONOMY];
char s_weather_temp_buffer[BUFFER_WEATHER];
char s_weather_wind_buffer[BUFFER_WEATHER];

// Reading state
time_t s_last_reading_timestamp = 0;
time_t s_next_fetch_time = 0;
bool s_show_bg_delta = true;
bool s_show_time_delta = true;
bool s_date_format_mmdd = false;  // false = dd.mm, true = mm.dd

// Cached garbage bag type
char s_cached_garbage_bag = '\0';

// ===== Private Globals (only used in this file) =====

static Window *s_main_window;
static GFont s_time_font;
static GFont s_main_font;
static GFont s_glucose_font;
static GFont s_extra_info_font;

static TextLayer *s_time_layer;
static TextLayer *s_date_layer;
static TextLayer *s_week_layer;
static TextLayer *s_weekday_layer;

static BitmapLayer *s_background_layer;
static GBitmap *s_background_bitmap;

static BitmapLayer *s_sun_icon_layer;
static GBitmap *s_sun_icon_bitmap;
static BitmapLayer *s_moon_icon_layer;
static GBitmap *s_moon_icon_bitmap;
static int s_current_moon_phase = -1;

static BitmapLayer *s_wind_icon_layer;
static GBitmap *s_wind_icon_bitmap;

static BitmapLayer *s_temp_icon_layer;
static GBitmap *s_temp_icon_bitmap;

#if defined(PBL_HEALTH)
static TextLayer *s_steps_layer;
static BitmapLayer *s_steps_icon_layer;
static GBitmap *s_steps_icon_bitmap;
static char s_steps_buffer[BUFFER_STEPS];
#endif

static int s_last_vibration_hour = -1;

// Status bar icon layers (only used in load/unload)
static BitmapLayer *s_hourly_icon_layer;
static GBitmap *s_hourly_icon_bitmap;
static BitmapLayer *s_umbrella_icon_layer;
static GBitmap *s_umbrella_icon_bitmap;
static BitmapLayer *s_organic_icon_layer;
static GBitmap *s_organic_icon_bitmap;
static BitmapLayer *s_grey_icon_layer;
static GBitmap *s_grey_icon_bitmap;
static BitmapLayer *s_black_icon_layer;
static GBitmap *s_black_icon_bitmap;

static char s_date_buffer[BUFFER_DATE];
static char s_week_buffer[BUFFER_WEEK];
static char s_weekday_buffer[4];

// ===== Functions =====

/**
 * Update step count from Health API
 */
static void update_steps(void) {
#if defined(PBL_HEALTH)
    HealthMetric metric = HealthMetricStepCount;
    time_t start = time_start_of_today();
    time_t end = time(NULL);
    HealthServiceAccessibilityMask mask = health_service_metric_accessible(metric, start, end);
    if (mask & HealthServiceAccessibilityMaskAvailable) {
        int steps = (int)health_service_sum_today(metric);
        snprintf(s_steps_buffer, sizeof(s_steps_buffer), "%d", steps);
    } else {
        snprintf(s_steps_buffer, sizeof(s_steps_buffer), "N/A");
    }
    text_layer_set_text(s_steps_layer, s_steps_buffer);
#endif
}

/**
 * Update time layer, and date/week layers only when the day changes.
 * Accepts tick_time to avoid a redundant time()/localtime() pair.
 * @param tick_time - Current broken-down time (NULL triggers fresh lookup)
 * @param force_date - Force date/week update (e.g. on first call)
 */
void update_time(struct tm *tick_time, bool force_date) {
    // Fall back to fresh lookup only when called without a tick_time
    time_t now;
    if (!tick_time) {
        now = time(NULL);
        tick_time = localtime(&now);
    }
    
    static char time_buffer[8];
    strftime(time_buffer, sizeof(time_buffer), 
             clock_is_24h_style() ? "%H:%M" : "%I:%M", tick_time);
    text_layer_set_text(s_time_layer, time_buffer);
    
    // Date and week only change at midnight; skip the rest of the time
    if (force_date || (tick_time->tm_hour == 0 && tick_time->tm_min == 0)) {
        strftime(s_date_buffer, sizeof(s_date_buffer),
                 s_date_format_mmdd ? "%m.%d" : "%d.%m", tick_time);
        text_layer_set_text(s_date_layer, s_date_buffer);
        
        strftime(s_week_buffer, sizeof(s_week_buffer), "W%V", tick_time);
        text_layer_set_text(s_week_layer, s_week_buffer);
    }
}

/**
 * Update garbage collection underscore indicator from JS-computed value.
 * @param garbage_bag - GARBAGE_BAG_NONE/ORGANIC/GREY/BLACK
 */
void update_garbage_bag(int garbage_bag) {
    char new_bag;
    switch (garbage_bag) {
        case GARBAGE_BAG_ORGANIC: new_bag = 'O'; break;
        case GARBAGE_BAG_GREY:    new_bag = 'G'; break;
        case GARBAGE_BAG_BLACK:   new_bag = 'B'; break;
        default:                  new_bag = '\0'; break;
    }
    if (s_cached_garbage_bag != new_bag) {
        s_cached_garbage_bag = new_bag;
        persist_write_int(PERSIST_KEY_GARBAGE_BAG, garbage_bag);
    }
    if (s_status_bar_layer) {
        layer_mark_dirty(s_status_bar_layer);
    }
}

/**
 * Update weekday abbreviation display.
 * Accepts tick_time to avoid redundant time()/localtime() calls.
 * @param tick_time - Current broken-down time (NULL triggers fresh lookup)
 */
static void update_weekday(struct tm *tick_time) {
    time_t now;
    if (!tick_time) {
        now = time(NULL);
        tick_time = localtime(&now);
    }
    
    // Update 3-letter weekday abbreviation (uppercase)
    strftime(s_weekday_buffer, sizeof(s_weekday_buffer), "%a", tick_time);
    for (int i = 0; s_weekday_buffer[i]; i++) {
        if (s_weekday_buffer[i] >= 'a' && s_weekday_buffer[i] <= 'z') {
            s_weekday_buffer[i] -= 32;
        }
    }
    text_layer_set_text(s_weekday_layer, s_weekday_buffer);
}

/**
 * Get the resource ID for a moon phase
 * @param phase - Moon phase index (0-7)
 */
static uint32_t get_moon_phase_resource(int phase) {
    switch (phase) {
        case 0: return RESOURCE_ID_MOON_NEW;
        case 1: return RESOURCE_ID_MOON_WAXING_CRESCENT;
        case 2: return RESOURCE_ID_MOON_FIRST_QUARTER;
        case 3: return RESOURCE_ID_MOON_WAXING_GIBBOUS;
        case 4: return RESOURCE_ID_MOON_FULL;
        case 5: return RESOURCE_ID_MOON_WANING_GIBBOUS;
        case 6: return RESOURCE_ID_MOON_THIRD_QUARTER;
        case 7: return RESOURCE_ID_MOON_WANING_CRESCENT;
        default: return RESOURCE_ID_MOON_NEW;
    }
}

/**
 * Update moon icon bitmap based on phase
 * @param phase - Moon phase index (0-7)
 */
void update_moon_icon(int phase) {
    if (phase < 0 || phase > 7) phase = 0;
    if (phase == s_current_moon_phase) return;
    
    s_current_moon_phase = phase;
    
    // Destroy old bitmap if exists
    if (s_moon_icon_bitmap) {
        gbitmap_destroy(s_moon_icon_bitmap);
    }
    
    s_moon_icon_bitmap = gbitmap_create_with_resource(get_moon_phase_resource(phase));
    bitmap_layer_set_bitmap(s_moon_icon_layer, s_moon_icon_bitmap);
    layer_mark_dirty(bitmap_layer_get_layer(s_moon_icon_layer));
    
    persist_write_int(PERSIST_KEY_MOON_PHASE, phase);
}

/**
 * Handle minute tick from system
 */
static void tick_handler(struct tm *tick_time, TimeUnits units_changed) {
    update_time(tick_time, false);
    
    // Update weekday abbreviation at midnight
    if (tick_time->tm_hour == 0 && tick_time->tm_min == 0) {
        update_weekday(tick_time);
    }
    
    // DEVIATION: PebbleOS mktime() is non-standard — it normalizes the input
    // struct tm to UTC via gmtime_r instead of localtime_r, clobbering
    // tick_time->tm_hour/tm_min to UTC values. Use time(NULL) instead.
    // See: PebbleOS src/fw/util/time/mktime.c — `*tb = *tbtemp` after gmtime_r.
    time_t current_time = time(NULL);
    
    // Handle hourly vibration.
    // DEVIATION: PebbleOS vibe queue silently drops new patterns while a
    // system notification vibration is in progress (s_pattern_in_progress
    // guard in vibe_pattern.c). Call vibes_cancel() first to preempt any
    // ongoing system vibe so the app's alerts are not silently lost.
    if (s_hourly_vibration && tick_time->tm_min == 0 && s_last_vibration_hour != tick_time->tm_hour) {
        s_last_vibration_hour = tick_time->tm_hour;
        audio_play_alert(ALERT_KIND_HOURLY);
        vibes_cancel();
        vibes_double_pulse();
        send_alert_message(ALERT_KIND_HOURLY, "");
    }
    
    // Update delta display every minute (pass derived time to avoid extra syscall)
    update_delta_display(current_time);
    
    // Update step count every 5 minutes (health data rarely changes faster)
    if (tick_time->tm_min % STEPS_UPDATE_INTERVAL == 0) {
        update_steps();
    }
    
    // Handle data fetching
    bool should_fetch = false;
    if (s_next_fetch_time > 0 && current_time >= s_next_fetch_time) {
        should_fetch = true;
        s_next_fetch_time = 0;
    } else if (s_next_fetch_time == 0 && tick_time->tm_min % FALLBACK_FETCH_MINUTES == 0) {
        should_fetch = true;
    }
    
    if (should_fetch) {
        DictionaryIterator *iter;
        AppMessageResult result = app_message_outbox_begin(&iter);
        if (result == APP_MSG_OK && iter) {
            dict_write_uint8(iter, 0, 0);
            app_message_outbox_send();
        }
    }
}

// ===== Adaptive Layout (UnobstructedArea) =====

/**
 * Apply the correct layout for the current unobstructed screen area.
 * Compact mode activates when Quick View is visible (unobs height below
 * platform threshold).  In compact mode: date, week, sun/moon, weather, and
 * step layers are hidden; BG layer grows to FONT_HUMAROID_64.
 * @param unobs - Current unobstructed bounds from layer_get_unobstructed_bounds
 */
static void layout_apply_unobstructed(GRect unobs) {
#if defined(PBL_PLATFORM_EMERY)
    bool compact = (unobs.size.h < 215);
#else
    bool compact = (unobs.size.h < 155);
#endif

    // Resize the three primary layers
    layer_set_frame(text_layer_get_layer(s_time_layer),
                    compact ? RECT_TIME_LAYER_COMPACT : RECT_TIME_LAYER);
    layer_set_frame(text_layer_get_layer(s_glucose_layer),
                    compact ? RECT_GLUCOSE_LAYER_COMPACT : RECT_GLUCOSE_LAYER);
    text_layer_set_font(s_glucose_layer, compact ? s_time_font : s_glucose_font);
    layer_set_frame(text_layer_get_layer(s_glucose_delta_layer),
                    compact ? RECT_DELTA_LAYER_COMPACT : RECT_DELTA_LAYER);

    // Hide/show secondary layers
    layer_set_hidden(text_layer_get_layer(s_date_layer), compact);
    layer_set_hidden(text_layer_get_layer(s_week_layer), compact);
    layer_set_hidden(text_layer_get_layer(s_sun_time_layer), compact);
    layer_set_hidden(text_layer_get_layer(s_moon_time_layer), compact);
    layer_set_hidden(text_layer_get_layer(s_weather_temp_layer), compact);
    layer_set_hidden(text_layer_get_layer(s_weather_wind_layer), compact);
    layer_set_hidden(bitmap_layer_get_layer(s_sun_icon_layer), compact);
    layer_set_hidden(bitmap_layer_get_layer(s_moon_icon_layer), compact);
    layer_set_hidden(s_sun_corner_layer, compact);
    layer_set_hidden(s_moon_corner_layer, compact);
    layer_set_hidden(bitmap_layer_get_layer(s_temp_icon_layer), compact);
    layer_set_hidden(bitmap_layer_get_layer(s_wind_icon_layer), compact);
#if defined(PBL_HEALTH)
    layer_set_hidden(text_layer_get_layer(s_steps_layer), compact);
    layer_set_hidden(bitmap_layer_get_layer(s_steps_icon_layer), compact);
#endif
}

static void on_unobstructed_will_change(GRect final_unobs, void *ctx) {
    layout_apply_unobstructed(final_unobs);
}

static void on_unobstructed_did_change(void *ctx) {
    Layer *window_layer = window_get_root_layer(s_main_window);
    layout_apply_unobstructed(layer_get_unobstructed_bounds(window_layer));
}

static void main_window_load(Window *window) {
    Layer *window_layer = window_get_root_layer(window);
    GRect bounds = layer_get_bounds(window_layer);
    // Create and add background layer
    s_background_bitmap = gbitmap_create_with_resource(RESOURCE_ID_BG_IMAGE);
    s_background_layer = bitmap_layer_create(bounds);
    bitmap_layer_set_bitmap(s_background_layer, s_background_bitmap);
    layer_add_child(window_layer, bitmap_layer_get_layer(s_background_layer));

    // Load custom fonts
    s_time_font = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_FONT_HUMAROID_64));
    s_main_font = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_FONT_HUMAROID_28));
    s_extra_info_font = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_FONT_HUMAROID_20));
    s_glucose_font = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_FONT_HUMAROID_32));

    // Create time layer
    s_time_layer = create_text_layer(RECT_TIME_LAYER, s_time_font, GTextAlignmentCenter);
    text_layer_set_text(s_time_layer, "00:00");
    layer_add_child(window_layer, text_layer_get_layer(s_time_layer));

    // Create glucose layer
    s_glucose_layer = create_text_layer(RECT_GLUCOSE_LAYER, s_glucose_font, GTextAlignmentRight);
    if (persist_exists(PERSIST_KEY_BG)) {
        persist_read_string(PERSIST_KEY_BG, s_bg_buffer, sizeof(s_bg_buffer));
        text_layer_set_text(s_glucose_layer, s_bg_buffer);
    } else {
        text_layer_set_text(s_glucose_layer, "Loading...");
    }
    layer_add_child(window_layer, text_layer_get_layer(s_glucose_layer));

    // Create glucose delta layer
    s_glucose_delta_layer = create_text_layer(RECT_DELTA_LAYER, s_extra_info_font, GTextAlignmentLeft);
    if (persist_exists(PERSIST_KEY_BG_DELTA)) {
        persist_read_string(PERSIST_KEY_BG_DELTA, s_delta_raw_buffer, sizeof(s_delta_raw_buffer));
    }
    if (persist_exists(PERSIST_KEY_TIMESTAMP)) {
        s_last_reading_timestamp = persist_read_int(PERSIST_KEY_TIMESTAMP);
    }
    update_delta_display(0);
    layer_add_child(window_layer, text_layer_get_layer(s_glucose_delta_layer));
    
    // Create date layer (day, month)
    s_date_layer = create_text_layer(RECT_DATE_LAYER, s_main_font, GTextAlignmentRight);
    text_layer_set_text(s_date_layer, "01 01");
    layer_add_child(window_layer, text_layer_get_layer(s_date_layer));
    
    // Create week layer
    s_week_layer = create_text_layer(RECT_WEEK_LAYER, s_extra_info_font, GTextAlignmentLeft);
    text_layer_set_text(s_week_layer, "W01");
    layer_add_child(window_layer, text_layer_get_layer(s_week_layer));
    
    // Create sun icon layer
    s_sun_icon_layer = create_icon_layer(window_layer, RESOURCE_ID_SUN_ICON,
                                          &s_sun_icon_bitmap, RECT_SUN_ICON);

    // Create sun corner indicator layer (overlays on sun icon)
    s_sun_is_rising = persist_exists(PERSIST_KEY_SUN_IS_RISING) ? persist_read_bool(PERSIST_KEY_SUN_IS_RISING) : true;
    s_sun_corner_layer = layer_create(RECT_SUN_ICON);
    layer_set_update_proc(s_sun_corner_layer, sun_corner_draw_proc);
    layer_add_child(window_layer, s_sun_corner_layer);

    // Create moon icon layer (default to new moon, updated when data arrives)
    int initial_moon_phase = persist_exists(PERSIST_KEY_MOON_PHASE) ? persist_read_int(PERSIST_KEY_MOON_PHASE) : 0;
    s_current_moon_phase = initial_moon_phase;
    s_moon_icon_layer = create_icon_layer(window_layer, get_moon_phase_resource(initial_moon_phase),
                                           &s_moon_icon_bitmap, RECT_MOON_ICON);

    // Create moon corner indicator layer (overlays on moon icon)
    s_moon_is_rising = persist_exists(PERSIST_KEY_MOON_IS_RISING) ? persist_read_bool(PERSIST_KEY_MOON_IS_RISING) : true;
    s_moon_corner_layer = layer_create(RECT_MOON_ICON);
    layer_set_update_proc(s_moon_corner_layer, moon_corner_draw_proc);
    layer_add_child(window_layer, s_moon_corner_layer);

    // Create sun time layer
    s_sun_time_layer = create_text_layer(RECT_SUN_LAYER, s_extra_info_font, GTextAlignmentRight);
    if (persist_exists(PERSIST_KEY_SUN_TIME)) {
        persist_read_string(PERSIST_KEY_SUN_TIME, s_sun_time_buffer, sizeof(s_sun_time_buffer));
        text_layer_set_text(s_sun_time_layer, s_sun_time_buffer);
    } else {
        text_layer_set_text(s_sun_time_layer, "N/A");
    }
    layer_add_child(window_layer, text_layer_get_layer(s_sun_time_layer));

    // Create moon time layer
    s_moon_time_layer = create_text_layer(RECT_MOON_LAYER, s_extra_info_font, GTextAlignmentRight);
    if (persist_exists(PERSIST_KEY_MOON_TIME)) {
        persist_read_string(PERSIST_KEY_MOON_TIME, s_moon_time_buffer, sizeof(s_moon_time_buffer));
        text_layer_set_text(s_moon_time_layer, s_moon_time_buffer);
    } else {
        text_layer_set_text(s_moon_time_layer, "N/A");
    }
    layer_add_child(window_layer, text_layer_get_layer(s_moon_time_layer));

    // Create temperature icon layer (bottom-right, next to temp text)
    s_temp_icon_layer = create_icon_layer(window_layer, RESOURCE_ID_TEMP_ICON,
                                           &s_temp_icon_bitmap, RECT_TEMP_ICON);

    // Create weather temperature layer (bottom-right, next to temp icon)
    s_weather_temp_layer = create_text_layer(RECT_WEATHER_TEMP_LAYER, s_extra_info_font, GTextAlignmentLeft);
    if (persist_exists(PERSIST_KEY_WEATHER_TEMP)) {
        persist_read_string(PERSIST_KEY_WEATHER_TEMP, s_weather_temp_buffer, sizeof(s_weather_temp_buffer));
        text_layer_set_text(s_weather_temp_layer, s_weather_temp_buffer);
    }
    layer_add_child(window_layer, text_layer_get_layer(s_weather_temp_layer));

    // Create wind icon layer
    s_wind_icon_layer = create_icon_layer(window_layer, RESOURCE_ID_WIND_ICON,
                                           &s_wind_icon_bitmap, RECT_WIND_ICON);

    // Create weather wind layer (bottom-right, below temp)
    s_weather_wind_layer = create_text_layer(RECT_WEATHER_WIND_LAYER, s_extra_info_font, GTextAlignmentLeft);
    if (persist_exists(PERSIST_KEY_WEATHER_WIND)) {
        persist_read_string(PERSIST_KEY_WEATHER_WIND, s_weather_wind_buffer, sizeof(s_weather_wind_buffer));
        text_layer_set_text(s_weather_wind_layer, s_weather_wind_buffer);
    }
    layer_add_child(window_layer, text_layer_get_layer(s_weather_wind_layer));
    
    // Create steps icon layer
#if defined(PBL_HEALTH)
    s_steps_icon_layer = create_icon_layer(window_layer, RESOURCE_ID_STEPS_ICON,
                                            &s_steps_icon_bitmap, RECT_STEPS_ICON);

    // Create steps text layer
    s_steps_layer = create_text_layer(RECT_STEPS_LAYER, s_extra_info_font, GTextAlignmentLeft);
    text_layer_set_text(s_steps_layer, "0");
    layer_add_child(window_layer, text_layer_get_layer(s_steps_layer));
#endif

    // Create battery indicator layer (sized to actual draw area in top-right)
    GRect battery_rect = GRect(bounds.size.w - BATTERY_WIDTH - 2, 2,
                                BATTERY_WIDTH + 2, BATTERY_HEIGHT + 4);
    s_battery_layer = layer_create(battery_rect);
    layer_set_update_proc(s_battery_layer, battery_draw_proc);
    layer_add_child(window_layer, s_battery_layer);

    // Create status bar icon layers (always visible, 12x12 each)
    GRect status_icon_rect;

    status_icon_rect = GRect(STATUS_HOURLY_X, STATUS_ICON_Y, STATUS_ICON_SIZE, STATUS_ICON_SIZE);
    s_hourly_icon_layer = create_icon_layer(window_layer, RESOURCE_ID_HOURLY_ICON,
                                             &s_hourly_icon_bitmap, status_icon_rect);

    status_icon_rect = GRect(STATUS_UMBRELLA_X, STATUS_ICON_Y, STATUS_ICON_SIZE, STATUS_ICON_SIZE);
    s_umbrella_icon_layer = create_icon_layer(window_layer, RESOURCE_ID_UMBRELLA_ICON,
                                               &s_umbrella_icon_bitmap, status_icon_rect);

    status_icon_rect = GRect(STATUS_ORGANIC_X, STATUS_ICON_Y, STATUS_ICON_SIZE, STATUS_ICON_SIZE);
    s_organic_icon_layer = create_icon_layer(window_layer, RESOURCE_ID_GARBAGE_ORGANIC,
                                              &s_organic_icon_bitmap, status_icon_rect);

    status_icon_rect = GRect(STATUS_GREY_X, STATUS_ICON_Y, STATUS_ICON_SIZE, STATUS_ICON_SIZE);
    s_grey_icon_layer = create_icon_layer(window_layer, RESOURCE_ID_GARBAGE_GREY,
                                           &s_grey_icon_bitmap, status_icon_rect);

    status_icon_rect = GRect(STATUS_BLACK_X, STATUS_ICON_Y, STATUS_ICON_SIZE, STATUS_ICON_SIZE);
    s_black_icon_layer = create_icon_layer(window_layer, RESOURCE_ID_GARBAGE_BLACK,
                                            &s_black_icon_bitmap, status_icon_rect);

    // Create weekday abbreviation text layer in status bar
    s_weekday_layer = create_text_layer(RECT_WEEKDAY_LAYER, s_extra_info_font, GTextAlignmentLeft);
    layer_add_child(window_layer, text_layer_get_layer(s_weekday_layer));

    // Restore persisted status bar state
    if (persist_exists(PERSIST_KEY_HOURLY_VIBRATION)) {
        s_hourly_vibration = persist_read_bool(PERSIST_KEY_HOURLY_VIBRATION);
    }
    if (persist_exists(PERSIST_KEY_UMBRELLA_ACTIVE)) {
        s_umbrella_active = persist_read_bool(PERSIST_KEY_UMBRELLA_ACTIVE);
    }
    if (persist_exists(PERSIST_KEY_GARBAGE_BAG)) {
        int persisted_bag = persist_read_int(PERSIST_KEY_GARBAGE_BAG);
        switch (persisted_bag) {
            case GARBAGE_BAG_ORGANIC: s_cached_garbage_bag = 'O'; break;
            case GARBAGE_BAG_GREY:    s_cached_garbage_bag = 'G'; break;
            case GARBAGE_BAG_BLACK:   s_cached_garbage_bag = 'B'; break;
            default:                  s_cached_garbage_bag = '\0'; break;
        }
    }

    // Create status bar underscore layer (draws active indicator bars)
    s_status_bar_layer = layer_create(RECT_STATUS_BAR);
    layer_set_update_proc(s_status_bar_layer, status_bar_draw_proc);
    layer_add_child(window_layer, s_status_bar_layer);
    
    // Initialize weekday display
    update_weekday(NULL);

    // Apply correct layout in case Quick View is already visible at startup
    layout_apply_unobstructed(layer_get_unobstructed_bounds(window_layer));
}

static void main_window_unload(Window *window)
{
    // Destroy text layers
    text_layer_destroy(s_time_layer);
    text_layer_destroy(s_glucose_layer);
    text_layer_destroy(s_glucose_delta_layer);
    text_layer_destroy(s_date_layer);
    text_layer_destroy(s_week_layer);
    text_layer_destroy(s_sun_time_layer);
    text_layer_destroy(s_moon_time_layer);
    text_layer_destroy(s_weather_temp_layer);
    text_layer_destroy(s_weather_wind_layer);
    text_layer_destroy(s_weekday_layer);

    // Destroy custom fonts
    fonts_unload_custom_font(s_time_font);
    fonts_unload_custom_font(s_main_font);
    fonts_unload_custom_font(s_glucose_font);
    fonts_unload_custom_font(s_extra_info_font);

    // Destroy background
    bitmap_layer_destroy(s_background_layer);
    gbitmap_destroy(s_background_bitmap);

    // Destroy icon layers
    destroy_icon_layer(s_sun_icon_layer, s_sun_icon_bitmap);
    destroy_icon_layer(s_moon_icon_layer, s_moon_icon_bitmap);
    if (s_sun_corner_layer) layer_destroy(s_sun_corner_layer);
    if (s_moon_corner_layer) layer_destroy(s_moon_corner_layer);
    destroy_icon_layer(s_temp_icon_layer, s_temp_icon_bitmap);
    destroy_icon_layer(s_wind_icon_layer, s_wind_icon_bitmap);

    // Destroy status bar icon layers
    destroy_icon_layer(s_hourly_icon_layer, s_hourly_icon_bitmap);
    destroy_icon_layer(s_umbrella_icon_layer, s_umbrella_icon_bitmap);
    destroy_icon_layer(s_organic_icon_layer, s_organic_icon_bitmap);
    destroy_icon_layer(s_grey_icon_layer, s_grey_icon_bitmap);
    destroy_icon_layer(s_black_icon_layer, s_black_icon_bitmap);

    // Destroy draw layers
    layer_destroy(s_battery_layer);
    layer_destroy(s_status_bar_layer);

#if defined(PBL_HEALTH)
    text_layer_destroy(s_steps_layer);
    destroy_icon_layer(s_steps_icon_layer, s_steps_icon_bitmap);
#endif
}

static void init(void) {
    // Create main Window element
    s_main_window = window_create();
    window_set_window_handlers(s_main_window, (WindowHandlers){
        .load = main_window_load,
        .unload = main_window_unload
    });

    // Show the Window
    window_stack_push(s_main_window, true);

    // Initialise audio from persisted settings
    audio_init();
    
    // Subscribe to system services
    tick_timer_service_subscribe(MINUTE_UNIT, tick_handler);
    battery_state_service_subscribe(battery_state_handler);
    unobstructed_area_service_subscribe((UnobstructedAreaHandlers){
        .will_change = on_unobstructed_will_change,
        .did_change  = on_unobstructed_did_change,
    }, NULL);
    
    // Initialize time (force date/week update) and battery
    update_time(NULL, true);
    BatteryChargeState initial_state = battery_state_service_peek();
    battery_state_handler(initial_state);

    // Register AppMessage callbacks
    app_message_register_inbox_received(inbox_received_callback);
    app_message_register_inbox_dropped(inbox_dropped_callback);
    app_message_register_outbox_failed(outbox_failed_callback);
    app_message_register_outbox_sent(outbox_sent_callback);

    // Open AppMessage
    app_message_open(APPMESSAGE_INBOX, APPMESSAGE_OUTBOX);
}

static void deinit(void) {
    tick_timer_service_unsubscribe();
    battery_state_service_unsubscribe();
    unobstructed_area_service_unsubscribe();
    window_destroy(s_main_window);
}

int main(void) {
    init();
    app_event_loop();
    deinit();
    return 0;
}
