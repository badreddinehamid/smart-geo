#!/usr/bin/env python3
"""
simulate_nmea_allal_al_fassi.py

Continuously appends NMEA sentences to `nmea.txt`, simulating a vehicle
moving in a straight line along Avenue Allal Al Fassi, Rabat, Morocco.

Start coordinate chosen as a representative point on Av. Allal Al Fassi:
    START_LAT = 33.9754605
    START_LON = -6.869285

Heading is set to ~30.0 degrees (NE), which follows the avenue direction
between nearby mapped points. Sources: Yandex / findlatitudeandlongitude.
"""
import time
import math
from datetime import datetime, timezone

# -------------------------
# CONFIGURATION (edit if desired)
# -------------------------
# Representative start coordinate on Av. Allal Al Fassi, Rabat
START_LAT = 33.9754605    # North positive
START_LON = -6.869285     # West negative

HEADING_DEG = 30.0        # approx. avenue direction NE (0 = North, clockwise)
SPEED_KNOTS = 20.0        # speed in knots (change as desired)
UPDATE_INTERVAL = 1.0     # seconds between updates
ALTITUDE_M = 15.0         # altitude for GGA sentence
NUM_SAT = 8
HDOP = 0.9
GEOID_SEP = 48.3          # geoid separation (sample-like)
MAGVAR = 0.0              # magnetic variation degrees (0 = none)
OUTPUT_FILE = "nmea.txt"
# -------------------------

R_EARTH = 6371000.0  # meters

def decimal_to_nmea_lat(lat):
    ns = "N" if lat >= 0 else "S"
    lat_abs = abs(lat)
    degrees = int(lat_abs)
    minutes = (lat_abs - degrees) * 60.0
    return f"{degrees:02d}{minutes:07.4f}", ns

def decimal_to_nmea_lon(lon):
    ew = "E" if lon >= 0 else "W"
    lon_abs = abs(lon)
    degrees = int(lon_abs)
    minutes = (lon_abs - degrees) * 60.0
    return f"{degrees:03d}{minutes:07.4f}", ew

def nmea_checksum(sentence_body: str) -> str:
    csum = 0
    for ch in sentence_body:
        csum ^= ord(ch)
    return f"{csum:02X}"

def make_gprmc(timestamp_utc, status, lat, lon, speed_knots, course_deg, date_ddmmyy, magvar, magvar_ew):
    time_str = timestamp_utc.strftime("%H%M%S.%f")[:9]
    lat_nmea, ns = decimal_to_nmea_lat(lat)
    lon_nmea, ew = decimal_to_nmea_lon(lon)
    magvar_str = f"{abs(magvar):.1f},{magvar_ew}" if magvar is not None else ""
    body = f"GPRMC,{time_str},{status},{lat_nmea},{ns},{lon_nmea},{ew},{speed_knots:05.1f},{course_deg:05.1f},{date_ddmmyy},{magvar_str}"
    csum = nmea_checksum(body)
    return f"${body}*{csum}"

def make_gpgga(timestamp_utc, lat, lon, fix, num_sat, hdop, alt_m, geoid_sep):
    time_str = timestamp_utc.strftime("%H%M%S.%f")[:9]
    lat_nmea, ns = decimal_to_nmea_lat(lat)
    lon_nmea, ew = decimal_to_nmea_lon(lon)
    body = f"GPGGA,{time_str},{lat_nmea},{ns},{lon_nmea},{ew},{fix},{num_sat:02d},{hdop:.1f},{alt_m:.1f},M,{geoid_sep:.1f},M,,"
    csum = nmea_checksum(body)
    return f"${body}*{csum}"

def make_gpvtg(course_true, mag_course, speed_knots, speed_kph, mode='A'):
    body = f"GPVTG,{course_true:.1f},T,{mag_course:.1f},M,{speed_knots:05.1f},N,{speed_kph:05.1f},K,{mode}"
    csum = nmea_checksum(body)
    return f"${body}*{csum}"

def update_position(lat, lon, heading_deg, distance_m):
    """Spherical approximation for short distances."""
    bearing = math.radians(heading_deg)
    lat_rad = math.radians(lat)
    delta_lat = (distance_m / R_EARTH) * math.cos(bearing)
    delta_lon = (distance_m / R_EARTH) * math.sin(bearing) / max(math.cos(lat_rad), 1e-12)
    lat_new = lat + (delta_lat * (180.0 / math.pi))
    lon_new = lon + (delta_lon * (180.0 / math.pi))
    return lat_new, lon_new

def main():
    lat = START_LAT
    lon = START_LON
    heading = HEADING_DEG % 360.0
    speed_knots = float(SPEED_KNOTS)
    speed_mps = speed_knots * 0.514444
    update_interval = float(UPDATE_INTERVAL)

    print(f"Simulating NMEA on Av. Allal Al Fassi -> start {lat:.6f}, {lon:.6f}, heading {heading}°, speed {speed_knots} kn")
    print(f"Appending to {OUTPUT_FILE} every {update_interval}s. CTRL-C to stop.")

    with open(OUTPUT_FILE, "a", buffering=1) as fh:  # line-buffered
        try:
            while True:
                now_utc = datetime.now(timezone.utc)
                date_ddmmyy = now_utc.strftime("%d%m%y")
                distance = speed_mps * update_interval
                lat, lon = update_position(lat, lon, heading, distance)

                speed_kph = speed_mps * 3.6
                mag_course = (heading - MAGVAR) % 360.0
                magvar_ew = "E" if MAGVAR > 0 else ("W" if MAGVAR < 0 else "E")

                gprmc = make_gprmc(now_utc, "A", lat, lon, speed_knots, heading, date_ddmmyy, abs(MAGVAR) if MAGVAR != 0 else None, magvar_ew)
                gpgga = make_gpgga(now_utc, lat, lon, 1, NUM_SAT, HDOP, ALTITUDE_M, GEOID_SEP)
                gpvtg = make_gpvtg(heading, mag_course, speed_knots, speed_kph, mode='A')

                fh.write(gprmc + "\n")
                fh.write(gpgga + "\n")
                fh.write(gpvtg + "\n\n")
                fh.flush()

                time.sleep(update_interval)

        except KeyboardInterrupt:
            print("\nSimulation stopped by user. Last position: {:.6f}, {:.6f}".format(lat, lon))

if __name__ == "__main__":
    main()
