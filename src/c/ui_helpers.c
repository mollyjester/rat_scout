#include "rat_scout.h"

/**
 * Create and configure a text layer with common settings
 */
TextLayer *create_text_layer(GRect bounds, GFont font, GTextAlignment alignment) {
    TextLayer *layer = text_layer_create(bounds);
    text_layer_set_background_color(layer, GColorClear);
    text_layer_set_text_color(layer, GColorBlack);
    text_layer_set_text_alignment(layer, alignment);
    text_layer_set_font(layer, font);
    return layer;
}

/**
 * Create and configure a bitmap icon layer with transparent compositing
 * @param parent - Parent layer to add the icon to
 * @param resource_id - Resource identifier for the bitmap
 * @param bitmap_out - Pointer to store the created GBitmap (for later cleanup)
 * @param bounds - Position and size of the icon layer
 * @return The created BitmapLayer
 */
BitmapLayer *create_icon_layer(Layer *parent, uint32_t resource_id,
                               GBitmap **bitmap_out, GRect bounds) {
    *bitmap_out = gbitmap_create_with_resource(resource_id);
    BitmapLayer *layer = bitmap_layer_create(bounds);
    bitmap_layer_set_bitmap(layer, *bitmap_out);
    bitmap_layer_set_compositing_mode(layer, GCompOpSet);
    layer_add_child(parent, bitmap_layer_get_layer(layer));
    return layer;
}

/**
 * Destroy a bitmap icon layer and its associated bitmap
 */
void destroy_icon_layer(BitmapLayer *layer, GBitmap *bitmap) {
    if (layer) bitmap_layer_destroy(layer);
    if (bitmap) gbitmap_destroy(bitmap);
}

/**
 * Write a string to persistent storage only if the value has changed.
 * Avoids unnecessary flash I/O which wears the storage and costs battery.
 * @param key - Persist key
 * @param value - New string value
 * @param buf_size - Size of the comparison buffer
 */
void persist_write_string_if_changed(uint32_t key, const char *value, size_t buf_size) {
    char existing[32];
    size_t check_size = buf_size < sizeof(existing) ? buf_size : sizeof(existing);
    if (persist_exists(key)) {
        persist_read_string(key, existing, check_size);
        if (strncmp(existing, value, check_size) == 0) return;
    }
    persist_write_string(key, value);
}
