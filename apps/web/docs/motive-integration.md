# Motive integration notes

## Confirmed API behavior

- Authentication supports company API keys in `X-API-Key`.
- `GET /v1/assets` returns each asset's Motive `id`, `name`, `vin`, gateway, and availability details.
- `GET /v1/vehicles` also returns `id`, `vin`, make, model, year, Vehicle Gateway, and driver details.
- Neither list endpoint documents a VIN query parameter. VIN matching therefore requires paginating records, normalizing VINs, and matching locally.
- `PUT /v1/assets/{asset_id}/locate` is for Asset Gateway Mini hardware. It is asynchronous (about 5–15 minutes) and has a 15-minute cooldown. It is not suitable for routine powered-vehicle tracking.
- Vehicle location endpoints are separate. V3 is limited to vehicles with a Motive Vehicle Gateway; V1/V2 support broader vehicle location use cases.
- Camera media APIs use Motive asset identity. Available timelines can be fetched before requesting video recall; camera connection and control endpoints are also available.

## Recommended identity mapping

1. Fetch all Motive vehicles and assets server-side, following pagination.
2. Normalize FireOps and Motive VINs with `trim().toUpperCase()`.
3. Accept only exact, unique, non-empty VIN matches.
4. Persist Motive entity type (`vehicle` or `asset`) and Motive ID on FireOps vehicle record.
5. Flag missing or duplicate VINs for owner review instead of guessing from unit name, plate, make, or model.
6. Refresh mappings on demand and when FireOps VIN changes.

VIN can connect records, but is not direct Motive lookup capability. Motive ID should become durable API identifier after match.

## Security foundation implemented

- Owner-only settings UI accepts and verifies API key.
- Edge Function calls Motive; browser never calls Motive directly.
- API key is AES-256-GCM encrypted before database storage.
- Browser receives only connection state and last four characters.
- Integration table denies browser roles all access.

## Next implementation slice

- Add encrypted-key decryption inside server-only Motive proxy.
- Add paginated VIN matching job and mapping columns/table.
- Show match status on each FireOps vehicle.
- Add vehicle location endpoint and freshness metadata.
- Add camera availability/timeline flow after identity mapping.
- Add rate limiting, sync audit records, retries, and Motive API error telemetry.

Sources:

- https://developer-docs.gomotive.com/docs/authentication
- https://developer-docs.gomotive.com/reference/overview-asset
- https://developer-docs.gomotive.com/reference/list-all-the-company-assets
- https://developer-docs.gomotive.com/reference/list-all-the-company-vehicles
- https://developer-docs.gomotive.com/reference/locate-your-asset
- https://developer-docs.gomotive.com/reference/fetch-the-available-timelines-for-an-asset
