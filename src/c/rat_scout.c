#include <pebble.h>

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

static char bgv_buffer[16];
static char bgdelta_buffer[32];
static char bg_buffer[32];
static char bgdelta_raw_buffer[12];    // Store just the delta value
static char time_since_reading_buffer[16];
static char date_buffer[16];            // Store day and month
static char week_buffer[8];             // Store week number with W prefix
static char sun_time_buffer[16];        // Store sunrise or sunset time
static char moon_time_buffer[16];       // Store moonrise or moonset time

/* Store the last reading timestamp and next fetch time */
static time_t s_last_reading_timestamp = 0;
static time_t s_next_fetch_time = 0;
static bool s_show_bg_delta = true;
static bool s_show_time_delta = true;

static void update_time()
{
    // Get a tm structure
    time_t temp = time(NULL);
    struct tm *tick_time = localtime(&temp);

    // Write the current hours and minutes into a buffer
    static char s_buffer[8];
    strftime(s_buffer, sizeof(s_buffer), clock_is_24h_style() ? "%H:%M" : "%I:%M", tick_time);

    // Display this time on the TextLayer
    text_layer_set_text(s_time_layer, s_buffer);
    
    // Update date information (day and month)
    strftime(date_buffer, sizeof(date_buffer), "%d.%m", tick_time);
    text_layer_set_text(s_date_layer, date_buffer);
    
    // Update week number with W prefix
    strftime(week_buffer, sizeof(week_buffer), "W%V", tick_time);
    text_layer_set_text(s_week_layer, week_buffer);
}

static void battery_draw_proc(Layer *layer, GContext *ctx)
{
    // Get bounds of the layer
    GRect bounds = layer_get_bounds(layer);
    
    // Battery dimensions
    const int BATTERY_WIDTH = 24;    // Main battery body width
    const int BATTERY_HEIGHT = 9;
    const int BORDER_WIDTH = 1;
    const int SEGMENT_HEIGHT = 7;
    
    // Position in top right corner with some padding
    int x_start = bounds.size.w - BATTERY_WIDTH - 2;
    int y_start = 2;
    
    // Draw battery outline
    graphics_context_set_stroke_color(ctx, GColorBlack);
    graphics_context_set_stroke_width(ctx, BORDER_WIDTH);
    
    // Draw main battery body
    graphics_draw_rect(ctx, GRect(x_start, y_start, BATTERY_WIDTH - 3, BATTERY_HEIGHT));
    
    // Draw battery terminal (small nub on right side)
    graphics_draw_rect(ctx, GRect(x_start + BATTERY_WIDTH - 4, y_start + 2, 3, BATTERY_HEIGHT - 4));
    
    // Draw charging state, otherwise show battery charge level
    if (s_is_charging) {
        int ch_x = x_start + 4;
        int ch_y = y_start + 2;
        
        graphics_context_set_stroke_color(ctx, GColorBlack);
        graphics_context_set_stroke_width(ctx, 1);
        
        // Arrow pointing left
        graphics_draw_line(ctx, GPoint(ch_x, ch_y + 2), GPoint(ch_x + 2, ch_y));
        graphics_draw_line(ctx, GPoint(ch_x + 2, ch_y), GPoint(ch_x + 2, ch_y + 4));
        graphics_draw_line(ctx, GPoint(ch_x + 2, ch_y + 4), GPoint(ch_x, ch_y + 2));
        graphics_draw_line(ctx, GPoint(ch_x, ch_y + 2), GPoint(ch_x + 9, ch_y + 2));

        // Plus sign next to arrow
        graphics_draw_line(ctx, GPoint(ch_x + 12, ch_y + 2), GPoint(ch_x + 14, ch_y + 2));
        graphics_draw_line(ctx, GPoint(ch_x + 13, ch_y + 1), GPoint(ch_x + 13, ch_y + 3));
    } else {
        // Calculate the width of the filled portion based on battery level
        int usable_width = BATTERY_WIDTH - 3 - 2;  // Account for borders and terminal
        int filled_width = (s_battery_level * usable_width) / 100;
        
        // Draw filled rectangle representing battery charge
        graphics_context_set_fill_color(ctx, GColorBlack);
        graphics_fill_rect(ctx, GRect(x_start + 1, y_start + 1, filled_width, SEGMENT_HEIGHT), 0, GCornerNone);
    }
}

static void hourly_indicator_draw_proc(Layer *layer, GContext *ctx)
{
    // Draw a simple capital 'H' 11 pixels tall when hourly vibration is enabled.
    if (!s_hourly_vibration) {
        // Nothing to draw when disabled
        return;
    }

    const int H_HEIGHT = 11;
    const int H_WIDTH = 7;
    const int STROKE = 2;

    // Center the H within the layer bounds
    int x0 = 0; // left of the layer
    int y0 = 0; // top of the layer

    graphics_context_set_fill_color(ctx, GColorBlack);

    // Left vertical stroke
    graphics_fill_rect(ctx, GRect(x0, y0, STROKE, H_HEIGHT), 0, GCornerNone);

    // Right vertical stroke
    graphics_fill_rect(ctx, GRect(x0 + H_WIDTH - STROKE, y0, STROKE, H_HEIGHT), 0, GCornerNone);

    // Middle horizontal bar (centered vertically)
    int mid_y = y0 + (H_HEIGHT / 2) - (STROKE / 2);
    graphics_fill_rect(ctx, GRect(x0 + STROKE, mid_y, H_WIDTH - (2 * STROKE), STROKE), 0, GCornerNone);
}

static void battery_state_handler(BatteryChargeState charge_state)
{
    s_battery_level = charge_state.charge_percent;
    s_is_charging = charge_state.is_charging;
    layer_mark_dirty(s_battery_layer);
}

static void tick_handler(struct tm *tick_time, TimeUnits units_changed)
{
    update_time();

    time_t current_time = time(NULL);
    
    // Handle hourly vibration
    if (s_hourly_vibration && tick_time->tm_min == 0 && s_last_vibration_hour != tick_time->tm_hour) {
        s_last_vibration_hour = tick_time->tm_hour;
        vibes_double_pulse();
    }
    
    // Update time since last reading and refresh delta display
    if (s_last_reading_timestamp > 0)
    {
        int minutes_since_reading = (current_time - s_last_reading_timestamp) / 60;
    snprintf(time_since_reading_buffer, sizeof(time_since_reading_buffer), "%dm", minutes_since_reading);
        
        // Rebuild the delta display with both delta and time since reading based on settings
        if (s_show_bg_delta && s_show_time_delta) {
            snprintf(bgdelta_buffer, sizeof(bgdelta_buffer), "%s %s", bgdelta_raw_buffer, time_since_reading_buffer);
        } else if (s_show_bg_delta) {
            snprintf(bgdelta_buffer, sizeof(bgdelta_buffer), "%s", bgdelta_raw_buffer);
        } else if (s_show_time_delta) {
            snprintf(bgdelta_buffer, sizeof(bgdelta_buffer), "%s", time_since_reading_buffer);
        } else {
            bgdelta_buffer[0] = '\0';
        }
        text_layer_set_text(s_glucose_delta_layer, bgdelta_buffer);
        // Hide the layer if both settings are disabled
        layer_set_hidden(text_layer_get_layer(s_glucose_delta_layer), !s_show_bg_delta && !s_show_time_delta);
    }
    
    // If next fetch time is set and current time has reached or passed it, fetch data
    if (s_next_fetch_time > 0 && current_time >= s_next_fetch_time)
    {
        // Request new data
        DictionaryIterator *iter;
        app_message_outbox_begin(&iter);

        dict_write_uint8(iter, 0, 0);
        app_message_outbox_send();
        
        // Reset next fetch time - will be updated when reading is received
        s_next_fetch_time = 0;
    }
    // Fallback: if no timestamp received yet, use original 4-minute interval
    else if (s_next_fetch_time == 0 && tick_time->tm_min % 4 == 0)
    {
        DictionaryIterator *iter;
        app_message_outbox_begin(&iter);

        dict_write_uint8(iter, 0, 0);
        app_message_outbox_send();
    }
}

static void main_window_load(Window *window)
{
    // Get information about the Window
    Layer *window_layer = window_get_root_layer(window);
    GRect bounds = layer_get_bounds(window_layer);

    // Create GBitmap
    s_background_bitmap = gbitmap_create_with_resource(RESOURCE_ID_BG_IMAGE);

    // Create BitmapLayer to display the GBitmap
    s_background_layer = bitmap_layer_create(bounds);

    // Set the bitmap onto the layer and add to the window
    bitmap_layer_set_bitmap(s_background_layer, s_background_bitmap);
    layer_add_child(window_layer, bitmap_layer_get_layer(s_background_layer));

    // Create GFont
    s_time_font = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_FONT_HUMAROID_64));
    s_main_font = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_FONT_HUMAROID_28));
    s_extra_info_font = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_FONT_HUMAROID_20));

    // Create the TextLayer with specific bounds
    s_time_layer = text_layer_create(
        GRect(0, 4, bounds.size.w, 66));

    // Improve the layout to be more like a watchface
    text_layer_set_background_color(s_time_layer, GColorClear);
    text_layer_set_text_color(s_time_layer, GColorBlack);
    text_layer_set_text(s_time_layer, "00:00");
    text_layer_set_font(s_time_layer, s_time_font);
    text_layer_set_text_alignment(s_time_layer, GTextAlignmentCenter);

    // Add it as a child layer to the Window's root layer
    layer_add_child(window_layer, text_layer_get_layer(s_time_layer));

    s_glucose_layer = text_layer_create(
        GRect(0, 83, 71, 29));

    text_layer_set_background_color(s_glucose_layer, GColorClear);
    text_layer_set_text_color(s_glucose_layer, GColorBlack);
    text_layer_set_text_alignment(s_glucose_layer, GTextAlignmentCenter);
    text_layer_set_font(s_glucose_layer, s_main_font);
    text_layer_set_text(s_glucose_layer, "Loading...");

    layer_add_child(window_get_root_layer(window), text_layer_get_layer(s_glucose_layer));

    s_glucose_delta_layer = text_layer_create(
        GRect(3, 106, 71, 25));

    text_layer_set_background_color(s_glucose_delta_layer, GColorClear);
    text_layer_set_text_color(s_glucose_delta_layer, GColorBlack);
    text_layer_set_text_alignment(s_glucose_delta_layer, GTextAlignmentCenter);
    text_layer_set_font(s_glucose_delta_layer, s_extra_info_font);

    layer_add_child(window_get_root_layer(window), text_layer_get_layer(s_glucose_delta_layer));
    
    // Create date layer (day, month) - 15 pixels to the right of glucose layer
    s_date_layer = text_layer_create(
        GRect(78, 83, 60, 29));

    text_layer_set_background_color(s_date_layer, GColorClear);
    text_layer_set_text_color(s_date_layer, GColorBlack);
    text_layer_set_text_alignment(s_date_layer, GTextAlignmentCenter);
    text_layer_set_font(s_date_layer, s_main_font);
    text_layer_set_text(s_date_layer, "01 01");

    layer_add_child(window_get_root_layer(window), text_layer_get_layer(s_date_layer));
    
    // Create week layer below date layer - 15 pixels to the right of delta layer
    s_week_layer = text_layer_create(
        GRect(78, 106, 60, 25));

    text_layer_set_background_color(s_week_layer, GColorClear);
    text_layer_set_text_color(s_week_layer, GColorBlack);
    text_layer_set_text_alignment(s_week_layer, GTextAlignmentCenter);
    text_layer_set_font(s_week_layer, s_extra_info_font);
    text_layer_set_text(s_week_layer, "W01");

    layer_add_child(window_get_root_layer(window), text_layer_get_layer(s_week_layer));
    
    // Create astronomy layers for sun and moon times (bottom area)
    // Sun time layer (bottom left area) - displays sunrise or sunset based on time passed
    s_sun_time_layer = text_layer_create(
        GRect(0, 124, 71, 42));

    text_layer_set_background_color(s_sun_time_layer, GColorClear);
    text_layer_set_text_color(s_sun_time_layer, GColorBlack);
    text_layer_set_text_alignment(s_sun_time_layer, GTextAlignmentCenter);
    text_layer_set_font(s_sun_time_layer, s_extra_info_font);
    text_layer_set_text(s_sun_time_layer, "☀ N/A");

    layer_add_child(window_get_root_layer(window), text_layer_get_layer(s_sun_time_layer));

    // Moon time layer (bottom right area) - displays moonrise or moonset based on time passed
    s_moon_time_layer = text_layer_create(
        GRect(78, 124, 60, 42));

    text_layer_set_background_color(s_moon_time_layer, GColorClear);
    text_layer_set_text_color(s_moon_time_layer, GColorBlack);
    text_layer_set_text_alignment(s_moon_time_layer, GTextAlignmentCenter);
    text_layer_set_font(s_moon_time_layer, s_extra_info_font);
    text_layer_set_text(s_moon_time_layer, "🌙 N/A");

    layer_add_child(window_get_root_layer(window), text_layer_get_layer(s_moon_time_layer));
    
    // Create battery indicator layer
    s_battery_layer = layer_create(bounds);
    layer_set_update_proc(s_battery_layer, battery_draw_proc);
    layer_add_child(window_layer, s_battery_layer);

    // Create hourly indicator layer (small, 11px tall)
    s_hourly_layer = layer_create(GRect(2, 1, 7, 11));
    layer_set_update_proc(s_hourly_layer, hourly_indicator_draw_proc);
    layer_add_child(window_layer, s_hourly_layer);
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
    fonts_unload_custom_font(s_time_font);
    fonts_unload_custom_font(s_main_font);
    fonts_unload_custom_font(s_extra_info_font);
    bitmap_layer_destroy(s_background_layer);
    gbitmap_destroy(s_background_bitmap);
    layer_destroy(s_battery_layer);
    layer_destroy(s_hourly_layer);
}

static void inbox_received_callback(DictionaryIterator *iterator, void *context)
{
    Tuple *bgv_tuple = dict_find(iterator, MESSAGE_KEY_BG);

    // Handle hourly vibration setting independently of BG payload
    Tuple *hourly_vibe_tuple = dict_find(iterator, MESSAGE_KEY_HOURLY_VIBRATION);
    if (hourly_vibe_tuple)
    {
        bool new_hourly = hourly_vibe_tuple->value->int8 == 1;
        if (s_hourly_vibration != new_hourly) {
            s_hourly_vibration = new_hourly;
            if (s_hourly_layer) {
                layer_mark_dirty(s_hourly_layer);
            }
        }
    }

    if (bgv_tuple)
    {
        snprintf(bgv_buffer, sizeof(bgv_buffer), "%s", bgv_tuple->value->cstring);
        snprintf(bg_buffer, sizeof(bg_buffer), "%s", bgv_buffer);

        Tuple *showdelta_tuple = dict_find(iterator, MESSAGE_KEY_BG_SHOW_DELTA);

        if (showdelta_tuple)
        {
            s_show_bg_delta = showdelta_tuple->value->int8 == 1;
            
            if (s_show_bg_delta)
            {
                Tuple *bgdelta_tuple = dict_find(iterator, MESSAGE_KEY_BGDELTA);

                if (bgdelta_tuple)
                {
                    snprintf(bgdelta_raw_buffer, sizeof(bgdelta_raw_buffer), "%s", bgdelta_tuple->value->cstring);
                }
            }
        }

        text_layer_set_text(s_glucose_layer, bg_buffer);
        
        // Check if we should show time delta
        Tuple *show_timedelta_tuple = dict_find(iterator, MESSAGE_KEY_BG_SHOW_TIMEDELTA);
        if (show_timedelta_tuple)
        {
            s_show_time_delta = show_timedelta_tuple->value->int8 == 1;
        }
        
        
        
        // Also update the delta display immediately with timestamp info if available
        Tuple *timestamp_tuple = dict_find(iterator, MESSAGE_KEY_TIMESTAMP);
        if (timestamp_tuple)
        {
            s_last_reading_timestamp = timestamp_tuple->value->int32;
            // Next fetch: 5 minutes after reading + 5 seconds
            // 5 minutes = 300 seconds
            s_next_fetch_time = s_last_reading_timestamp + 300 + 5;
            
            // Immediately update the time display with the new reading
            time_t current_time = time(NULL);
            int minutes_since_reading = (current_time - s_last_reading_timestamp) / 60;

            snprintf(time_since_reading_buffer, sizeof(time_since_reading_buffer), "%dm", minutes_since_reading);
            
            if (s_show_bg_delta && s_show_time_delta) {
                snprintf(bgdelta_buffer, sizeof(bgdelta_buffer), "%s %s", bgdelta_raw_buffer, time_since_reading_buffer);
            } else if (s_show_bg_delta) {
                snprintf(bgdelta_buffer, sizeof(bgdelta_buffer), "%s", bgdelta_raw_buffer);
            } else if (s_show_time_delta) {
                snprintf(bgdelta_buffer, sizeof(bgdelta_buffer), "%s", time_since_reading_buffer);
            } else {
                bgdelta_buffer[0] = '\0';
            }

            text_layer_set_text(s_glucose_delta_layer, bgdelta_buffer);
            // Hide the layer if both settings are disabled
            layer_set_hidden(text_layer_get_layer(s_glucose_delta_layer), !s_show_bg_delta && !s_show_time_delta);
        }
        
        // Handle astronomy data - JavaScript determines which time (rise/set) to display
        Tuple *suntime_tuple = dict_find(iterator, MESSAGE_KEY_SUNTIME);
        if (suntime_tuple && suntime_tuple->value->cstring)
        {
            snprintf(sun_time_buffer, sizeof(sun_time_buffer), "☀ %s", suntime_tuple->value->cstring);
            text_layer_set_text(s_sun_time_layer, sun_time_buffer);
        }
        
        Tuple *moontime_tuple = dict_find(iterator, MESSAGE_KEY_MOONTIME);
        if (moontime_tuple && moontime_tuple->value->cstring)
        {
            snprintf(moon_time_buffer, sizeof(moon_time_buffer), "🌙 %s", moontime_tuple->value->cstring);
            text_layer_set_text(s_moon_time_layer, moon_time_buffer);
        }
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

static void init()
{
    // Create main Window element and assign to pointer
    s_main_window = window_create();

    // Set handlers to manage the elements inside the Window
    window_set_window_handlers(s_main_window, (WindowHandlers){
        .load = main_window_load,
        .unload = main_window_unload});

    // Show the Window on the watch, with animated=true
    window_stack_push(s_main_window, true);
    // Register with TickTimerService
    tick_timer_service_subscribe(MINUTE_UNIT, tick_handler);
    update_time();
    
    // Subscribe to battery state changes
    battery_state_service_subscribe(battery_state_handler);
    // Set initial battery level
    BatteryChargeState initial_state = battery_state_service_peek();
    battery_state_handler(initial_state);

    // Register callbacks
    app_message_register_inbox_received(inbox_received_callback);
    app_message_register_inbox_dropped(inbox_dropped_callback);
    app_message_register_outbox_failed(outbox_failed_callback);
    app_message_register_outbox_sent(outbox_sent_callback);

    // Open AppMessage (increased buffers to avoid dropped messages)
    const int inbox_size = 512;
    const int outbox_size = 512;
    app_message_open(inbox_size, outbox_size);
}

static void deinit()
{
    // Destroy Window
    window_destroy(s_main_window);
    // Unsubscribe from battery state service
    battery_state_service_unsubscribe();
}

int main(void)
{
    init();
    app_event_loop();
    deinit();
}