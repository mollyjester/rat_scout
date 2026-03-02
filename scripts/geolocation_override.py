"""
Drop-in replacement for pypkjs's navigator/geolocation.py.

When PEBBLE_GEO_LAT and PEBBLE_GEO_LON environment variables are set,
this module returns those fixed coordinates instead of performing an IP
lookup.  This allows the emulator to simulate a specific geographic
location for weather and astronomy API calls.

Swapped in at runtime by run-emulator.sh when --loc is used, and
restored on exit.  The original file is never modified permanently.
"""

__author__ = 'rat_scout override'

import STPyV8 as v8
import time
import os
import logging

logger = logging.getLogger(__name__)

Position = lambda runtime, *args: v8.JSObject.create(
    runtime.context.locals.Position, args)
Coordinates = lambda runtime, *args: v8.JSObject.create(
    runtime.context.locals.Coordinates, args)


class Geolocation(object):
    def __init__(self, runtime):
        self.runtime = runtime

        runtime.run_js("""
            Position = (function(coords, timestamp) {
                this.coords = coords;
                this.timestamp = timestamp;
            });
        """)

        runtime.run_js("""
            Coordinates = (function(long, lat, accuracy) {
                this.longitude = long
                this.latitude = lat
                this.accuracy = accuracy
            });
        """)

    def _get_position(self, success, failure):
        lat_str = os.environ.get('PEBBLE_GEO_LAT', '')
        lon_str = os.environ.get('PEBBLE_GEO_LON', '')

        if lat_str and lon_str:
            try:
                lat = float(lat_str)
                lon = float(lon_str)
                logger.info(
                    'Geolocation override: returning fixed coords '
                    '(lat=%s, lon=%s)', lat, lon)
                self.runtime.enqueue(
                    success,
                    Position(
                        self.runtime,
                        Coordinates(self.runtime, lon, lat, 100),
                        round(time.time() * 1000),
                    ),
                )
                return
            except (ValueError, TypeError) as exc:
                logger.warning(
                    'Geolocation override: invalid coords (%s, %s): %s — '
                    'falling back to IP lookup', lat_str, lon_str, exc)

        # Fallback: original IP-based lookup
        try:
            import requests
            import pygeoip
            resp = requests.get('https://api.ipify.org')
            resp.raise_for_status()
            ip = resp.text
            gi = pygeoip.GeoIP(
                '%s/GeoLiteCity.dat' % os.path.dirname(__file__))
            record = gi.record_by_addr(ip)
            if record is None:
                if callable(failure):
                    self.runtime.enqueue(failure)
        except Exception:
            if callable(failure):
                self.runtime.enqueue(failure)
        else:
            self.runtime.enqueue(
                success,
                Position(
                    self.runtime,
                    Coordinates(
                        self.runtime,
                        record['longitude'],
                        record['latitude'],
                        1000,
                    ),
                    round(time.time() * 1000),
                ),
            )

    def _enabled(self):
        return True

    def getCurrentPosition(self, success, failure=None, options=None):
        self.runtime.group.spawn(self._get_position, success, failure)

    def watchPosition(self, success, failure=None, options=None):
        self.runtime.group.spawn(self._get_position, success, failure)
        return 42

    def clearWatch(self, thing):
        pass
