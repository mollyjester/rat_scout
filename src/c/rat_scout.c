#include <pebble.h>

static Window *s_main_window;
static GFont s_time_font;
static GFont s_glucose_font;
static TextLayer *s_time_layer;
static TextLayer *s_glucose_layer;

static BitmapLayer *s_background_layer;
static GBitmap *s_background_bitmap;

/* Increase buffers a bit to accommodate floating-point formatted strings */
static char bgv_buffer[16];
static char bgdelta_buffer[12];
static char bg_buffer[32];

/* Store the last reading timestamp and next fetch time */
static time_t s_last_reading_timestamp = 0;
static time_t s_next_fetch_time = 0;

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
}

static void tick_handler(struct tm *tick_time, TimeUnits units_changed)
{
    update_time();

    time_t current_time = time(NULL);
    
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
    //bitmap_layer_set_bitmap(s_background_layer, s_background_bitmap);
    //layer_add_child(window_layer, bitmap_layer_get_layer(s_background_layer));

    // Create GFont
    s_time_font = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_FONT_HUMAROID_64));
    s_glucose_font = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_FONT_HUMAROID_20));

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
        GRect(0, PBL_IF_ROUND_ELSE(125, 120), bounds.size.w, 25));

    text_layer_set_background_color(s_glucose_layer, GColorClear);
    text_layer_set_text_color(s_glucose_layer, GColorBlack);
    text_layer_set_text_alignment(s_glucose_layer, GTextAlignmentCenter);
    text_layer_set_font(s_glucose_layer, s_glucose_font);
    text_layer_set_text(s_glucose_layer, "Loading...");

    layer_add_child(window_get_root_layer(window), text_layer_get_layer(s_glucose_layer));
}

static void main_window_unload(Window *window)
{
    text_layer_destroy(s_time_layer);
    text_layer_destroy(s_glucose_layer);
    fonts_unload_custom_font(s_time_font);
    fonts_unload_custom_font(s_glucose_font);
    bitmap_layer_destroy(s_background_layer);
    gbitmap_destroy(s_background_bitmap);
}

static void inbox_received_callback(DictionaryIterator *iterator, void *context)
{
    Tuple *bgv_tuple = dict_find(iterator, MESSAGE_KEY_BG);

    if (bgv_tuple)
    {
        snprintf(bgv_buffer, sizeof(bgv_buffer), "%s", bgv_tuple->value->cstring);

        Tuple *showdelta_tuple = dict_find(iterator, MESSAGE_KEY_BG_SHOW_DELTA);

        if (showdelta_tuple && 
            showdelta_tuple->value->int8 == 1)
        {
            Tuple *bgdelta_tuple = dict_find(iterator, MESSAGE_KEY_BGDELTA);

            if (bgdelta_tuple)
            {
                snprintf(bgdelta_buffer, sizeof(bgdelta_buffer), "%s", bgdelta_tuple->value->cstring);
                snprintf(bg_buffer, sizeof(bg_buffer), "%s %s", bgv_buffer, bgdelta_buffer);
            }
        }
        else
        {
            snprintf(bg_buffer, sizeof(bg_buffer), "%s", bgv_buffer);
        }

        text_layer_set_text(s_glucose_layer, bg_buffer);
        
        // Extract timestamp if available and calculate next fetch time
        Tuple *timestamp_tuple = dict_find(iterator, MESSAGE_KEY_TIMESTAMP);
        if (timestamp_tuple)
        {
            s_last_reading_timestamp = timestamp_tuple->value->int32;
            // Next fetch: 5 minutes after reading + 5 seconds
            // 5 minutes = 300 seconds
            s_next_fetch_time = s_last_reading_timestamp + 300 + 5;
            
            APP_LOG(APP_LOG_LEVEL_INFO, "Reading timestamp: %lu, Next fetch time: %lu", 
                    (unsigned long)s_last_reading_timestamp, (unsigned long)s_next_fetch_time);
        }
    }
}

static void inbox_dropped_callback(AppMessageResult reason, void *context)
{
    APP_LOG(APP_LOG_LEVEL_ERROR, "Message dropped!");
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

    // Register callbacks
    app_message_register_inbox_received(inbox_received_callback);
    app_message_register_inbox_dropped(inbox_dropped_callback);
    app_message_register_outbox_failed(outbox_failed_callback);
    app_message_register_outbox_sent(outbox_sent_callback);

    // Open AppMessage
    const int inbox_size = 128;
    const int outbox_size = 128;
    app_message_open(inbox_size, outbox_size);
}

static void deinit()
{
    // Destroy Window
    window_destroy(s_main_window);
}

int main(void)
{
    init();
    app_event_loop();
    deinit();
}