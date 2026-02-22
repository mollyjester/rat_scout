#include "rat_scout.h"

// ===== Private Helpers =====

/**
 * Process vibration and threshold settings from incoming message
 */
static void handle_settings(DictionaryIterator *iterator) {
    Tuple *hourly_vibe_tuple = dict_find(iterator, MESSAGE_KEY_HOURLY_VIBRATION);
    if (hourly_vibe_tuple) {
        bool new_hourly = hourly_vibe_tuple->value->int8 == 1;
        if (s_hourly_vibration != new_hourly) {
            s_hourly_vibration = new_hourly;
            persist_write_bool(PERSIST_KEY_HOURLY_VIBRATION, new_hourly);
            if (s_status_bar_layer) {
                layer_mark_dirty(s_status_bar_layer);
            }
        }
    }

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

    Tuple *date_format_tuple = dict_find(iterator, MESSAGE_KEY_DATE_FORMAT);
    if (date_format_tuple && date_format_tuple->length > 0) {
        bool new_mmdd = strcmp(date_format_tuple->value->cstring, "mm.dd") == 0;
        if (s_date_format_mmdd != new_mmdd) {
            s_date_format_mmdd = new_mmdd;
            update_time(NULL, true);
        }
    }

    // Garbage collection: receive pre-computed bag type from JS
    Tuple *garbage_bag_tuple = dict_find(iterator, MESSAGE_KEY_GARBAGE_BAG);
    if (garbage_bag_tuple) {
        update_garbage_bag(garbage_bag_tuple->value->int32);
    }
}

/**
 * Process glucose reading and associated data (delta, timestamp, astronomy)
 */
static void handle_glucose_message(DictionaryIterator *iterator) {
    Tuple *bgv_tuple = dict_find(iterator, MESSAGE_KEY_BG);
    if (!bgv_tuple) return;

    // Update glucose display
    snprintf(s_bg_buffer, sizeof(s_bg_buffer), "%s", bgv_tuple->value->cstring);
    text_layer_set_text(s_glucose_layer, s_bg_buffer);
    persist_write_string_if_changed(PERSIST_KEY_BG, s_bg_buffer, sizeof(s_bg_buffer));
    check_bg_threshold_vibration(s_bg_buffer);
    
    // Update glucose delta display
    Tuple *showdelta_tuple = dict_find(iterator, MESSAGE_KEY_BG_SHOW_DELTA);
    if (showdelta_tuple) {
        s_show_bg_delta = showdelta_tuple->value->int8 == 1;
        if (s_show_bg_delta) {
            Tuple *bgdelta_tuple = dict_find(iterator, MESSAGE_KEY_BGDELTA);
            if (bgdelta_tuple) {
                snprintf(s_delta_raw_buffer, sizeof(s_delta_raw_buffer), "%s", bgdelta_tuple->value->cstring);
                persist_write_string_if_changed(PERSIST_KEY_BG_DELTA, s_delta_raw_buffer, sizeof(s_delta_raw_buffer));
            }
        }
    }

    // Update time delta display
    Tuple *show_timedelta_tuple = dict_find(iterator, MESSAGE_KEY_BG_SHOW_TIMEDELTA);
    if (show_timedelta_tuple) {
        s_show_time_delta = show_timedelta_tuple->value->int8 == 1;
    }
    
    // Schedule next data fetch based on reading timestamp
    Tuple *timestamp_tuple = dict_find(iterator, MESSAGE_KEY_TIMESTAMP);
    if (timestamp_tuple) {
        s_last_reading_timestamp = timestamp_tuple->value->int32;
        persist_write_int(PERSIST_KEY_TIMESTAMP, s_last_reading_timestamp);
        if (s_last_reading_timestamp > 0) {
            s_next_fetch_time = s_last_reading_timestamp + FETCH_INTERVAL_SECONDS + FETCH_INTERVAL_JITTER;
        } else {
            // No valid timestamp — fall back to periodic fetch pattern
            s_next_fetch_time = 0;
        }
        update_delta_display();
    }
}

/**
 * Process astronomy data (arrives as separate message from glucose)
 */
static void handle_astronomy_message(DictionaryIterator *iterator) {
    Tuple *suntime_tuple = dict_find(iterator, MESSAGE_KEY_SUNTIME);
    if (suntime_tuple && suntime_tuple->length > 0) {
        snprintf(s_sun_time_buffer, sizeof(s_sun_time_buffer), "%s", suntime_tuple->value->cstring);
        text_layer_set_text(s_sun_time_layer, s_sun_time_buffer);
        persist_write_string_if_changed(PERSIST_KEY_SUN_TIME, s_sun_time_buffer, sizeof(s_sun_time_buffer));
    }
    
    Tuple *moontime_tuple = dict_find(iterator, MESSAGE_KEY_MOONTIME);
    if (moontime_tuple && moontime_tuple->length > 0) {
        snprintf(s_moon_time_buffer, sizeof(s_moon_time_buffer), "%s", moontime_tuple->value->cstring);
        text_layer_set_text(s_moon_time_layer, s_moon_time_buffer);
        persist_write_string_if_changed(PERSIST_KEY_MOON_TIME, s_moon_time_buffer, sizeof(s_moon_time_buffer));
    }
    
    Tuple *moon_phase_tuple = dict_find(iterator, MESSAGE_KEY_MOON_PHASE);
    if (moon_phase_tuple) {
        update_moon_icon(moon_phase_tuple->value->int32);
    }
    
    // Update sun/moon rising/setting indicators
    Tuple *sun_rising_tuple = dict_find(iterator, MESSAGE_KEY_SUN_IS_RISING);
    if (sun_rising_tuple) {
        bool rising = sun_rising_tuple->value->int8 == 1;
        if (s_sun_is_rising != rising) {
            s_sun_is_rising = rising;
            persist_write_bool(PERSIST_KEY_SUN_IS_RISING, rising);
            if (s_sun_corner_layer) {
                layer_mark_dirty(s_sun_corner_layer);
            }
        }
    }
    
    Tuple *moon_rising_tuple = dict_find(iterator, MESSAGE_KEY_MOON_IS_RISING);
    if (moon_rising_tuple) {
        bool rising = moon_rising_tuple->value->int8 == 1;
        if (s_moon_is_rising != rising) {
            s_moon_is_rising = rising;
            persist_write_bool(PERSIST_KEY_MOON_IS_RISING, rising);
            if (s_moon_corner_layer) {
                layer_mark_dirty(s_moon_corner_layer);
            }
        }
    }
}

/**
 * Process weather data (arrives as separate message from glucose)
 */
static void handle_weather_message(DictionaryIterator *iterator) {
    Tuple *weather_temp_tuple = dict_find(iterator, MESSAGE_KEY_WEATHER_TEMP);
    if (!weather_temp_tuple || weather_temp_tuple->length == 0) return;

    // Update umbrella status indicator
    Tuple *weather_umbrella_tuple = dict_find(iterator, MESSAGE_KEY_WEATHER_UMBRELLA);
    bool umbrella = weather_umbrella_tuple && weather_umbrella_tuple->value->int8 == 1;
    if (s_umbrella_active != umbrella) {
        s_umbrella_active = umbrella;
        persist_write_bool(PERSIST_KEY_UMBRELLA_ACTIVE, umbrella);
        if (s_status_bar_layer) {
            layer_mark_dirty(s_status_bar_layer);
        }
    }
    
    // Update temperature display
    snprintf(s_weather_temp_buffer, sizeof(s_weather_temp_buffer), "%s", weather_temp_tuple->value->cstring);
    text_layer_set_text(s_weather_temp_layer, s_weather_temp_buffer);
    persist_write_string_if_changed(PERSIST_KEY_WEATHER_TEMP, s_weather_temp_buffer, sizeof(s_weather_temp_buffer));
    
    // Update wind speed display
    Tuple *weather_wind_tuple = dict_find(iterator, MESSAGE_KEY_WEATHER_WIND);
    if (weather_wind_tuple && weather_wind_tuple->length > 0) {
        snprintf(s_weather_wind_buffer, sizeof(s_weather_wind_buffer), "%s", weather_wind_tuple->value->cstring);
        text_layer_set_text(s_weather_wind_layer, s_weather_wind_buffer);
        persist_write_string_if_changed(PERSIST_KEY_WEATHER_WIND, s_weather_wind_buffer, sizeof(s_weather_wind_buffer));
    }
}

// ===== AppMessage Callbacks =====

void inbox_received_callback(DictionaryIterator *iterator, void *context) {
    Tuple *type_tuple = dict_find(iterator, MESSAGE_KEY_MSG_TYPE);
    if (!type_tuple) return;
    switch (type_tuple->value->int8) {
        case MSG_TYPE_SETTINGS:  handle_settings(iterator);         break;
        case MSG_TYPE_GLUCOSE:   handle_glucose_message(iterator);  break;
        case MSG_TYPE_WEATHER:   handle_weather_message(iterator);  break;
        case MSG_TYPE_ASTRONOMY: handle_astronomy_message(iterator); break;
        default:
            APP_LOG(APP_LOG_LEVEL_WARNING, "Unknown message type: %d",
                    (int)type_tuple->value->int8);
            break;
    }
}

void inbox_dropped_callback(AppMessageResult reason, void *context)
{
    APP_LOG(APP_LOG_LEVEL_ERROR, "Message dropped! reason=%d", (int)reason);
}

void outbox_failed_callback(DictionaryIterator *iterator, AppMessageResult reason, void *context)
{
    APP_LOG(APP_LOG_LEVEL_ERROR, "Outbox send failed!");
}

void outbox_sent_callback(DictionaryIterator *iterator, void *context)
{
    APP_LOG(APP_LOG_LEVEL_INFO, "Outbox send success!");
}
