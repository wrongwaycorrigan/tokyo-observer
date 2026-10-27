# Tokyo Observer

<p align="center">
  <img src="screenshots/fuji-sunset.jpg" alt="Sunset beside Mt Fuji in Tokyo Observer" width="640">
</p>

A quiet, retro 90s window onto Tokyo Bay. Drift above a little polygon Tokyo
built from open data as it follows the real clock and live weather: planes
glide into Haneda, ships cross the bay, rain patters on the water, the moon
rises over the city lights, and Japanese radio plays softly in the background.
Leave it running, and let the bay keep you company.

## Run it

No install or build step. You need Python 3 (or any static file server) and
an internet connection for the live data.

```
git clone https://github.com/wrongwaycorrigan/tokyo_observer.git
cd tokyo_observer
python -m http.server 8000
```

Open http://localhost:8000 in a desktop browser. Click once to start the
sound.

## Connect your own data (optional)

Many live data sources are already connected to Tokyo Observer.

Click **⛯** settings gear at the top right of the menu bar to view their status or add your own. 

- **Ships:** paste a free API key from https://aisstream.io
- **Aircraft:** the URL of your tar1090/readsb `aircraft.json`
- **Custom feeds:** any GeoJSON or JSON list of points with lat/lon

Settings stay in your browser.

## Controls

- Drag to orbit, scroll to zoom, right-drag to pan
- Click anything to fly to it and follow it; click TOKYO OBSERVER to return
- Menu hotkeys: A, S, O, B, Q toggle layers; L opens LINK; H goes home
- Add `?hours=6` to the URL to preview another time of day

## Data

Open-Meteo, RainViewer, VATSIM METAR, JMA, aisstream.io, SondeHub, wspr.live,
USGS, wheretheiss.at, radio-browser.info, AWS Terrain Tiles, ESA WorldCover,
OpenStreetMap, OurAirports and the Yale Bright Star Catalogue.

## Credits

- three.js (MIT)
- Roads, airport boundaries, terminals and port buildings (c) OpenStreetMap contributors, ODbL; runways from OurAirports
- Skytree and Tokyo Tower geometry: PLATEAU (MLIT Japan), CC BY 4.0
- Stars: Yale Bright Star Catalogue, 5th ed. (Hoffleit & Warren), via CDS
- Land cover: ESA WorldCover (CC BY 4.0); weather: Open-Meteo (CC BY 4.0)
- DotGothic16 font by Fontworks (SIL OFL), via Google Fonts
- Open Runway Numbers font by ryo-a (CC0)
