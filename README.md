# Havian Fleet

Kart og tabell over TGS-prosjekter og fartøyposisjoner fra Havian Global Manager.

## Lokal utvikling

1. Sett secrets i `.env` (se `.env.example`): `HAVIAN_ENDPOINT`, `HAVIAN_API_KEY`, `HAVIAN_AUTH_KEY`, `HAVIAN_AUTH_HEADER=AUTHTOKEN`.
2. `npm install && npm run dev`
3. Åpne http://127.0.0.1:3000

Uten secrets brukes merket sample-data.

## API

Server-rute `GET /api/fleet` krever Cursor-identitet og henter:

- `project/getProjects`
- `vessel/getVesselLocations`

Auth-header: `AUTHTOKEN`.
