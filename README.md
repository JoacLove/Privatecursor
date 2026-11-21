# Havian Fleet

Kart og tabell over TGS-prosjekter og fartøyposisjoner fra Havian Global Manager, pluss Propulsion / Compressor power for Ramforms fra Høglund Connect.

## Lokal utvikling

1. Sett secrets i `.env` (se `.env.example`):
   - Havian: `HAVIAN_ENDPOINT`, `HAVIAN_API_KEY`, `HAVIAN_AUTH_KEY`, `HAVIAN_AUTH_HEADER=AUTHTOKEN`
   - Høglund (valgfritt): `HOGLUND_TOKEN` — user token (`id:secret`) eller `email:password`
2. `npm install && npm run dev`
3. Åpne http://127.0.0.1:3000

Uten secrets brukes merket sample-data (Havian og/eller Høglund).

## API

Server-rute `GET /api/fleet` krever Cursor-identitet og henter:

- `project/getProjects`
- `vessel/getVesselLocations`
- `map/getTracks` (TGS Ramform-fartøy, siste ~24 t)
- `map/getProjectArea` (aktive survey-prosjekter)
- `weather/getObservations` / `weather/getForecast`

Server-rute `GET /api/power` henter live Propulsion (PEM) og Compressor (CP) kW for Titan, Atlas, Vanguard, Hyperion, Tethys, Sovereign og Victory via Høglund Connect (`api.hoglund.no`). Havian API har ikke disse feltene.

Kart-, spor- og værkall feiler mykt: kjerne (prosjekt + fartøy) leveres likevel. Secrets holdes server-side og redakteres i rå JSON.

Auth-header Havian: `AUTHTOKEN`.
