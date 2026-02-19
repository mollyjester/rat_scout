#include "rat_scout.h"

// ===== Private State =====
static uint8_t s_battery_level = 100;
static bool s_is_charging = false;

// ===== Charging Symbol Helpers =====

/**
 * Draw a single pixel with color inverted against the charge fill.
 * Pixels over the filled (black) area are drawn white;
 * pixels over the unfilled (white) area are drawn black.
 */
static void draw_charging_pixel(GContext *ctx, int x, int y, int boundary_x) {
    graphics_context_set_stroke_color(ctx, x < boundary_x ? GColorWhite : GColorBlack);
    graphics_draw_pixel(ctx, GPoint(x, y));
}

/**
 * Draw a horizontal line split at the charge boundary with inverted colors.
 */
static void draw_charging_hline(GContext *ctx, int x1, int x2, int y, int boundary_x) {
    int min_x = x1 < x2 ? x1 : x2;
    int max_x = x1 > x2 ? x1 : x2;

    if (max_x < boundary_x) {
        // Entirely in charged (black) area -> draw white
        graphics_context_set_stroke_color(ctx, GColorWhite);
        graphics_draw_line(ctx, GPoint(min_x, y), GPoint(max_x, y));
    } else if (min_x >= boundary_x) {
        // Entirely in uncharged (white) area -> draw black
        graphics_context_set_stroke_color(ctx, GColorBlack);
        graphics_draw_line(ctx, GPoint(min_x, y), GPoint(max_x, y));
    } else {
        // Crosses boundary - split into two segments
        graphics_context_set_stroke_color(ctx, GColorWhite);
        graphics_draw_line(ctx, GPoint(min_x, y), GPoint(boundary_x - 1, y));
        graphics_context_set_stroke_color(ctx, GColorBlack);
        graphics_draw_line(ctx, GPoint(boundary_x, y), GPoint(max_x, y));
    }
}

/**
 * Draw a vertical line with color inverted against the charge fill.
 */
static void draw_charging_vline(GContext *ctx, int x, int y1, int y2, int boundary_x) {
    graphics_context_set_stroke_color(ctx, x < boundary_x ? GColorWhite : GColorBlack);
    graphics_draw_line(ctx, GPoint(x, y1), GPoint(x, y2));
}

// ===== Drawing Callbacks =====

/**
 * Render battery indicator (layer is sized to fit exactly).
 * When charging, the charge level fill is shown and the charging symbols
 * (arrow + plus) are drawn with colors inverted at the fill boundary.
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
    
    // Calculate and draw battery charge level (used for both states)
    int usable_width = BATTERY_WIDTH - 3 - 2;
    int filled_width = (s_battery_level * usable_width) / 100;
    graphics_context_set_fill_color(ctx, GColorBlack);
    graphics_fill_rect(ctx, GRect(x_start + 1, y_start + 1, filled_width, BATTERY_SEGMENT_HEIGHT),
                      0, GCornerNone);

    if (s_is_charging) {
        // Charge boundary: x where filled (black) meets unfilled (white)
        int boundary_x = x_start + 1 + filled_width;
        int ch_x = x_start + 4;
        int ch_y = y_start + 2;

        graphics_context_set_stroke_width(ctx, 1);

        // Arrow head - top diagonal pixels: (ch_x, ch_y+2) to (ch_x+2, ch_y)
        draw_charging_pixel(ctx, ch_x,     ch_y + 2, boundary_x);
        draw_charging_pixel(ctx, ch_x + 1, ch_y + 1, boundary_x);
        draw_charging_pixel(ctx, ch_x + 2, ch_y,     boundary_x);

        // Arrow head - right side vertical: (ch_x+2, ch_y) to (ch_x+2, ch_y+4)
        draw_charging_vline(ctx, ch_x + 2, ch_y, ch_y + 4, boundary_x);

        // Arrow head - bottom diagonal pixels: (ch_x+2, ch_y+4) to (ch_x, ch_y+2)
        draw_charging_pixel(ctx, ch_x + 2, ch_y + 4, boundary_x);
        draw_charging_pixel(ctx, ch_x + 1, ch_y + 3, boundary_x);

        // Arrow shaft: horizontal from (ch_x, ch_y+2) to (ch_x+9, ch_y+2)
        draw_charging_hline(ctx, ch_x, ch_x + 9, ch_y + 2, boundary_x);

        // Plus sign horizontal: (ch_x+12, ch_y+2) to (ch_x+14, ch_y+2)
        draw_charging_hline(ctx, ch_x + 12, ch_x + 14, ch_y + 2, boundary_x);

        // Plus sign vertical: (ch_x+13, ch_y+1) to (ch_x+13, ch_y+3)
        draw_charging_vline(ctx, ch_x + 13, ch_y + 1, ch_y + 3, boundary_x);
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
