#include <pebble.h>

// ===== Configuration Constants =====
// Layer dimensions and positioning
const GRect RECT_TIME_LAYER = {{0, 4}, {144, 66}};
const GRect RECT_GLUCOSE_LAYER = {{0, 83}, {71, 29}};
const GRect RECT_DELTA_LAYER = {{3, 106}, {71, 25}};
const GRect RECT_DATE_LAYER = {{78, 83}, {60, 29}};
const GRect RECT_WEEK_LAYER = {{78, 106}, {60, 25}};
const GRect RECT_SUN_LAYER = {{0, 133}, {71, 42}};
const GRect RECT_MOON_LAYER = {{78, 133}, {60, 42}};
const GRect RECT_HOURLY_LAYER = {{2, 1}, {7, 11}};
const GRect RECT_GARBAGE_LAYER = {{10, 1}, {7, 11}};

// Battery indicator dimensions
const int BATTERY_WIDTH = 24;
const int BATTERY_HEIGHT = 9;
const int BATTERY_BORDER = 1;
const int BATTERY_SEGMENT_HEIGHT = 7;

// Hourly indicator dimensions
const int HOURLY_HEIGHT = 11;
const int HOURLY_WIDTH = 7;
const int HOURLY_STROKE = 2;

// Garbage collection schedule (next bag indicator)
// Monday, Wednesday, Friday: Organic (O)
// Tuesday, Saturday: Black (B)
// Thursday: Grey (G)
// Collection at 9am daily except Sunday

// Data fetch timing (in seconds)
const int FETCH_INTERVAL_SECONDS = 300;
const int FETCH_INTERVAL_JITTER = 5;
const int FALLBACK_FETCH_MINUTES = 4;

// Buffer sizes (use #define for compile-time constants for static arrays)
#define BUFFER_BG 16
#define BUFFER_DELTA 32
#define BUFFER_TIME_DELTA 16
#define BUFFER_DATE 16
#define BUFFER_WEEK 8
#define BUFFER_ASTRONOMY 16
#define BUFFER_DELTA_RAW 12

// AppMessage buffer sizes
const int APPMESSAGE_INBOX = 512;
const int APPMESSAGE_OUTBOX = 512;

// ===== Global State =====
static Window *s_main_window;
static GFont s_time_font;
static GFont s_main_font;
static GFont s_extra_info_font;

static TextLayer *s_time_layer;
static TextLayer *s_glucose_layer;
static TextLayer *s_glucose_delta_layer;
static TextLayer *s_date_layer;
static TextLayer *s_week_layer;
static TextLayer *s_sun_time_layer;
static TextLayer *s_moon_time_layer;

static BitmapLayer *s_background_layer;
static GBitmap *s_background_bitmap;

static Layer *s_battery_layer;
static uint8_t s_battery_level = 100;
static bool s_is_charging = false;

static bool s_hourly_vibration = false;
static int s_last_vibration_hour = -1;
static Layer *s_hourly_layer;
static TextLayer *s_garbage_text_layer;

// Text buffers
static char s_bg_buffer[BUFFER_BG];
static char s_delta_buffer[BUFFER_DELTA];
static char s_delta_raw_buffer[BUFFER_DELTA_RAW];
static char s_time_delta_buffer[BUFFER_TIME_DELTA];
static char s_date_buffer[BUFFER_DATE];
static char s_week_buffer[BUFFER_WEEK];
static char s_sun_time_buffer[BUFFER_ASTRONOMY];
static char s_moon_time_buffer[BUFFER_ASTRONOMY];
static char s_garbage_buffer[2];

// Reading state
static time_t s_last_reading_timestamp = 0;
static time_t s_next_fetch_time = 0;
static bool s_show_bg_delta = true;
static bool s_show_time_delta = true;

// Forward declarations
static char get_next_garbage_bag(void);

/**
 * Update time, date, and week layers with current time
 */
static void update_time(void) {
    time_t temp = time(NULL);
    struct tm *tick_time = localtime(&temp);
    
    static char time_buffer[8];
    strftime(time_buffer, sizeof(time_buffer), 
             clock_is_24h_style() ? "%H:%M" : "%I:%M", tick_time);
    text_layer_set_text(s_time_layer, time_buffer);
    
    strftime(s_date_buffer, sizeof(s_date_buffer), "%d.%m", tick_time);
    text_layer_set_text(s_date_layer, s_date_buffer);
    
    strftime(s_week_buffer, sizeof(s_week_buffer), "W%V", tick_time);
    text_layer_set_text(s_week_layer, s_week_buffer);
}

/**
 * Update garbage collection indicator
 */
static void update_garbage_indicator(void) {
    char bag = get_next_garbage_bag();
    if (bag != '\0') {
        s_garbage_buffer[0] = bag;
        s_garbage_buffer[1] = '\0';
        text_layer_set_text(s_garbage_text_layer, s_garbage_buffer);
        layer_set_hidden(text_layer_get_layer(s_garbage_text_layer), false);
    } else {
        layer_set_hidden(text_layer_get_layer(s_garbage_text_layer), true);
    }
}

/**
 * Render battery indicator in top-right corner
 */
static void battery_draw_proc(Layer *layer, GContext *ctx) {
    GRect bounds = layer_get_bounds(layer);
    
    int x_start = bounds.size.w - BATTERY_WIDTH - 2;
    int y_start = 2;
    
    // Draw battery outline
    graphics_context_set_stroke_color(ctx, GColorBlack);
    graphics_context_set_stroke_width(ctx, BATTERY_BORDER);
    graphics_draw_rect(ctx, GRect(x_start, y_start, BATTERY_WIDTH - 3, BATTERY_HEIGHT));
    
    // Draw battery terminal (small nub on right side)
    graphics_draw_rect(ctx, GRect(x_start + BATTERY_WIDTH - 4, y_start + 2, 3, BATTERY_HEIGHT - 4));
    
    // Draw charging state or battery level
    if (s_is_charging) {
        int ch_x = x_start + 4;
        int ch_y = y_start + 2;
        
        graphics_context_set_stroke_color(ctx, GColorBlack);
        graphics_context_set_stroke_width(ctx, BATTERY_BORDER);
        
        // Arrow pointing left
        graphics_draw_line(ctx, GPoint(ch_x, ch_y + 2), GPoint(ch_x + 2, ch_y));
        graphics_draw_line(ctx, GPoint(ch_x + 2, ch_y), GPoint(ch_x + 2, ch_y + 4));
        graphics_draw_line(ctx, GPoint(ch_x + 2, ch_y + 4), GPoint(ch_x, ch_y + 2));
        graphics_draw_line(ctx, GPoint(ch_x, ch_y + 2), GPoint(ch_x + 9, ch_y + 2));

        // Plus sign next to arrow
        graphics_draw_line(ctx, GPoint(ch_x + 12, ch_y + 2), GPoint(ch_x + 14, ch_y + 2));
        graphics_draw_line(ctx, GPoint(ch_x + 13, ch_y + 1), GPoint(ch_x + 13, ch_y + 3));
    } else {
        // Calculate and draw battery charge level
        int usable_width = BATTERY_WIDTH - 3 - 2;
        int filled_width = (s_battery_level * usable_width) / 100;
        graphics_context_set_fill_color(ctx, GColorBlack);
        graphics_fill_rect(ctx, GRect(x_start + 1, y_start + 1, filled_width, BATTERY_SEGMENT_HEIGHT), 
                          0, GCornerNone);
    }
}

/**
 * Get the next garbage collection bag type
 * Returns: 'O' for Organic, 'B' for Black, 'G' for Grey, or '\0' if no collection
 */
static char get_next_garbage_bag(void) {
    time_t temp = time(NULL);
    struct tm *tick_time = localtime(&temp);
    
    int wday = tick_time->tm_wday;  // 0=Sunday, 1=Monday, ..., 6=Saturday
    int hour = tick_time->tm_hour;
    
    // If it's before 9am, today's collection is still next
    // If it's 9am or after, tomorrow's collection is next
    if (hour >= 9) {
        wday = (wday + 1) % 7;
    }
    
    // Determine bag type based on day
    switch (wday) {
        case 1:  // Monday
        case 3:  // Wednesday
        case 5:  // Friday
            return 'O';  // Organic
        case 2:  // Tuesday
        case 6:  // Saturday
            return 'B';  // Black
        case 4:  // Thursday
            return 'G';  // Grey
        case 0:  // Sunday - no collection, check Monday
            return 'O';
        default:
            return '\0';
    }
}

/**
 * Render hourly vibration indicator (capital 'H')
 */
static void hourly_indicator_draw_proc(Layer *layer, GContext *ctx) {
    if (!s_hourly_vibration) return;

    graphics_context_set_fill_color(ctx, GColorBlack);
    
    // Left vertical stroke
    graphics_fill_rect(ctx, GRect(0, 0, HOURLY_STROKE, HOURLY_HEIGHT), 0, GCornerNone);
    
    // Right vertical stroke
    graphics_fill_rect(ctx, GRect(HOURLY_WIDTH - HOURLY_STROKE, 0, HOURLY_STROKE, HOURLY_HEIGHT), 
                      0, GCornerNone);
    
    // Middle horizontal bar (centered vertically)
    int mid_y = (HOURLY_HEIGHT / 2) - (HOURLY_STROKE / 2);
    graphics_fill_rect(ctx, GRect(HOURLY_STROKE, mid_y, HOURLY_WIDTH - (2 * HOURLY_STROKE), HOURLY_STROKE), 
                      0, GCornerNone);
}

/**
 * Handle battery state changes
 */
static void battery_state_handler(BatteryChargeState charge_state) {
    s_battery_level = charge_state.charge_percent;
    s_is_charging = charge_state.is_charging;
    layer_mark_dirty(s_battery_layer);
}

/**
 * Update delta display based on current settings
 */
static void update_delta_display(void) {
    if (s_last_reading_timestamp <= 0) return;
    
    time_t current_time = time(NULL);
    int minutes_since_reading = (current_time - s_last_reading_timestamp) / 60;
    snprintf(s_time_delta_buffer, sizeof(s_time_delta_buffer), "%dm", minutes_since_reading);
    
    // Rebuild the delta display based on settings
    if (s_show_bg_delta && s_show_time_delta) {
        snprintf(s_delta_buffer, sizeof(s_delta_buffer), "%s %s", s_delta_raw_buffer, s_time_delta_buffer);
    } else if (s_show_bg_delta) {
        snprintf(s_delta_buffer, sizeof(s_delta_buffer), "%s", s_delta_raw_buffer);
    } else if (s_show_time_delta) {
        snprintf(s_delta_buffer, sizeof(s_delta_buffer), "%s", s_time_delta_buffer);
    } else {
        s_delta_buffer[0] = '\0';
    }
    
    text_layer_set_text(s_glucose_delta_layer, s_delta_buffer);
    layer_set_hidden(text_layer_get_layer(s_glucose_delta_layer), 
                    !s_show_bg_delta && !s_show_time_delta);
}

/**
 * Handle minute tick from system
 */
static void tick_handler(struct tm *tick_time, TimeUnits units_changed) {
    update_time();
    update_garbage_indicator();
    time_t current_time = time(NULL);
    
    // Handle hourly vibration
    if (s_hourly_vibration && tick_time->tm_min == 0 && s_last_vibration_hour != tick_time->tm_hour) {
        s_last_vibration_hour = tick_time->tm_hour;
        vibes_double_pulse();
    }
    
    // Update delta display every minute
    update_delta_display();
    
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
        app_message_outbox_begin(&iter);
        dict_write_uint8(iter, 0, 0);
        app_message_outbox_send();
    }
}

/**
 * Create and configure a text layer with common settings
 */
static TextLayer *create_text_layer(GRect bounds, GFont font, GTextAlignment alignment) {
    TextLayer *layer = text_layer_create(bounds);
    text_layer_set_background_color(layer, GColorClear);
    text_layer_set_text_color(layer, GColorBlack);
    text_layer_set_text_alignment(layer, alignment);
    text_layer_set_font(layer, font);
    return layer;
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

    // Create time layer
    s_time_layer = create_text_layer(RECT_TIME_LAYER, s_time_font, GTextAlignmentCenter);
    text_layer_set_text(s_time_layer, "00:00");
    layer_add_child(window_layer, text_layer_get_layer(s_time_layer));

    // Create glucose layer
    s_glucose_layer = create_text_layer(RECT_GLUCOSE_LAYER, s_main_font, GTextAlignmentCenter);
    text_layer_set_text(s_glucose_layer, "Loading...");
    layer_add_child(window_layer, text_layer_get_layer(s_glucose_layer));

    // Create glucose delta layer
    s_glucose_delta_layer = create_text_layer(RECT_DELTA_LAYER, s_extra_info_font, GTextAlignmentCenter);
    layer_add_child(window_layer, text_layer_get_layer(s_glucose_delta_layer));
    
    // Create date layer (day, month)
    s_date_layer = create_text_layer(RECT_DATE_LAYER, s_main_font, GTextAlignmentCenter);
    text_layer_set_text(s_date_layer, "01 01");
    layer_add_child(window_layer, text_layer_get_layer(s_date_layer));
    
    // Create week layer
    s_week_layer = create_text_layer(RECT_WEEK_LAYER, s_extra_info_font, GTextAlignmentCenter);
    text_layer_set_text(s_week_layer, "W01");
    layer_add_child(window_layer, text_layer_get_layer(s_week_layer));
    
    // Create sun time layer
    s_sun_time_layer = create_text_layer(RECT_SUN_LAYER, s_extra_info_font, GTextAlignmentCenter);
    text_layer_set_text(s_sun_time_layer, "S N/A");
    layer_add_child(window_layer, text_layer_get_layer(s_sun_time_layer));

    // Create moon time layer
    s_moon_time_layer = create_text_layer(RECT_MOON_LAYER, s_extra_info_font, GTextAlignmentCenter);
    text_layer_set_text(s_moon_time_layer, "M N/A");
    layer_add_child(window_layer, text_layer_get_layer(s_moon_time_layer));
    
    // Create battery indicator layer
    s_battery_layer = layer_create(bounds);
    layer_set_update_proc(s_battery_layer, battery_draw_proc);
    layer_add_child(window_layer, s_battery_layer);

    // Create hourly indicator layer
    s_hourly_layer = layer_create(RECT_HOURLY_LAYER);
    layer_set_update_proc(s_hourly_layer, hourly_indicator_draw_proc);
    layer_add_child(window_layer, s_hourly_layer);

    // Create garbage collection indicator layer (text next to hourly indicator)
    s_garbage_text_layer = text_layer_create(RECT_GARBAGE_LAYER);
    text_layer_set_background_color(s_garbage_text_layer, GColorClear);
    text_layer_set_text_color(s_garbage_text_layer, GColorBlack);
    text_layer_set_text_alignment(s_garbage_text_layer, GTextAlignmentLeft);
    text_layer_set_font(s_garbage_text_layer, s_extra_info_font);
    text_layer_set_text(s_garbage_text_layer, "");
    layer_add_child(window_layer, text_layer_get_layer(s_garbage_text_layer));
    
    // Initialize garbage indicator
    update_garbage_indicator();
}

static void main_window_unload(Window *window)
{
    text_layer_destroy(s_time_layer);
    text_layer_destroy(s_glucose_layer);
    text_layer_destroy(s_glucose_delta_layer);
    text_layer_destroy(s_date_layer);
    text_layer_destroy(s_week_layer);
    text_layer_destroy(s_sun_time_layer);
    text_layer_destroy(s_moon_time_layer);
    text_layer_destroy(s_garbage_text_layer);
    fonts_unload_custom_font(s_time_font);
    fonts_unload_custom_font(s_main_font);
    fonts_unload_custom_font(s_extra_info_font);
    bitmap_layer_destroy(s_background_layer);
    gbitmap_destroy(s_background_bitmap);
    layer_destroy(s_battery_layer);
    layer_destroy(s_hourly_layer);
}

static void inbox_received_callback(DictionaryIterator *iterator, void *context) {
    // Handle hourly vibration setting
    Tuple *hourly_vibe_tuple = dict_find(iterator, MESSAGE_KEY_HOURLY_VIBRATION);
    if (hourly_vibe_tuple) {
        bool new_hourly = hourly_vibe_tuple->value->int8 == 1;
        if (s_hourly_vibration != new_hourly) {
            s_hourly_vibration = new_hourly;
            if (s_hourly_layer) {
                layer_mark_dirty(s_hourly_layer);
            }
        }
    }

    // Handle blood glucose data
    Tuple *bgv_tuple = dict_find(iterator, MESSAGE_KEY_BG);
    if (!bgv_tuple) return;

    snprintf(s_bg_buffer, sizeof(s_bg_buffer), "%s", bgv_tuple->value->cstring);
    text_layer_set_text(s_glucose_layer, s_bg_buffer);
    
    // Handle BG delta setting
    Tuple *showdelta_tuple = dict_find(iterator, MESSAGE_KEY_BG_SHOW_DELTA);
    if (showdelta_tuple) {
        s_show_bg_delta = showdelta_tuple->value->int8 == 1;
        if (s_show_bg_delta) {
            Tuple *bgdelta_tuple = dict_find(iterator, MESSAGE_KEY_BGDELTA);
            if (bgdelta_tuple) {
                snprintf(s_delta_raw_buffer, sizeof(s_delta_raw_buffer), "%s", bgdelta_tuple->value->cstring);
            }
        }
    }

    // Handle time delta setting
    Tuple *show_timedelta_tuple = dict_find(iterator, MESSAGE_KEY_BG_SHOW_TIMEDELTA);
    if (show_timedelta_tuple) {
        s_show_time_delta = show_timedelta_tuple->value->int8 == 1;
    }
    
    // Handle timestamp and update next fetch time
    Tuple *timestamp_tuple = dict_find(iterator, MESSAGE_KEY_TIMESTAMP);
    if (timestamp_tuple) {
        s_last_reading_timestamp = timestamp_tuple->value->int32;
        s_next_fetch_time = s_last_reading_timestamp + FETCH_INTERVAL_SECONDS + FETCH_INTERVAL_JITTER;
        update_delta_display();
    }
    
    // Handle astronomy data
    Tuple *suntime_tuple = dict_find(iterator, MESSAGE_KEY_SUNTIME);
    if (suntime_tuple && suntime_tuple->value->cstring) {
        snprintf(s_sun_time_buffer, sizeof(s_sun_time_buffer), "S %s", suntime_tuple->value->cstring);
        text_layer_set_text(s_sun_time_layer, s_sun_time_buffer);
    }
    
    Tuple *moontime_tuple = dict_find(iterator, MESSAGE_KEY_MOONTIME);
    if (moontime_tuple && moontime_tuple->value->cstring) {
        snprintf(s_moon_time_buffer, sizeof(s_moon_time_buffer), "M %s", moontime_tuple->value->cstring);
        text_layer_set_text(s_moon_time_layer, s_moon_time_buffer);
    }
}

static void inbox_dropped_callback(AppMessageResult reason, void *context)
{
    APP_LOG(APP_LOG_LEVEL_ERROR, "Message dropped! reason=%d", (int)reason);
}

static void outbox_failed_callback(DictionaryIterator *iterator, AppMessageResult reason, void *context)
{
    APP_LOG(APP_LOG_LEVEL_ERROR, "Outbox send failed!");
}

static void outbox_sent_callback(DictionaryIterator *iterator, void *context)
{
    APP_LOG(APP_LOG_LEVEL_INFO, "Outbox send success!");
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
    
    // Subscribe to system services
    tick_timer_service_subscribe(MINUTE_UNIT, tick_handler);
    battery_state_service_subscribe(battery_state_handler);
    
    // Initialize time and battery
    update_time();
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
    window_destroy(s_main_window);
    battery_state_service_unsubscribe();
}

int main(void) {
    init();
    app_event_loop();
    deinit();
    return 0;
}