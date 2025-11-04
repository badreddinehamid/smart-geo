import gps

session = gps.gps(mode=gps.WATCH_ENABLE)

while True:
    report = session.next()
    if report['class'] == 'TPV':
        print(f"Latitude: {getattr(report, 'lat', None)}")
        print(f"Longitude: {getattr(report, 'lon', None)}")
