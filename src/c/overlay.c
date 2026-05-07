#include "rat_scout.h"

// ===== Overlay constants =====
#define OVERLAY_HEIGHT        51
#define OVERLAY_ICON_SIZE     24
#define OVERLAY_ICON_CONTAINER 30
#define OVERLAY_BORDER         2

// ===== Shared settings (extern'd in rat_scout.h) =====
bool s_overlay_enabled   = false;
int  s_overlay_duration_s = OVERLAY_DEFAULT_DURATION_S;

// ===== Private state =====
static Layer               *s_overlay_layer = NULL;
static AppTimer            *s_overlay_timer  = NULL;
static GBitmap             *s_overlay_image  = NULL;
static char                 s_overlay_text[48];

// ===== Private helpers =====

static void overlay_timer_callback(void *context) {
    s_overlay_timer = NULL;
    overlay_hide();
}

static void overlay_draw_proc(Layer *layer, GContext *ctx) {
    GRect bounds = layer_get_bounds(layer);
    int sw = bounds.size.w;
    int sh = bounds.size.h;

    // 1. White interior
    graphics_context_set_fill_color(ctx, GColorWhite);
    graphics_fill_rect(ctx, bounds, 0, GCornerNone);

    // 2. Checkerboard in right icon container (30px wide, full inner height)
    int container_x = sw - OVERLAY_BORDER - OVERLAY_ICON_CONTAINER;
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
        graphics_draw_bitmap_in_rect(ctx, s_overlay_image, icon_rect);
    }

    // 4. Message text in left area
    GRect text_rect = GRect(
        OVERLAY_BORDER + 2,
        OVERLAY_BORDER + 2,
        container_x - OVERLAY_BORDER - 4,
        sh - (OVERLAY_BORDER + 2) * 2
    );
    graphics_context_set_text_color(ctx, GColorBlack);
    graphics_draw_text(ctx, s_overlay_text,
        fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
        text_rect,
        GTextOverflowModeWordWrap,
        GTextAlignmentLeft,
        NULL);

    // 5. 2-px black border drawn last (covers stray pixels at edges)
    graphics_context_set_fill_color(ctx, GColorBlack);
    graphics_fill_rect(ctx, GRect(0,      0,      sw, OVERLAY_BORDER),        0, GCornerNone);
    graphics_fill_rect(ctx, GRect(0,      sh - OVERLAY_BORDER, sw, OVERLAY_BORDER), 0, GCornerNone);
    graphics_fill_rect(ctx, GRect(0,      OVERLAY_BORDER, OVERLAY_BORDER, sh - 2*OVERLAY_BORDER), 0, GCornerNone);
    graphics_fill_rect(ctx, GRect(sw - OVERLAY_BORDER, OVERLAY_BORDER, OVERLAY_BORDER, sh - 2*OVERLAY_BORDER), 0, GCornerNone);
}

// ===== Public API =====

void overlay_init(Layer *parent_layer) {
    GRect pb = layer_get_bounds(parent_layer);
    GRect overlay_rect = GRect(0, pb.size.h - OVERLAY_HEIGHT, pb.size.w, OVERLAY_HEIGHT);
    s_overlay_layer = layer_create(overlay_rect);
    layer_set_update_proc(s_overlay_layer, overlay_draw_proc);
    layer_set_hidden(s_overlay_layer, true);
    layer_add_child(parent_layer, s_overlay_layer);
}

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
}

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
    layer_set_hidden(s_overlay_layer, false);
    layer_mark_dirty(s_overlay_layer);

    uint32_t duration_ms = (uint32_t)(s_overlay_duration_s) * 1000;
    s_overlay_timer = app_timer_register(duration_ms, overlay_timer_callback, NULL);
}

void overlay_hide(void) {
    if (!s_overlay_layer) return;
    layer_set_hidden(s_overlay_layer, true);
    if (s_overlay_image) {
        gbitmap_destroy(s_overlay_image);
        s_overlay_image = NULL;
    }
}
