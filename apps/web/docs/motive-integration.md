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
2. Enable required read permissions for companies, vehicles, assets, locations, and camera connections.
3. Set **Success Redirect URI** to the deployed Edge Function callback:

   `https://<supabase-project-ref>.supabase.co/functions/v1/motive-integration`

4. In FireOps company settings, enter that application's client ID and client secret.
5. Select **Authorize with Motive**, review permissions, and install the application.

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
- Reconnecting replaces credentials and clears prior tokens before authorization.
- Disconnecting deletes credentials, tokens, and pending OAuth states for that company.
- Future Motive API proxy calls must refresh expired access tokens server-side and persist rotated tokens before retrying requests.

## Vehicle identity mapping

1. Fetch all Motive vehicles and assets server-side, following pagination.
2. Normalize FireOps and Motive VINs with `trim().toUpperCase()`.
3. Accept only exact, unique, non-empty VIN matches.
4. Persist Motive entity type (`vehicle` or `asset`) and Motive ID on FireOps vehicle record.
5. Flag missing or duplicate VINs for owner review instead of guessing from unit name, plate, make, or model.
6. Refresh mappings on demand and when FireOps VIN changes.

VIN connects records, but is not direct Motive lookup capability. Motive ID becomes durable API identifier after matching.

## Next implementation slice

- Add server-side token refresh and authenticated Motive request helper.
- Add paginated VIN matching job and mapping columns/table.
- Show match status on each FireOps vehicle.
- Add vehicle location endpoint and freshness metadata.
- Add camera availability/timeline flow after identity mapping.
- Add rate limiting, sync audit records, retries, and Motive API error telemetry.

Sources:

- https://developer-docs.gomotive.com/docs/oauth-20
- https://developer-docs.gomotive.com/docs/oauth-scopes
- https://developer-docs.gomotive.com/reference/list-all-the-company-assets
- https://developer-docs.gomotive.com/reference/list-all-the-company-vehicles
- https://developer-docs.gomotive.com/reference/fetch-the-available-timelines-for-an-asset
