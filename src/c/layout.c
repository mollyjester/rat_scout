#include "rat_scout.h"

// ===== Platform-Specific Layout Constants =====
// Emery has a 200x228 screen; other rectangular platforms use 144x168.
// All icons remain 12x12; positions are scaled proportionally for Emery.
#if defined(PBL_PLATFORM_EMERY)
const GRect RECT_TIME_LAYER = {{1, 12}, {200, 68}};
const GRect RECT_GLUCOSE_LAYER = {{1, 78}, {92, 34}};
const GRect RECT_DELTA_LAYER = {{106, 91}, {92, 25}};
const GRect RECT_DATE_LAYER = {{0, 117}, {92, 29}};
const GRect RECT_WEEK_LAYER = {{106, 125}, {92, 25}};
const GRect RECT_SUN_LAYER = {{36, 163}, {57, 25}};
const GRect RECT_MOON_LAYER = {{36, 183}, {57, 25}};
const GRect RECT_SUN_ICON = {{34, 172}, {12, 12}};
const GRect RECT_MOON_ICON = {{34, 192}, {12, 12}};
const GRect RECT_WEATHER_TEMP_LAYER = {{118, 163}, {35, 25}};
const GRect RECT_TEMP_ICON = {{104, 172}, {12, 12}};
const GRect RECT_WEATHER_WIND_LAYER = {{155, 163}, {36, 25}};
const GRect RECT_WIND_ICON = {{139, 172}, {12, 12}};
const GRect RECT_STEPS_LAYER = {{118, 183}, {78, 25}};
const GRect RECT_STEPS_ICON = {{103, 192}, {12, 12}};
// Status bar layout (16px tall panel at top)
// Icons are 12x12, active bars are 12x2
const int STATUS_HOURLY_X = 3;
const int STATUS_UMBRELLA_X = 22;   // 3 + 12 + 7
const int STATUS_ORGANIC_X = 47;    // 22 + 12 + 13
const int STATUS_GREY_X = 67;       // 47 + 12 + 8
const int STATUS_BLACK_X = 86;      // 67 + 12 + 7
const GRect RECT_WEEKDAY_LAYER = {{113, -9}, {56, 21}};
const GRect RECT_STATUS_BAR = {{0, 0}, {200, 16}};
#else
const GRect RECT_TIME_LAYER = {{1, -7}, {144, 68}};
const GRect RECT_GLUCOSE_LAYER = {{0, 54}, {66, 34}};
const GRect RECT_DELTA_LAYER = {{76, 67}, {66, 25}};
const GRect RECT_DATE_LAYER = {{0, 87}, {66, 29}};
const GRect RECT_WEEK_LAYER = {{76, 95}, {66, 25}};
const GRect RECT_SUN_LAYER = {{25, 120}, {41, 25}};
const GRect RECT_MOON_LAYER = {{25, 135}, {41, 25}};
const GRect RECT_SUN_ICON = {{10, 129}, {12, 12}};
const GRect RECT_MOON_ICON = {{10, 144}, {12, 12}};
const GRect RECT_WEATHER_TEMP_LAYER = {{86, 120}, {25, 25}};
const GRect RECT_TEMP_ICON = {{75, 129}, {12, 12}};
const GRect RECT_WEATHER_WIND_LAYER = {{118, 120}, {48, 25}};
const GRect RECT_WIND_ICON = {{105, 129}, {12, 12}};
const GRect RECT_STEPS_LAYER = {{87, 135}, {56, 25}};
const GRect RECT_STEPS_ICON = {{74, 144}, {12, 12}};
// Status bar layout (16px tall panel at top)
// Icons are 12x12, active bars are 12x2
const int STATUS_HOURLY_X = 2;
const int STATUS_UMBRELLA_X = 16;   // 2 + 12 + 2
const int STATUS_ORGANIC_X = 34;    // 16 + 12 + 6
const int STATUS_GREY_X = 48;       // 34 + 12 + 2
const int STATUS_BLACK_X = 62;      // 48 + 12 + 2
const GRect RECT_WEEKDAY_LAYER = {{81, -9}, {40, 21}}; // 62 + 12 + 7
const GRect RECT_STATUS_BAR = {{0, 0}, {144, 16}};
#endif

// ===== Compact-Mode Layout Constants =====
// Applied when Quick View is visible (unobstructed height < LAYOUT_COMPACT_THRESHOLD).
// Two layout modes:
//   Normal  — full screen: all layers visible, positions above.
//   Compact — Quick View visible: date/week/sun/moon/weather/steps hidden;
//             time unchanged; BG uses FONT_HUMAROID_64 in a wider rect;
//             delta repositioned alongside.
#if defined(PBL_PLATFORM_EMERY)
// Emery: 200x228 full.  Compact threshold 215 (QV ~13+ px showing).
const GRect RECT_TIME_LAYER_COMPACT    = {{1,  12}, {200, 68}};
const GRect RECT_GLUCOSE_LAYER_COMPACT = {{0,  52}, {130, 68}};
const GRect RECT_DELTA_LAYER_COMPACT   = {{132, 88}, {68,  28}};
#else
// Basalt/Diorite: 144x168 full.  Compact threshold 155 (QV ~13+ px showing).
const GRect RECT_TIME_LAYER_COMPACT    = {{1,  -7}, {144, 68}};
const GRect RECT_GLUCOSE_LAYER_COMPACT = {{0,  28}, {90,  68}};
const GRect RECT_DELTA_LAYER_COMPACT   = {{92,  68}, {52, 28}};
#endif

