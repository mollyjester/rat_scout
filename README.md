# Rat Scout - Dexcom Pebble Watchface

A feature-rich Pebble watchface that displays Dexcom glucose readings alongside weather, astronomy, and time information.

## Overview

Rat Scout is a Pebble smartwatch application that connects to the Dexcom Share API to fetch and display continuous glucose monitoring (CGM) data. Beyond glucose tracking, it shows the current time, date, week number, weather conditions (temperature, wind, umbrella indicator), sunrise/sunset times, moonrise/moonset times, moon phase, garbage collection schedule, and battery status—all on a single elegant watchface.

## Features

### Glucose Monitoring
- **Real-time glucose updates**: Displays current blood glucose with automatic updates every 5 minutes
- **Glucose delta tracking**: Shows glucose rate of change with ± indicators
- **Time since last reading**: Displays how many minutes have elapsed since the last CGM reading
- **Configurable units**: Display glucose in mg/dL or mmol/L
- **Flexible display options**: Toggle delta and time delta displays individually
- **Threshold vibration alerts**: Configurable low and high BG threshold alerts with distinct vibration patterns
- **Multi-region support**: Works with Dexcom US, Outside US (OUS), and Japan (JP) servers

### Weather
- **Current temperature**: Displays temperature in metric (°C) or imperial (°F) units
- **Wind speed**: Shows current wind speed (m/s or mph)
- **Umbrella indicator**: Alerts when rain is expected today based on current conditions and forecast
- **Smart caching**: Configurable update interval (30 min to 3 hours) with location-aware cache invalidation

### Time & Date
- **Time display**: Shows current time in 12/24-hour format
- **Date information**: Displays current date (day.month format)
- **Week number**: Shows current week number with "W" prefix

### Astronomy Data
- **Sunrise/Sunset times**: Shows the next upcoming sunrise or sunset based on your location
- **Moonrise/Moonset times**: Displays the next upcoming lunar rise or set time
- **Moon phase**: Shows current moon phase with graphical icon (new moon, waxing crescent, first quarter, waxing gibbous, full moon, waning gibbous, third quarter, waning crescent)
- **Smart time display**: Automatically shows the next relevant event (e.g., after sunset, shows tomorrow's sunrise)
- **Daily caching**: Astronomy data is fetched once per day and cached, refreshing at midnight

### Additional Features
- **Battery indicator**: Visual battery percentage display with charging status indicator
- **Hourly vibration**: Optional hourly notification vibration
- **Garbage collection indicator**: Shows the next garbage bag type (Organic/Black/Grey) based on a weekly schedule
- **Persistent state**: Watchface data persists across app restarts using Pebble storage API
- **Cross-platform**: Works on all Pebble platforms (Aplite, Basalt, Chalk, Diorite, Emery)
- **Secure**: Credentials stored locally on phone, never transmitted to app servers
- **Low battery impact**: Efficient data updates with smart caching and minimal power consumption

## Requirements

- **Pebble Smartwatch**: Any Pebble platform (Time, Round, 2, Time Steel, etc.)
- **Dexcom Account**: Active Dexcom Share account with a connected CGM device
- **Pebble App**: Mobile app to pair with your watch and run the companion app
- **Network**: Phone internet connection for Dexcom API, weather, and astronomy data access

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
- **BG Threshold Vibration**: Enable/disable glucose threshold alerts
- **Low BG Threshold**: Set low glucose alert threshold (in your preferred units)
- **High BG Threshold**: Set high glucose alert threshold (in your preferred units)

### Astronomy Data (Optional)
- **API Key**: Enter your ipgeolocation.io API key to enable sunrise/sunset and moonrise/moonset displays
- Get a free API key at [https://ipgeolocation.io/](https://ipgeolocation.io/)

### Weather (Optional)
- **API Key**: Enter your OpenWeatherMap API key to display weather data
- Get a free API key at [https://openweathermap.org/api](https://openweathermap.org/api)
- **Weather Units**: Choose between Metric (°C, m/s) or Imperial (°F, mph)
- **Update Interval**: Configure how often weather data refreshes (30 min, 1 hour, 2 hours, or 3 hours)

Settings are stored securely on your phone and synced to the watchface automatically.

## Technical Details

### Architecture

- **C Watchface** (`src/c/rat_scout.c`): Lightweight display with UI rendering for all data, persistent storage, and vibration alerts
- **JavaScript Companion** (`src/pkjs/index.js`): Orchestrates Dexcom API, weather, and astronomy data fetching with a message queue for reliable Pebble communication
- **Dexcom Module** (`src/pkjs/dexcom.js`): Handles Dexcom Share API authentication (US/OUS/JP regions) and glucose data fetching with session caching
- **Weather Module** (`src/pkjs/weather.js`): OpenWeatherMap API integration for current weather and 5-day forecast with umbrella prediction
- **Geolocation Module** (`src/pkjs/geolocation.js`): ipgeolocation.io API integration for sunrise/sunset and moonrise/moonset times
- **Configuration** (`src/pkjs/config.json`): Clay-based settings UI for user configuration

### Data Flow

```
Phone App → Dexcom API → Parse glucose readings → Calculate delta →
         → Geolocation API → Astronomy data (cached daily) →
         → OpenWeatherMap API → Weather data (cached per interval) →
         → Message queue → Send to Pebble → Display on watchface
```

### Watchface Display Layout

- **Top**: Current time (large 64px font)
- **Top left**: Hourly vibration indicator (H symbol when enabled), separator, garbage collection bag type
- **Top right**: Battery percentage indicator
- **Left side**: Current glucose reading, glucose delta/time delta
- **Right side**: Date (day.month), week number
- **Bottom left**: Sun icon + next sunrise/sunset time, moon phase icon + next moonrise/moonset time
- **Bottom right**: Temperature, wind speed

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
- Weather data provided by [OpenWeatherMap](https://openweathermap.org/)

## License

This project is provided as-is for personal use. Ensure you have proper authorization to use the Dexcom API with your account.

## Disclaimer

This is an unofficial, community-maintained project. It is not affiliated with or endorsed by Dexcom, Inc. Always verify glucose readings with an official Dexcom app or meter before making medical decisions. This watchface is a convenience tool only.