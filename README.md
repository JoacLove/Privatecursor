# Havian API

Lokal klient for Havian public API (GET-only), basert på `api.pdf`.

## Oppsett

1. Kopier verdier fra **Global Manager → user menu → API**:
   - Endpoint (`https://<firma>.havian.com/<serverKey>`)
   - ApiKey
   - AuthKey
2. Fyll inn `/agent/havain-api/.env` (allerede opprettet, gitignorert).
3. Installer avhengigheter:

```bash
cd /agent/havain-api
npm install
```

## Test tilkobling

```bash
npm run test:connection
```

Kjører `function=project&action=getTimingTrack` (eksemplet fra dokumentasjonen).

## Hent data

```bash
npm run get -- --function=vessel --action=getVesselLocations
npm run get -- --function=hse --action=get --projects=1234
```

## Viktig

- Ikke lim inn nøkler i chat.
- Ikke commit `.env`.
- Offentlig API er kun GET.
