#include "rat_scout.h"

// ===== Private State =====

// BG threshold vibration patterns
// High threshold: short vibration, pause, long vibration
static const uint32_t BG_HIGH_VIBE_PATTERN[] = {100, 200, 400};
// Low threshold: long vibration, pause, short vibration
static const uint32_t BG_LOW_VIBE_PATTERN[] = {400, 200, 100};

// BG zone tracking for one-shot vibration alerts
typedef enum {
    BG_ZONE_NORMAL = 0,
    BG_ZONE_HIGH,
    BG_ZONE_LOW
} BgZone;
static BgZone s_bg_zone = BG_ZONE_NORMAL;

// Time delta buffer (only used within update_delta_display)
static char s_time_delta_buffer[BUFFER_TIME_DELTA];

// ===== Functions =====

/**
 * Update delta display based on current settings.
 * Skips text layer update if the formatted string hasn't changed.
 */
void update_delta_display(void) {
    if (s_last_reading_timestamp <= 0) return;
    
    time_t current_time = time(NULL);
    int minutes_since_reading = (current_time - s_last_reading_timestamp) / 60;
    snprintf(s_time_delta_buffer, sizeof(s_time_delta_buffer), "%dm", minutes_since_reading);
    
    // Build new delta string into a temp buffer and compare before updating
    char new_delta[BUFFER_DELTA];
    if (s_show_bg_delta && s_show_time_delta) {
        snprintf(new_delta, sizeof(new_delta), "%s %s", s_delta_raw_buffer, s_time_delta_buffer);
    } else if (s_show_bg_delta) {
        snprintf(new_delta, sizeof(new_delta), "%s", s_delta_raw_buffer);
    } else if (s_show_time_delta) {
        snprintf(new_delta, sizeof(new_delta), "%s", s_time_delta_buffer);
    } else {
        new_delta[0] = '\0';
    }
    
    bool hidden = !s_show_bg_delta && !s_show_time_delta;
    layer_set_hidden(text_layer_get_layer(s_glucose_delta_layer), hidden);
    
    // Only update text layer if the string actually changed
    if (strncmp(s_delta_buffer, new_delta, sizeof(s_delta_buffer)) != 0) {
        strncpy(s_delta_buffer, new_delta, sizeof(s_delta_buffer));
        s_delta_buffer[sizeof(s_delta_buffer) - 1] = '\0';
        text_layer_set_text(s_glucose_delta_layer, s_delta_buffer);
    }
}

/**
 * Check glucose value against thresholds and vibrate if needed.
 * High threshold: short then long vibration.
 * Low threshold: long then short vibration.
 * Values are compared in x10 scale to handle mmol/L decimals.
 * @param bg_str - The formatted glucose value string (e.g. "120" or "6.7")
 */
void check_bg_threshold_vibration(const char *bg_str) {
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
