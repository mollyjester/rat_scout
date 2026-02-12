#include <pebble.h>

// ===== Configuration Constants =====
// Layer dimensions and positioning
const GRect RECT_TIME_LAYER = {{2, 4}, {144, 66}};
const GRect RECT_GLUCOSE_LAYER = {{0, 83}, {71, 29}};
const GRect RECT_DELTA_LAYER = {{3, 106}, {71, 25}};
const GRect RECT_DATE_LAYER = {{78, 83}, {60, 29}};
const GRect RECT_WEEK_LAYER = {{78, 106}, {60, 25}};
const GRect RECT_SUN_LAYER = {{18, 127}, {55, 42}};
const GRect RECT_MOON_LAYER = {{18, 142}, {55, 42}};
const GRect RECT_SUN_ICON = {{4, 136}, {12, 12}};
const GRect RECT_MOON_ICON = {{4, 151}, {12, 12}};
const GRect RECT_WEATHER_TEMP_LAYER = {{78, 127}, {60, 29}};
const GRect RECT_WEATHER_WIND_LAYER = {{78, 142}, {60, 25}};
// Status bar layout (16px tall panel at top)
// Icons are 12x12, active bars are 12x2
const int STATUS_ICON_SIZE = 12;
const int STATUS_BAR_WIDTH = 12;
const int STATUS_BAR_HEIGHT = 2;
const int STATUS_ICON_Y = 1;
const int STATUS_BAR_Y = 14;
const int STATUS_HOURLY_X = 2;
const int STATUS_UMBRELLA_X = 16;   // 2 + 12 + 2
const int STATUS_ORGANIC_X = 34;    // 16 + 12 + 6
const int STATUS_GREY_X = 48;       // 34 + 12 + 2
const int STATUS_BLACK_X = 62;      // 48 + 12 + 2
const GRect RECT_WEEKDAY_LAYER = {{81, -9}, {40, 21}}; // 62 + 12 + 7
const GRect RECT_STATUS_BAR = {{0, 0}, {144, 16}};

// Battery indicator dimensions
const int BATTERY_WIDTH = 24;
const int BATTERY_HEIGHT = 9;
const int BATTERY_BORDER = 1;
const int BATTERY_SEGMENT_HEIGHT = 7;



// Garbage collection schedule (next bag indicator)
// Monday, Wednesday, Friday: Organic (O)
// Tuesday, Saturday: Black (B)
// Thursday: Grey (G)
// Collection at 9am daily except Sunday

// Data fetch timing (in seconds)
const int FETCH_INTERVAL_SECONDS = 300;
const int FETCH_INTERVAL_JITTER = 5;
const int FALLBACK_FETCH_MINUTES = 4;

// BG threshold vibration patterns
// High threshold: short vibration, pause, long vibration
static const uint32_t BG_HIGH_VIBE_PATTERN[] = {100, 200, 400};
// Low threshold: long vibration, pause, short vibration
static const uint32_t BG_LOW_VIBE_PATTERN[] = {400, 200, 100};

// Buffer sizes (use #define for compile-time constants for static arrays)
#define BUFFER_BG 16
#define BUFFER_DELTA 32
#define BUFFER_TIME_DELTA 16
#define BUFFER_DATE 16
#define BUFFER_WEEK 8
#define BUFFER_ASTRONOMY 16
#define BUFFER_DELTA_RAW 12
#define BUFFER_WEATHER 16

// AppMessage buffer sizes
const int APPMESSAGE_INBOX = 1024;
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
static TextLayer *s_weather_temp_layer;
static TextLayer *s_weather_wind_layer;
static TextLayer *s_weekday_layer;

static BitmapLayer *s_background_layer;
static GBitmap *s_background_bitmap;

static BitmapLayer *s_sun_icon_layer;
static GBitmap *s_sun_icon_bitmap;
static BitmapLayer *s_moon_icon_layer;
static GBitmap *s_moon_icon_bitmap;
static int s_current_moon_phase = -1;

static Layer *s_battery_layer;
static uint8_t s_battery_level = 100;
static bool s_is_charging = false;

static bool s_hourly_vibration = false;
static int s_last_vibration_hour = -1;
static bool s_umbrella_active = false;

// Status bar icon layers (always visible)
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

// Status bar underscore layer (draws active indicator bars)
static Layer *s_status_bar_layer;

static bool s_bg_vibration = false;
static int s_bg_low_threshold = 0;
static int s_bg_high_threshold = 0;

// BG zone tracking for one-shot vibration alerts
typedef enum {
    BG_ZONE_NORMAL = 0,
    BG_ZONE_HIGH,
    BG_ZONE_LOW
} BgZone;
static BgZone s_bg_zone = BG_ZONE_NORMAL;

// Text buffers
static char s_bg_buffer[BUFFER_BG];
static char s_delta_buffer[BUFFER_DELTA];
static char s_delta_raw_buffer[BUFFER_DELTA_RAW];
static char s_time_delta_buffer[BUFFER_TIME_DELTA];
static char s_date_buffer[BUFFER_DATE];
static char s_week_buffer[BUFFER_WEEK];
static char s_sun_time_buffer[BUFFER_ASTRONOMY];
static char s_moon_time_buffer[BUFFER_ASTRONOMY];
static char s_weather_temp_buffer[BUFFER_WEATHER];
static char s_weather_wind_buffer[BUFFER_WEATHER];
static char s_weekday_buffer[4];

// Reading state
static time_t s_last_reading_timestamp = 0;
static time_t s_next_fetch_time = 0;
static bool s_show_bg_delta = true;
static bool s_show_time_delta = true;

// Persistent storage keys
enum PersistKeys {
    PERSIST_KEY_BG = 100,
    PERSIST_KEY_BG_DELTA,
    PERSIST_KEY_SUN_TIME,
    PERSIST_KEY_MOON_TIME,
    PERSIST_KEY_WEATHER_TEMP,
    PERSIST_KEY_WEATHER_WIND,
    PERSIST_KEY_MOON_PHASE
};

// Forward declarations
static char get_next_garbage_bag(void);
static void update_moon_icon(int phase);

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
 * Update garbage collection indicator and weekday (marks status bar dirty)
 */
static void update_garbage_indicator(void) {
    if (s_status_bar_layer) {
        layer_mark_dirty(s_status_bar_layer);
    }
    
    // Update 3-letter weekday abbreviation (uppercase)
    time_t temp = time(NULL);
    struct tm *tick_time = localtime(&temp);
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
static void update_moon_icon(int phase) {
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
        case 0:  // Sunday before 9am - show Monday's collection
            return 'O';
        default:
            return '\0';
    }
}

/**
 * Render status bar active indicator bars (underscore beneath active icons)
 */
static void status_bar_draw_proc(Layer *layer, GContext *ctx) {
    graphics_context_set_fill_color(ctx, GColorBlack);
    
    // Hourly vibration active bar
    if (s_hourly_vibration) {
        graphics_fill_rect(ctx, GRect(STATUS_HOURLY_X, STATUS_BAR_Y, STATUS_BAR_WIDTH, STATUS_BAR_HEIGHT), 0, GCornerNone);
    }
    
    // Umbrella active bar
    if (s_umbrella_active) {
        graphics_fill_rect(ctx, GRect(STATUS_UMBRELLA_X, STATUS_BAR_Y, STATUS_BAR_WIDTH, STATUS_BAR_HEIGHT), 0, GCornerNone);
    }
    
    // Garbage collection: underscore the icon for the next collection type
    char bag = get_next_garbage_bag();
    switch (bag) {
        case 'O':
            graphics_fill_rect(ctx, GRect(STATUS_ORGANIC_X, STATUS_BAR_Y, STATUS_BAR_WIDTH, STATUS_BAR_HEIGHT), 0, GCornerNone);
            break;
        case 'G':
            graphics_fill_rect(ctx, GRect(STATUS_GREY_X, STATUS_BAR_Y, STATUS_BAR_WIDTH, STATUS_BAR_HEIGHT), 0, GCornerNone);
            break;
        case 'B':
            graphics_fill_rect(ctx, GRect(STATUS_BLACK_X, STATUS_BAR_Y, STATUS_BAR_WIDTH, STATUS_BAR_HEIGHT), 0, GCornerNone);
            break;
    }
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
    
    // Update garbage indicator only when it changes:
    // - At midnight (day change)
    // - At 9am (collection time cutoff)
    if ((tick_time->tm_hour == 0 && tick_time->tm_min == 0) ||
        (tick_time->tm_hour == 9 && tick_time->tm_min == 0)) {
        update_garbage_indicator();
    }
    
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
    if (persist_exists(PERSIST_KEY_BG)) {
        persist_read_string(PERSIST_KEY_BG, s_bg_buffer, sizeof(s_bg_buffer));
        text_layer_set_text(s_glucose_layer, s_bg_buffer);
    } else {
        text_layer_set_text(s_glucose_layer, "Loading...");
    }
    layer_add_child(window_layer, text_layer_get_layer(s_glucose_layer));

    // Create glucose delta layer
    s_glucose_delta_layer = create_text_layer(RECT_DELTA_LAYER, s_extra_info_font, GTextAlignmentCenter);
    if (persist_exists(PERSIST_KEY_BG_DELTA)) {
        persist_read_string(PERSIST_KEY_BG_DELTA, s_delta_raw_buffer, sizeof(s_delta_raw_buffer));
        snprintf(s_delta_buffer, sizeof(s_delta_buffer), "%s", s_delta_raw_buffer);
        text_layer_set_text(s_glucose_delta_layer, s_delta_buffer);
    }
    layer_add_child(window_layer, text_layer_get_layer(s_glucose_delta_layer));
    
    // Create date layer (day, month)
    s_date_layer = create_text_layer(RECT_DATE_LAYER, s_main_font, GTextAlignmentCenter);
    text_layer_set_text(s_date_layer, "01 01");
    layer_add_child(window_layer, text_layer_get_layer(s_date_layer));
    
    // Create week layer
    s_week_layer = create_text_layer(RECT_WEEK_LAYER, s_extra_info_font, GTextAlignmentCenter);
    text_layer_set_text(s_week_layer, "W01");
    layer_add_child(window_layer, text_layer_get_layer(s_week_layer));
    
    // Create sun icon layer
    s_sun_icon_bitmap = gbitmap_create_with_resource(RESOURCE_ID_SUN_ICON);
    s_sun_icon_layer = bitmap_layer_create(RECT_SUN_ICON);
    bitmap_layer_set_bitmap(s_sun_icon_layer, s_sun_icon_bitmap);
    bitmap_layer_set_compositing_mode(s_sun_icon_layer, GCompOpSet);
    layer_add_child(window_layer, bitmap_layer_get_layer(s_sun_icon_layer));

    // Create moon icon layer (default to new moon, updated when data arrives)
    int initial_moon_phase = persist_exists(PERSIST_KEY_MOON_PHASE) ? persist_read_int(PERSIST_KEY_MOON_PHASE) : 0;
    s_moon_icon_bitmap = gbitmap_create_with_resource(get_moon_phase_resource(initial_moon_phase));
    s_current_moon_phase = initial_moon_phase;
    s_moon_icon_layer = bitmap_layer_create(RECT_MOON_ICON);
    bitmap_layer_set_bitmap(s_moon_icon_layer, s_moon_icon_bitmap);
    bitmap_layer_set_compositing_mode(s_moon_icon_layer, GCompOpSet);
    layer_add_child(window_layer, bitmap_layer_get_layer(s_moon_icon_layer));

    // Create sun time layer
    s_sun_time_layer = create_text_layer(RECT_SUN_LAYER, s_extra_info_font, GTextAlignmentLeft);
    if (persist_exists(PERSIST_KEY_SUN_TIME)) {
        persist_read_string(PERSIST_KEY_SUN_TIME, s_sun_time_buffer, sizeof(s_sun_time_buffer));
        text_layer_set_text(s_sun_time_layer, s_sun_time_buffer);
    } else {
        text_layer_set_text(s_sun_time_layer, "N/A");
    }
    layer_add_child(window_layer, text_layer_get_layer(s_sun_time_layer));

    // Create moon time layer
    s_moon_time_layer = create_text_layer(RECT_MOON_LAYER, s_extra_info_font, GTextAlignmentLeft);
    if (persist_exists(PERSIST_KEY_MOON_TIME)) {
        persist_read_string(PERSIST_KEY_MOON_TIME, s_moon_time_buffer, sizeof(s_moon_time_buffer));
        text_layer_set_text(s_moon_time_layer, s_moon_time_buffer);
    } else {
        text_layer_set_text(s_moon_time_layer, "N/A");
    }
    layer_add_child(window_layer, text_layer_get_layer(s_moon_time_layer));

    // Create weather temperature layer (bottom-right)
    s_weather_temp_layer = create_text_layer(RECT_WEATHER_TEMP_LAYER, s_extra_info_font, GTextAlignmentCenter);
    if (persist_exists(PERSIST_KEY_WEATHER_TEMP)) {
        persist_read_string(PERSIST_KEY_WEATHER_TEMP, s_weather_temp_buffer, sizeof(s_weather_temp_buffer));
        text_layer_set_text(s_weather_temp_layer, s_weather_temp_buffer);
    }
    layer_add_child(window_layer, text_layer_get_layer(s_weather_temp_layer));

    // Create weather wind layer (bottom-right, below temp)
    s_weather_wind_layer = create_text_layer(RECT_WEATHER_WIND_LAYER, s_extra_info_font, GTextAlignmentCenter);
    if (persist_exists(PERSIST_KEY_WEATHER_WIND)) {
        persist_read_string(PERSIST_KEY_WEATHER_WIND, s_weather_wind_buffer, sizeof(s_weather_wind_buffer));
        text_layer_set_text(s_weather_wind_layer, s_weather_wind_buffer);
    }
    layer_add_child(window_layer, text_layer_get_layer(s_weather_wind_layer));
    
    // Create battery indicator layer
    s_battery_layer = layer_create(bounds);
    layer_set_update_proc(s_battery_layer, battery_draw_proc);
    layer_add_child(window_layer, s_battery_layer);

    // Create status bar icon layers (always visible, 12x12 each)
    s_hourly_icon_bitmap = gbitmap_create_with_resource(RESOURCE_ID_HOURLY_ICON);
    s_hourly_icon_layer = bitmap_layer_create(GRect(STATUS_HOURLY_X, STATUS_ICON_Y, STATUS_ICON_SIZE, STATUS_ICON_SIZE));
    bitmap_layer_set_bitmap(s_hourly_icon_layer, s_hourly_icon_bitmap);
    bitmap_layer_set_compositing_mode(s_hourly_icon_layer, GCompOpSet);
    layer_add_child(window_layer, bitmap_layer_get_layer(s_hourly_icon_layer));

    s_umbrella_icon_bitmap = gbitmap_create_with_resource(RESOURCE_ID_UMBRELLA_ICON);
    s_umbrella_icon_layer = bitmap_layer_create(GRect(STATUS_UMBRELLA_X, STATUS_ICON_Y, STATUS_ICON_SIZE, STATUS_ICON_SIZE));
    bitmap_layer_set_bitmap(s_umbrella_icon_layer, s_umbrella_icon_bitmap);
    bitmap_layer_set_compositing_mode(s_umbrella_icon_layer, GCompOpSet);
    layer_add_child(window_layer, bitmap_layer_get_layer(s_umbrella_icon_layer));

    s_organic_icon_bitmap = gbitmap_create_with_resource(RESOURCE_ID_GARBAGE_ORGANIC);
    s_organic_icon_layer = bitmap_layer_create(GRect(STATUS_ORGANIC_X, STATUS_ICON_Y, STATUS_ICON_SIZE, STATUS_ICON_SIZE));
    bitmap_layer_set_bitmap(s_organic_icon_layer, s_organic_icon_bitmap);
    bitmap_layer_set_compositing_mode(s_organic_icon_layer, GCompOpSet);
    layer_add_child(window_layer, bitmap_layer_get_layer(s_organic_icon_layer));

    s_grey_icon_bitmap = gbitmap_create_with_resource(RESOURCE_ID_GARBAGE_GREY);
    s_grey_icon_layer = bitmap_layer_create(GRect(STATUS_GREY_X, STATUS_ICON_Y, STATUS_ICON_SIZE, STATUS_ICON_SIZE));
    bitmap_layer_set_bitmap(s_grey_icon_layer, s_grey_icon_bitmap);
    bitmap_layer_set_compositing_mode(s_grey_icon_layer, GCompOpSet);
    layer_add_child(window_layer, bitmap_layer_get_layer(s_grey_icon_layer));

    s_black_icon_bitmap = gbitmap_create_with_resource(RESOURCE_ID_GARBAGE_BLACK);
    s_black_icon_layer = bitmap_layer_create(GRect(STATUS_BLACK_X, STATUS_ICON_Y, STATUS_ICON_SIZE, STATUS_ICON_SIZE));
    bitmap_layer_set_bitmap(s_black_icon_layer, s_black_icon_bitmap);
    bitmap_layer_set_compositing_mode(s_black_icon_layer, GCompOpSet);
    layer_add_child(window_layer, bitmap_layer_get_layer(s_black_icon_layer));

    // Create weekday abbreviation text layer in status bar
    s_weekday_layer = create_text_layer(RECT_WEEKDAY_LAYER, s_extra_info_font, GTextAlignmentLeft);
    layer_add_child(window_layer, text_layer_get_layer(s_weekday_layer));

    // Create status bar underscore layer (draws active indicator bars)
    s_status_bar_layer = layer_create(RECT_STATUS_BAR);
    layer_set_update_proc(s_status_bar_layer, status_bar_draw_proc);
    layer_add_child(window_layer, s_status_bar_layer);
    
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
    text_layer_destroy(s_weather_temp_layer);
    text_layer_destroy(s_weather_wind_layer);
    text_layer_destroy(s_weekday_layer);
    fonts_unload_custom_font(s_time_font);
    fonts_unload_custom_font(s_main_font);
    fonts_unload_custom_font(s_extra_info_font);
    bitmap_layer_destroy(s_background_layer);
    gbitmap_destroy(s_background_bitmap);
    bitmap_layer_destroy(s_sun_icon_layer);
    gbitmap_destroy(s_sun_icon_bitmap);
    bitmap_layer_destroy(s_moon_icon_layer);
    if (s_moon_icon_bitmap) {
        gbitmap_destroy(s_moon_icon_bitmap);
    }
    layer_destroy(s_battery_layer);
    // Destroy status bar layers
    bitmap_layer_destroy(s_hourly_icon_layer);
    gbitmap_destroy(s_hourly_icon_bitmap);
    bitmap_layer_destroy(s_umbrella_icon_layer);
    gbitmap_destroy(s_umbrella_icon_bitmap);
    bitmap_layer_destroy(s_organic_icon_layer);
    gbitmap_destroy(s_organic_icon_bitmap);
    bitmap_layer_destroy(s_grey_icon_layer);
    gbitmap_destroy(s_grey_icon_bitmap);
    bitmap_layer_destroy(s_black_icon_layer);
    gbitmap_destroy(s_black_icon_bitmap);
    layer_destroy(s_status_bar_layer);
}

/**
 * Check glucose value against thresholds and vibrate if needed.
 * High threshold: short then long vibration.
 * Low threshold: long then short vibration.
 * Values are compared in x10 scale to handle mmol/L decimals.
 * @param bg_str - The formatted glucose value string (e.g. "120" or "6.7")
 */
static void check_bg_threshold_vibration(const char *bg_str) {
    if (!s_bg_vibration) return;
    if (!bg_str || bg_str[0] == '\0') return;

    // Parse BG string to x10 integer (e.g. "120" -> 1200, "6.7" -> 67)
    int bg_x10 = 0;
    int decimal_places = -1;
    for (int i = 0; bg_str[i] != '\0'; i++) {
        if (bg_str[i] == '.') {
            decimal_places = 0;
        } else if (bg_str[i] >= '0' && bg_str[i] <= '9') {
            bg_x10 = bg_x10 * 10 + (bg_str[i] - '0');
            if (decimal_places >= 0) decimal_places++;
        }
    }
    // Scale to x10: if no decimal, multiply by 10; if 1 decimal place, already x10
    if (decimal_places <= 0) {
        bg_x10 *= 10;
    }
    // If more than 1 decimal place, divide excess (unlikely but safe)
    while (decimal_places > 1) {
        bg_x10 /= 10;
        decimal_places--;
    }

    // Determine current BG zone
    BgZone new_zone = BG_ZONE_NORMAL;
    if (s_bg_high_threshold > 0 && bg_x10 >= s_bg_high_threshold) {
        new_zone = BG_ZONE_HIGH;
    } else if (s_bg_low_threshold > 0 && bg_x10 <= s_bg_low_threshold) {
        new_zone = BG_ZONE_LOW;
    }

    // Only vibrate when entering a HIGH or LOW zone from a different zone
    if (new_zone != s_bg_zone) {
        if (new_zone == BG_ZONE_HIGH) {
            vibes_enqueue_custom_pattern((VibePattern){
                .durations = BG_HIGH_VIBE_PATTERN,
                .num_segments = ARRAY_LENGTH(BG_HIGH_VIBE_PATTERN)
            });
        } else if (new_zone == BG_ZONE_LOW) {
            vibes_enqueue_custom_pattern((VibePattern){
                .durations = BG_LOW_VIBE_PATTERN,
                .num_segments = ARRAY_LENGTH(BG_LOW_VIBE_PATTERN)
            });
        }
        s_bg_zone = new_zone;
    }
}

static void inbox_received_callback(DictionaryIterator *iterator, void *context) {
    // Handle hourly vibration setting
    Tuple *hourly_vibe_tuple = dict_find(iterator, MESSAGE_KEY_HOURLY_VIBRATION);
    if (hourly_vibe_tuple) {
        bool new_hourly = hourly_vibe_tuple->value->int8 == 1;
        if (s_hourly_vibration != new_hourly) {
            s_hourly_vibration = new_hourly;
            if (s_status_bar_layer) {
                layer_mark_dirty(s_status_bar_layer);
            }
        }
    }

    // Handle BG threshold vibration settings
    Tuple *bg_vibe_tuple = dict_find(iterator, MESSAGE_KEY_BG_VIBRATION);
    if (bg_vibe_tuple) {
        s_bg_vibration = bg_vibe_tuple->value->int8 == 1;
    }
    Tuple *bg_low_tuple = dict_find(iterator, MESSAGE_KEY_BG_LOW_THRESHOLD);
    if (bg_low_tuple) {
        s_bg_low_threshold = bg_low_tuple->value->int32;
    }
    Tuple *bg_high_tuple = dict_find(iterator, MESSAGE_KEY_BG_HIGH_THRESHOLD);
    if (bg_high_tuple) {
        s_bg_high_threshold = bg_high_tuple->value->int32;
    }

    // Handle blood glucose data
    Tuple *bgv_tuple = dict_find(iterator, MESSAGE_KEY_BG);
    if (bgv_tuple) {

    snprintf(s_bg_buffer, sizeof(s_bg_buffer), "%s", bgv_tuple->value->cstring);
    text_layer_set_text(s_glucose_layer, s_bg_buffer);
    persist_write_string(PERSIST_KEY_BG, s_bg_buffer);

    // Check glucose thresholds and vibrate if needed
    check_bg_threshold_vibration(s_bg_buffer);
    
    // Handle BG delta setting
    Tuple *showdelta_tuple = dict_find(iterator, MESSAGE_KEY_BG_SHOW_DELTA);
    if (showdelta_tuple) {
        s_show_bg_delta = showdelta_tuple->value->int8 == 1;
        if (s_show_bg_delta) {
            Tuple *bgdelta_tuple = dict_find(iterator, MESSAGE_KEY_BGDELTA);
            if (bgdelta_tuple) {
                snprintf(s_delta_raw_buffer, sizeof(s_delta_raw_buffer), "%s", bgdelta_tuple->value->cstring);
                persist_write_string(PERSIST_KEY_BG_DELTA, s_delta_raw_buffer);
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
        snprintf(s_sun_time_buffer, sizeof(s_sun_time_buffer), "%s", suntime_tuple->value->cstring);
        text_layer_set_text(s_sun_time_layer, s_sun_time_buffer);
        persist_write_string(PERSIST_KEY_SUN_TIME, s_sun_time_buffer);
    }
    
    Tuple *moontime_tuple = dict_find(iterator, MESSAGE_KEY_MOONTIME);
    if (moontime_tuple && moontime_tuple->value->cstring) {
        snprintf(s_moon_time_buffer, sizeof(s_moon_time_buffer), "%s", moontime_tuple->value->cstring);
        text_layer_set_text(s_moon_time_layer, s_moon_time_buffer);
        persist_write_string(PERSIST_KEY_MOON_TIME, s_moon_time_buffer);
    }
    
    Tuple *moon_phase_tuple = dict_find(iterator, MESSAGE_KEY_MOON_PHASE);
    if (moon_phase_tuple) {
        update_moon_icon(moon_phase_tuple->value->int32);
    }

    } // end if (bgv_tuple)

    // Handle weather data (arrives as separate message from BG)
    Tuple *weather_temp_tuple = dict_find(iterator, MESSAGE_KEY_WEATHER_TEMP);
    if (weather_temp_tuple && weather_temp_tuple->value->cstring) {
        Tuple *weather_umbrella_tuple = dict_find(iterator, MESSAGE_KEY_WEATHER_UMBRELLA);
        bool umbrella = weather_umbrella_tuple && weather_umbrella_tuple->value->int8 == 1;
        
        // Update umbrella status bar indicator
        if (s_umbrella_active != umbrella) {
            s_umbrella_active = umbrella;
            if (s_status_bar_layer) {
                layer_mark_dirty(s_status_bar_layer);
            }
        }
        
        snprintf(s_weather_temp_buffer, sizeof(s_weather_temp_buffer), "%s", weather_temp_tuple->value->cstring);
        text_layer_set_text(s_weather_temp_layer, s_weather_temp_buffer);
        persist_write_string(PERSIST_KEY_WEATHER_TEMP, s_weather_temp_buffer);
    }
    
    Tuple *weather_wind_tuple = dict_find(iterator, MESSAGE_KEY_WEATHER_WIND);
    if (weather_wind_tuple && weather_wind_tuple->value->cstring) {
        snprintf(s_weather_wind_buffer, sizeof(s_weather_wind_buffer), "W %s", weather_wind_tuple->value->cstring);
        text_layer_set_text(s_weather_wind_layer, s_weather_wind_buffer);
        persist_write_string(PERSIST_KEY_WEATHER_WIND, s_weather_wind_buffer);
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