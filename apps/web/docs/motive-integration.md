# Motive integration notes

## Authentication model

FireOps uses Motive OAuth 2.0 authorization-code flow. Each FireOps company supplies credentials for its own Motive developer application:

- Motive client ID
- Motive client secret
- Access token returned after authorization
- Refresh token returned after authorization

Credentials and tokens are scoped by FireOps `company_id`, encrypted with AES-256-GCM, and available only to service-role Edge Functions. Web and mobile clients receive connection metadata, never stored credentials or tokens.

## Motive developer application setup

1. Create an application in [Motive Developer Portal](https://developer.gomotive.com/portal).
2. Enable required permissions for companies, vehicles, assets, locations, camera connections, **Image Captures**, and **Images**. FireOps requests `image_captures.manage` and `images.read` during authorization.
3. Set **Success Redirect URI** to the deployed Edge Function callback:

   `https://<supabase-project-ref>.supabase.co/functions/v1/motive-integration`

4. In FireOps company settings, enter that application's client ID and client secret.
5. In Motive Dashboard, open **Admin → Safety → Cameras**, enable **Capture Trip Images**, and save. Motive requires this company-level `video_monitoring` feature for camera media APIs.
6. Select **Authorize with Motive**, review permissions, and install the application.

Every company can use distinct Motive application credentials while sharing the FireOps callback endpoint. Single-use OAuth state binds each callback to the initiating FireOps company and owner.

## Edge Function configuration

Set these Supabase secrets:

- `MOTIVE_ENCRYPTION_KEY`: base64-encoded 32-byte AES key
- `MOTIVE_REDIRECT_URI`: exact deployed callback URL registered in every Motive application
- `MOTIVE_ALLOWED_RETURN_URLS`: optional comma-separated web return URL allowlist

`motive-integration` disables gateway JWT verification because Motive's browser callback has no FireOps bearer token. POST actions verify Supabase JWTs inside the function and enforce company-owner access. Callback GET requests require a valid, unexpired, single-use state record.

## OAuth behavior

- Authorization codes expire after 10 minutes; state records use the same lifetime.
- Motive access tokens normally expire after 7,200 seconds.
- Access and refresh tokens are encrypted independently.
- Reconnecting replaces credentials and clears prior tokens before authorization. Reauthorization is required after adding scopes because existing tokens do not gain newly requested permissions.
- Disconnecting deletes credentials, tokens, and pending OAuth states for that company.
- Fleet sync refreshes expired access tokens server-side, persists rotated tokens, and retries one unauthorized request.

## Vehicle identity mapping

1. Fetch all Motive vehicles and assets server-side, following pagination.
2. Normalize FireOps and Motive VINs with `trim().toUpperCase()`.
3. Accept only exact, unique, non-empty VIN matches.
4. Persist Motive entity type (`vehicle` or `asset`) and Motive ID on FireOps vehicle record.
5. Flag missing or duplicate VINs for owner review instead of guessing from unit name, plate, make, or model.
6. Refresh mappings on demand and when FireOps VIN changes.

VIN connects records, but is not direct Motive lookup capability. Motive ID becomes durable API identifier after matching.

## Fleet sync

Authenticated company members can request a fleet sync. The Edge Function:

1. Refreshes expired OAuth tokens when needed.
2. Loads all pages from Motive vehicle-location and asset-location endpoints.
3. Matches normalized VINs only when unique in both FireOps and Motive.
4. Stores durable Motive entity IDs in `company_motive_vehicle_mappings`.
5. Returns sanitized location, speed, coordinates, and freshness metadata—never credentials or tokens.
6. Displays matched live data on web and mobile vehicle cards/details.

Missing and duplicate VINs stay unmatched rather than using unreliable make, model, plate, or unit-name guesses.

## Camera image capture

- Web and mobile vehicle detail pages can request a current front-facing Dashcam image for a VIN-matched vehicle or left-side Omnicam image for a matched asset.
- FireOps starts capture server-side, then polls Motive until image is ready. OAuth tokens never reach client.
- Capture requests verify company membership and persisted vehicle mapping before calling Motive.
- Returned media URL is Motive-signed and time-limited; FireOps does not persist camera images.

## Next implementation slice

- Add available-video timeline and video recall flow.
- Add explicit manual refresh and unmatched-VIN diagnostics UI.
- Add background sync scheduling, rate limiting, sync audit records, retries, and Motive API error telemetry.

Sources:

- https://developer-docs.gomotive.com/docs/oauth-20
- https://developer-docs.gomotive.com/docs/oauth-scopes
- https://developer-docs.gomotive.com/reference/list-all-the-company-assets
- https://developer-docs.gomotive.com/reference/list-all-the-company-vehicles
- https://developer-docs.gomotive.com/reference/fetch-the-available-timelines-for-an-asset
