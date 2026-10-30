# Tokyo Observer

<p align="center">
  <img src="screenshots/fuji-sunset.jpg" alt="Sunset beside Mt Fuji in Tokyo Observer" width="640">
</p>


A retro simulation window onto Tokyo Bay. Drift above a little polygon Tokyo built from open data as it follows the real clock and live weather. Planes glide into Haneda, lighthouses guide ships cross the bay, rain patters on the water, the moon rises over the city lights, and Japanese radio plays softly in the background. Leave it running and let the bay keep you company.


## Run it

No install or build step. You need Python 3 (or any static file server) and
an internet connection for the live data.

```
git clone https://github.com/wrongwaycorrigan/tokyo-observer.git
cd tokyo-observer
```

Then start the local server in that folder:

| System | Command |
|---|---|
| Windows | `python tools/serve.py` (or `py tools/serve.py`) |
| macOS | `python3 tools/serve.py` |
| Linux | `python3 tools/serve.py` |

Open http://localhost:8000

`tools/serve.py` also relays live aircraft from adsb.lol. Any static file server
(such as `python -m http.server 8000`) works too, but shows aircraft only if you
connect your own receiver.

## Connect your own data (optional)

Many live data sources are already connected to Tokyo Observer.

Click **⛯** settings gear at the top right of the menu bar to view their status or add your own. 

- **Aircraft:** Live air traffic will fly over the bay. If you have your own ADSB receiver you can use your own feed.
- **Ships:** Populate the water with live ship traffic using a free API key from https://aisstream.io
- **Bring your own data:** GeoJSON and JSON latitude/longitude data is supported. 

Settings stay in your browser.

## Controls

- Drag to orbit, scroll to zoom, right-drag to pan
- Click TOKYO OBSERVER to return to wide bay view
- Add `?hours=6` to the URL to preview another time of day

## Data

Open-Meteo, RainViewer, VATSIM METAR, JMA, aisstream.io, adsb.lol, SondeHub,
wspr.live, USGS, wheretheiss.at, radio-browser.info, AWS Terrain Tiles, ESA
WorldCover, OpenStreetMap, OurAirports and the Yale Bright Star Catalogue.

## Credits

- three.js (MIT)
- Roads, airport boundaries, terminals and port buildings (c) OpenStreetMap contributors, ODbL; runways from OurAirports
- Skytree and Tokyo Tower geometry: PLATEAU (MLIT Japan), CC BY 4.0
- Aircraft without a receiver: adsb.lol via `tools/serve.py` (ODbL)
- Stars: Yale Bright Star Catalogue, 5th ed. (Hoffleit & Warren), via CDS
- Land cover: ESA WorldCover (CC BY 4.0); weather: Open-Meteo (CC BY 4.0)
- DotGothic16 font by Fontworks (SIL OFL), via Google Fonts
- Open Runway Numbers font by ryo-a (CC0)
