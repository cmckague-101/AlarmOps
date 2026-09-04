# Mobile fleet parity

Source of truth for mobile fleet work. Check items only after implementation and validation pass.

## Completed

- [x] 1. Shared Supabase fleet foundation
  - `fleet_vehicles`, `fleet_issues`, `fleet_crew`, and `fleet_activities`
  - Company-scoped loading, realtime refresh, version tracking, and conflict-aware `apply_fleet_changes` mutations
- [x] 2. Fleet discovery and issue workflow
  - Vehicle search and status filters
  - Crew names and open-issue counts in Fleet
  - Current issue list and issue detail navigation
  - Create issue, add update, resolve, and reopen
- [x] 3. Vehicle detail and operational controls
  - Vehicle information, documents metadata, notes, assignment, and open issues
  - Owner status controls and searchable crew dropdown
  - Member assign-to-me/remove-assignment controls
  - Activity records written with vehicle mutations

## Next

- [x] 4. Add and edit vehicle records
  - Owner-only forms and validation
  - Preserve web vehicle schema and optimistic-concurrency behavior
- [x] 5. Vehicle document support
  - Upload vehicle photo and named documents
  - Open attachments with signed URLs
  - Remove abandoned/replaced uploads safely
- [x] 6. Delete vehicle
  - Owner-only destructive confirmation
  - Delete linked issues consistently
- [ ] 7. Dashboard parity
  - Open-issue blockers and assigned-to-me sections
  - Activity feed links
- [ ] 8. Fire assignment and Motive telemetry
  - NIFC fire assignment
  - Motive location, speed, and connection state

## Verification

- [x] Mobile TypeScript check
- [x] Mobile lint
- [ ] Simulator interaction pass for status and assignment changes
- [ ] Cross-client realtime check between web and mobile
