#include "rat_scout.h"

// ===== Overlay constants =====

// Total height of the overlay layer in pixels
#define OVERLAY_HEIGHT         51
// Width and height of the alert icon bitmap
#define OVERLAY_ICON_SIZE      24
// Width of the right-hand icon container (wider than icon to add padding)
#define OVERLAY_ICON_CONTAINER 30
// Thickness of the top and bottom border stripes in pixels
#define OVERLAY_BORDER          2

// ===== Shared settings (extern'd in rat_scout.h) =====

// Whether the overlay feature is enabled; controlled via Clay settings
bool s_overlay_enabled    = false;
// How long the overlay stays on screen before auto-dismissing (seconds)
int  s_overlay_duration_s = OVERLAY_DEFAULT_DURATION_S;

// ===== Private state =====

// The layer that renders the overlay banner
static Layer    *s_overlay_layer = NULL;
// Timer handle used for auto-dismiss; NULL when no overlay is visible
static AppTimer *s_overlay_timer = NULL;
// Alert icon bitmap for the currently displayed alert kind
static GBitmap  *s_overlay_image = NULL;
// Display text shown in the left area of the overlay
static char      s_overlay_text[48];
// Whether the overlay banner is currently being shown
static bool      s_overlay_visible = false;
// Font used for message text; loaded once in overlay_init, freed in overlay_deinit
static GFont     s_overlay_font = NULL;

// ===== Private helpers =====

/**
 * AppTimer callback that fires after the configured display duration.
 * Clears the timer handle and hides the overlay.
 * @param context - Unused
 */
static void overlay_timer_callback(void *context) {
    s_overlay_timer = NULL;
    overlay_hide();
}

/**
 * Layer update procedure that renders the overlay banner.
 * Drawing order (back to front):
 *   1. White fill covering the entire layer
 *   2. 1px alternating-dot checkerboard pattern filling the right icon container
 *   3. Alert icon bitmap (24x24) centered inside the icon container,
 *      drawn with GCompOpSet to honour PNG transparency
 *   4. Alert message text in the left area using FONT_HUMAROID_20, vertically centred
 *   5. 2px black stripes at the top and bottom edges (left/right edges are
 *      the physical screen frame and therefore need no border)
 *   6. 1px vertical black divider between the text area and the icon container
 * @param layer - The overlay layer being redrawn
 * @param ctx   - Graphics context provided by the system
 */
static void overlay_draw_proc(Layer *layer, GContext *ctx) {
    if (!s_overlay_visible) return;
    GRect bounds = layer_get_bounds(layer);
    int sw = bounds.size.w;
    int sh = bounds.size.h;

    // 1. White interior
    graphics_context_set_fill_color(ctx, GColorWhite);
    graphics_fill_rect(ctx, bounds, 0, GCornerNone);

    // 2. Checkerboard in right icon container (30px wide, full inner height)
    int container_x = sw - OVERLAY_ICON_CONTAINER;
    int container_inner_h = sh - 2 * OVERLAY_BORDER;
    // Fill white base first, then draw 1px black dots at even (x+y) positions
    graphics_context_set_fill_color(ctx, GColorWhite);
    graphics_fill_rect(ctx,
        GRect(container_x, OVERLAY_BORDER, OVERLAY_ICON_CONTAINER, container_inner_h),
        0, GCornerNone);
    graphics_context_set_stroke_color(ctx, GColorBlack);
    for (int py = 0; py < container_inner_h; py++) {
        for (int px = 0; px < OVERLAY_ICON_CONTAINER; px++) {
            if (((px + py) & 1) == 0) {
                graphics_draw_pixel(ctx, GPoint(container_x + px, OVERLAY_BORDER + py));
            }
        }
    }

    // 3. PNG icon centered in container (24x24 centered in 30px wide, inner height)
    int icon_offset_x = (OVERLAY_ICON_CONTAINER - OVERLAY_ICON_SIZE) / 2;
    int icon_offset_y = (container_inner_h - OVERLAY_ICON_SIZE) / 2;
    if (s_overlay_image) {
        GRect icon_rect = GRect(container_x + icon_offset_x, OVERLAY_BORDER + icon_offset_y,
                                OVERLAY_ICON_SIZE, OVERLAY_ICON_SIZE);
        graphics_context_set_compositing_mode(ctx, GCompOpSet);
        graphics_draw_bitmap_in_rect(ctx, s_overlay_image, icon_rect);
        graphics_context_set_compositing_mode(ctx, GCompOpAssign);
    }

    // 4. Message text in left area — vertically centred
    int text_area_w = container_x - 4;
    int text_area_h = sh - 2 * OVERLAY_BORDER;
    GSize text_size = graphics_text_layout_get_content_size(
        s_overlay_text, s_overlay_font,
        GRect(0, 0, text_area_w, text_area_h),
        GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter);
    // Centre the ink visually: FONT_HUMAROID_20 ascenders are taller than its descenders,
    // so the ink sits 1px low within the line-height box. Shift up by 1 to equalise margins.
    int text_y = OVERLAY_BORDER + (text_area_h - text_size.h) / 2 - 6;
    if (text_y < OVERLAY_BORDER) text_y = OVERLAY_BORDER;
    GRect text_rect = GRect(2, text_y, text_area_w, text_size.h);
    graphics_context_set_text_color(ctx, GColorBlack);
    graphics_draw_text(ctx, s_overlay_text, s_overlay_font, text_rect,
        GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);

    // 5. Top and bottom borders only — left/right borders are the screen frame.
    //    Extend 2px beyond each side so the rectangles are flush with the screen edge.
    graphics_context_set_fill_color(ctx, GColorBlack);
    graphics_fill_rect(ctx, GRect(-OVERLAY_BORDER, 0,      sw + 2*OVERLAY_BORDER, OVERLAY_BORDER), 0, GCornerNone);
    graphics_fill_rect(ctx, GRect(-OVERLAY_BORDER, sh - OVERLAY_BORDER, sw + 2*OVERLAY_BORDER, OVERLAY_BORDER), 0, GCornerNone);

    // 6. 1px vertical divider between message area and icon container
    graphics_fill_rect(ctx, GRect(container_x - 1, OVERLAY_BORDER, 1, sh - 2*OVERLAY_BORDER), 0, GCornerNone);
}

// ===== Public API =====

/**
 * Create and attach the overlay layer to the given parent layer.
 * The overlay is positioned at the bottom of the parent's bounds and
 * starts hidden. Must be called last during window load so the overlay
 * renders on top of all other layers in the z-order.
 * @param parent_layer - Root window layer to attach the overlay to
 */
void overlay_init(Layer *parent_layer) {
    s_overlay_font = fonts_load_custom_font(resource_get_handle(RESOURCE_ID_FONT_HUMAROID_20));
    GRect pb = layer_get_bounds(parent_layer);
    GRect overlay_rect = GRect(0, pb.size.h - OVERLAY_HEIGHT, pb.size.w, OVERLAY_HEIGHT);
    s_overlay_layer = layer_create(overlay_rect);
    layer_set_update_proc(s_overlay_layer, overlay_draw_proc);
    layer_add_child(parent_layer, s_overlay_layer);
}

/**
 * Cancel any pending auto-dismiss timer, free the icon bitmap, and
 * destroy the overlay layer. Safe to call even if overlay_init was
 * never called. Must be invoked during window unload before the parent
 * layer is destroyed.
 */
void overlay_deinit(void) {
    if (s_overlay_timer) {
        app_timer_cancel(s_overlay_timer);
        s_overlay_timer = NULL;
    }
    if (s_overlay_image) {
        gbitmap_destroy(s_overlay_image);
        s_overlay_image = NULL;
    }
    if (s_overlay_layer) {
        layer_destroy(s_overlay_layer);
        s_overlay_layer = NULL;
    }
    if (s_overlay_font) {
        fonts_unload_custom_font(s_overlay_font);
        s_overlay_font = NULL;
    }
}

/**
 * Display the overlay banner with the given alert kind and message text.
 * If the overlay is already visible, the previous alert is replaced
 * immediately (timer restarted, icon swapped, text updated).
 * The overlay auto-dismisses after s_overlay_duration_s seconds.
 * No-op if overlay_init has not been called.
 * @param kind - Alert category that determines which icon is shown
 *               (ALERT_KIND_BG_HIGH / BG_LOW -> danger icon,
 *                ALERT_KIND_HOURLY -> clock icon)
 * @param msg  - Null-terminated string shown in the left text area;
 *               truncated to 47 characters. Pass NULL for empty text.
 */
void overlay_show(AlertKind kind, const char *msg) {
    if (!s_overlay_layer) return;

    // Cancel any existing auto-dismiss timer
    if (s_overlay_timer) {
        app_timer_cancel(s_overlay_timer);
        s_overlay_timer = NULL;
    }

    // Swap PNG icon for the new kind
    if (s_overlay_image) {
        gbitmap_destroy(s_overlay_image);
        s_overlay_image = NULL;
    }
    uint32_t res_id = 0;
    switch (kind) {
        case ALERT_KIND_BG_HIGH:
        case ALERT_KIND_BG_LOW:
            res_id = RESOURCE_ID_ALERT_DANGER;
            break;
        case ALERT_KIND_HOURLY:
            res_id = RESOURCE_ID_ALERT_CLOCK;
            break;
        default:
            break;
    }
    if (res_id) {
        s_overlay_image = gbitmap_create_with_resource(res_id);
    }

    // Set display text
    snprintf(s_overlay_text, sizeof(s_overlay_text), "%s", msg ? msg : "");

    // Show and schedule auto-dismiss
    s_overlay_visible = true;
    layer_mark_dirty(s_overlay_layer);

    uint32_t duration_ms = (uint32_t)(s_overlay_duration_s) * 1000;
    s_overlay_timer = app_timer_register(duration_ms, overlay_timer_callback, NULL);
}

/**
 * Hide the overlay banner immediately, cancelling the auto-dismiss timer
 * and freeing the icon bitmap. No-op if the overlay is not initialised.
 */
void overlay_hide(void) {
    if (!s_overlay_layer) return;
    s_overlay_visible = false;
    if (s_overlay_image) {
        gbitmap_destroy(s_overlay_image);
        s_overlay_image = NULL;
    }
    layer_mark_dirty(s_overlay_layer);
}
