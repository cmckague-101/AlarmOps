# News Feed live integrations

News Feed uses authenticated Supabase Edge Functions. External credentials stay server-side and are never included in web or mobile builds.

## Current sources

- **Curated official-source cards:** FireOps maintains links and summaries for NWCG announcements, NIFC Predictive Services outlooks, Joint Fire Science Program news, and Wildland Fire Lessons Learned. These are source cards, not scraped article headlines. Presentation images are bundled locally rather than hotlinked. Confirm client ownership or licensing for bundled images before production release.
- **NIFC National Fire Activity:** `national-fire-activity` reads the current NICC situation report PDF, including National Preparedness Level and active incident totals. No credential required.
- **National Weather Service:** the same function counts active nationwide Red Flag Warning alerts from `api.weather.gov`. No credential required.
- **SAM.gov contracting opportunities:** `news-feed` searches active Forest Service opportunities from the prior 90 days and matches titles against each company's Fleet/VIPR categories.

SAM opportunity actions always use the notice-specific URL:

`https://sam.gov/opp/{noticeId}/view`

Never replace this with the generic opportunities landing page for a specific notice.

## SAM.gov setup

1. Generate a SAM.gov public API key from the registered user's Account Details page.
2. Store it as a Supabase Edge Function secret:

   ```bash
   npx supabase secrets set SAM_GOV_API_KEY="..." --project-ref PROJECT_REF
   ```

3. Deploy the authenticated function:

   ```bash
   npx supabase functions deploy news-feed --project-ref PROJECT_REF
   ```

4. Deploy `national-fire-activity` if not already deployed:

   ```bash
   npx supabase functions deploy national-fire-activity --project-ref PROJECT_REF
   ```

## Behavior

- Signed-in users send `companyId`; function verifies company membership.
- Fleet categories come from `fleet_vehicles.data.viprCategory`, falling back to vehicle `type`.
- SAM key stays in Edge Function environment.
- Results cache per company for 15 minutes.
- Missing configuration and upstream failures produce explicit unavailable states; no fake production data is substituted.
- Explore Demo uses clearly labeled fixtures and does not call production integration.

## Next sources

NWCG does not currently document a supported news API or RSS feed. Add it through a separate adapter only after choosing a stable official source or approved ingestion method. NIFC incident/open-data stories can be added independently of existing situation-report integration.
