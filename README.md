# Rat Scout - Dexcom Pebble Watchface

A lightweight Pebble watchface that displays real-time Dexcom glucose readings directly on your wrist.

## Overview

Rat Scout is a Pebble smartwatch application that connects to the Dexcom Share API to fetch and display continuous glucose monitoring (CGM) data. The watchface shows your current blood glucose value, trend direction, and optional delta (rate of change) information. Perfect for people with diabetes who want quick glucose checks without pulling out their phone.

## Features

- **Real-time glucose updates**: Automatically refreshes every 4 minutes
- **Configurable units**: Display in mg/dL or mmol/L
- **Delta tracking**: Optional display of glucose change and time elapsed since last reading
- **Cross-platform**: Works on all Pebble platforms (Aplite, Basalt, Chalk, Diorite, Emery)
- **Secure**: Credentials stored locally on phone, never transmitted to app servers
- **Low power**: Minimal battery impact with infrequent API calls

## Requirements

- **Pebble Smartwatch**: Any Pebble platform (Time, Round, 2, Time Steel, etc.)
- **Dexcom Account**: Active Dexcom Share account with a connected CGM device
- **Pebble App**: Mobile app to pair with your watch and run the companion app
- **Network**: Phone internet connection for Dexcom API access

## Configuration

When you first open Rat Scout on your phone, you'll be prompted to configure:

1. **Dexcom Login**: Your Dexcom Share account email/username
2. **Dexcom Password**: Your Dexcom Share account password
3. **Display Units**: Choose between mg/dL or mmol/L
4. **Show BG Delta**: Toggle display of glucose change rate
5. **Show Time Delta**: Toggle display of time since last reading

Settings are stored securely on your phone and synced to the watchface.

## Technical Details

### Architecture

- **C Watchface** (`src/c/rat_scout.c`): Lightweight display of glucose data
- **JavaScript Companion** (`src/pkjs/`): Handles Dexcom API authentication and data fetching
- **Configuration** (`src/pkjs/config.json`): Clay-based settings UI

### Data Flow

```
Phone App → Dexcom API → Parse readings → Calculate delta → 
→ Format for display → Send to Pebble → Display on watchface
```

## Credits

- Original Dexcom API implementation inspired by [pydexcom](https://github.com/gagebenne/pydexcom)
- Built for [Pebble](https://www.pebble.com/) smartwatches
- Uses [Pebble Clay](https://github.com/pebble/clay) for settings UI

## License

This project is provided as-is for personal use. Ensure you have proper authorization to use the Dexcom API with your account.

## Disclaimer

This is an unofficial, community-maintained project. It is not affiliated with or endorsed by Dexcom, Inc. Always verify glucose readings with an official Dexcom app or meter before making medical decisions. This watchface is a convenience tool only.