# Native demo fleet photos

These WebP files are unchanged copies of the existing web demo assets in `apps/web/public/demo-vehicles/`:

- `engine-701.webp` — Engine 701
- `tender-12.webp` — Tender 12
- `dozer-4.webp` — Dozer 4

No new images were generated or downloaded for this change. Metro bundles these files for native iOS/Android demo fleet cards and vehicle details; demo photo paths resolve locally without Supabase storage or signed URLs. Keep copies in sync with the web originals. The targeted demo client test verifies byte-for-byte equality.
