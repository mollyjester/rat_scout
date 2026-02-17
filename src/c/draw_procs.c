#include "rat_scout.h"

// ===== Private State =====
static uint8_t s_battery_level = 100;
static bool s_is_charging = false;

// ===== Drawing Callbacks =====

/**
 * Render battery indicator (layer is sized to fit exactly)
 */
void battery_draw_proc(Layer *layer, GContext *ctx) {
    int x_start = 0;
    int y_start = 0;
    
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
 * Render status bar active indicator bars (underscore beneath active icons).
 * Uses cached garbage bag type — no time() calls during rendering.
 */
void status_bar_draw_proc(Layer *layer, GContext *ctx) {
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
    switch (s_cached_garbage_bag) {
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
 * Draw a 3-pixel corner indicator for rising/setting state.
 * Rising: top-right corner (two pixels along top-right, one below)
 * Setting: bottom-right corner (two pixels along bottom-right, one above)
 */
void sun_corner_draw_proc(Layer *layer, GContext *ctx) {
    GRect bounds = layer_get_bounds(layer);
    int right = bounds.size.w - 1;
    graphics_context_set_fill_color(ctx, GColorBlack);
    if (s_sun_is_rising) {
        graphics_fill_rect(ctx, GRect(right, 0, 1, 1), 0, GCornerNone);
        graphics_fill_rect(ctx, GRect(right - 1, 0, 1, 1), 0, GCornerNone);
        graphics_fill_rect(ctx, GRect(right, 1, 1, 1), 0, GCornerNone);
    } else {
        int bottom = bounds.size.h - 1;
        graphics_fill_rect(ctx, GRect(right, bottom, 1, 1), 0, GCornerNone);
        graphics_fill_rect(ctx, GRect(right - 1, bottom, 1, 1), 0, GCornerNone);
        graphics_fill_rect(ctx, GRect(right, bottom - 1, 1, 1), 0, GCornerNone);
    }
}

void moon_corner_draw_proc(Layer *layer, GContext *ctx) {
    GRect bounds = layer_get_bounds(layer);
    int right = bounds.size.w - 1;
    graphics_context_set_fill_color(ctx, GColorBlack);
    if (s_moon_is_rising) {
        graphics_fill_rect(ctx, GRect(right, 0, 1, 1), 0, GCornerNone);
        graphics_fill_rect(ctx, GRect(right - 1, 0, 1, 1), 0, GCornerNone);
        graphics_fill_rect(ctx, GRect(right, 1, 1, 1), 0, GCornerNone);
    } else {
        int bottom = bounds.size.h - 1;
        graphics_fill_rect(ctx, GRect(right, bottom, 1, 1), 0, GCornerNone);
        graphics_fill_rect(ctx, GRect(right - 1, bottom, 1, 1), 0, GCornerNone);
        graphics_fill_rect(ctx, GRect(right, bottom - 1, 1, 1), 0, GCornerNone);
    }
}

/**
 * Handle battery state changes
 */
void battery_state_handler(BatteryChargeState charge_state) {
    s_battery_level = charge_state.charge_percent;
    s_is_charging = charge_state.is_charging;
    layer_mark_dirty(s_battery_layer);
}
