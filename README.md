# Rat Scout - Dexcom Pebble Watchface

A feature-rich Pebble watchface that displays Dexcom glucose readings alongside comprehensive time, date, and astronomy information.

## Overview

Rat Scout is a Pebble smartwatch application that connects to the Dexcom Share API to fetch and display continuous glucose monitoring (CGM) data. Beyond glucose tracking, it shows the current time, date, week number, sunrise/sunset times, moonrise/moonset times, moon phase information, and battery status—all on a single elegant watchface.

## Features

### Glucose Monitoring
- **Real-time glucose updates**: Displays current blood glucose with automatic updates every 4 minutes
- **Glucose delta tracking**: Shows glucose rate of change with ± indicators
- **Time since last reading**: Displays how many minutes have elapsed since the last CGM reading
- **Configurable units**: Display glucose in mg/dL or mmol/L
- **Flexible display options**: Toggle delta and time delta displays individually

### Time & Date
- **Time display**: Shows current time in 12/24-hour format
- **Date information**: Displays current date (day.month format)
- **Week number**: Shows current week number with "W" prefix

### Astronomy Data
- **Sunrise/Sunset times**: Shows sunrise and sunset times based on your location
- **Moonrise/Moonset times**: Displays lunar rise and set times
- **Moon phase**: Shows current moon phase

### Additional Features
- **Battery indicator**: Visual battery percentage display with charging status indicator
- **Hourly vibration**: Optional hourly notification vibration
- **Cross-platform**: Works on all Pebble platforms (Aplite, Basalt, Chalk, Diorite, Emery)
- **Secure**: Credentials stored locally on phone, never transmitted to app servers
- **Low battery impact**: Efficient data updates with minimal power consumption

## Requirements

- **Pebble Smartwatch**: Any Pebble platform (Time, Round, 2, Time Steel, etc.)
- **Dexcom Account**: Active Dexcom Share account with a connected CGM device
- **Pebble App**: Mobile app to pair with your watch and run the companion app
- **Network**: Phone internet connection for Dexcom API and astronomy data access

## Configuration

When you first open Rat Scout on your phone, you'll be prompted to configure:

### Dexcom Settings
- **Dexcom Login**: Your Dexcom Share account email/username
- **Dexcom Password**: Your Dexcom Share account password

### Display Settings
- **Blood Glucose Units**: Choose between mg/dL or mmol/L
- **Show BG Delta**: Toggle display of glucose rate of change
- **Show Time Delta**: Toggle display of time since last reading

### Notification Settings
- **Hourly Vibration**: Enable/disable hourly notification vibration

### Astronomy Data (Optional)
- **API Key**: Enter your ipgeolocation.io API key to enable sunrise/sunset and moonrise/moonset displays
- Get a free API key at [https://ipgeolocation.io/](https://ipgeolocation.io/)

Settings are stored securely on your phone and synced to the watchface automatically.

## Technical Details

### Architecture

- **C Watchface** (`src/c/rat_scout.c`): Lightweight display with UI rendering for all data
- **JavaScript Companion** (`src/pkjs/`): Handles Dexcom API authentication and data fetching
- **Geolocation Module** (`src/pkjs/geolocation.js`): Fetches location-based astronomy data
- **Configuration** (`src/pkjs/config.json`): Clay-based settings UI for user configuration

### Data Flow

```
Phone App → Dexcom API + Geolocation API → Parse readings → 
→ Calculate delta and astronomy data → Format for display → 
→ Send to Pebble → Display on watchface
```

### Watchface Display Layout

- **Top**: Current time (large 64px font)
- **Left side**: Current glucose reading, glucose delta/time delta
- **Right side**: Date (day.month), week number
- **Bottom**: Sunrise, sunset, moonrise, moonset times
- **Top right**: Battery percentage indicator
- **Top left**: Hourly vibration indicator (H symbol when enabled)

## Building and Installation

This project uses the Pebble SDK 3. To build and install:

```bash
pebble build
pebble install --phone <phone_ip>
```

Requires the wscript build configuration included in the project.

## Credits

- Original Dexcom API implementation inspired by [pydexcom](https://github.com/gagebenne/pydexcom)
- Built for [Pebble](https://www.pebble.com/) smartwatches
- Uses [Pebble Clay](https://github.com/pebble/clay) for settings UI
- Astronomy data provided by [ipgeolocation.io](https://ipgeolocation.io/)

## License

This project is provided as-is for personal use. Ensure you have proper authorization to use the Dexcom API with your account.

## Disclaimer

This is an unofficial, community-maintained project. It is not affiliated with or endorsed by Dexcom, Inc. Always verify glucose readings with an official Dexcom app or meter before making medical decisions. This watchface is a convenience tool only.