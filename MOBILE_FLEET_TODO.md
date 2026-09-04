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
- [x] 7. Dashboard parity
  - Open-issue blockers and assigned-to-me sections
  - Activity feed links
- [x] 8. Fire assignment and Motive telemetry
  - NIFC fire assignment
  - Motive location, speed, and connection state

## Verification

- [x] Mobile TypeScript check
- [x] Mobile lint
- [ ] Simulator interaction pass for status and assignment changes
- [ ] Cross-client realtime check between web and mobile

## Next feature set: Communications

- [x] Company thread list ordered by latest activity
- [x] Unread thread state and tab badge
- [x] Create a company thread
- [x] Thread detail and replies
- [x] Realtime refresh shared with web
- [x] iOS Simulator interaction pass
  - Live thread list and thread detail render
  - New-thread validation and reply controls
  - No test content posted to company communications

## Remaining web-to-mobile parity

Complete and validate items in order unless product priority changes.

- [x] Company documents
- [x] Training and registration
- [x] Mobile Operations incident discovery
  - Assigned-fire map remains available
  - All Fires uses state and incident lists instead of map
  - Fire-name search opens incident details
- [x] 1. Owner crew management and credentials
  - Crew list, status counts, and invitation limits
  - Invite crew members
  - Contact details and member status
  - Upload, open, and remove credentials
  - View and change vehicle/fire assignments
  - Remove crew members and clear assignments safely
- [x] 2. Owner inventory management
  - List company inventory
  - Add and rename items
  - Adjust quantities
  - Delete items with confirmation
  - Preserve owner-only access
- [ ] 3. Account and integration settings
  - Company details and crew seat usage
  - Motive API verification, replacement, and disconnect
  - Switch company
- [ ] 4. Motive vehicle detail parity
  - Live location, speed, connection state, and last update
  - Camera status and image capture
- [ ] 5. Dashboard notification parity
  - Combined unread communications, documents, and training
  - Open each notification in its source screen
- [ ] 6. Vehicle-side fire assignment
  - Search and select a NIFC fire from vehicle details
  - Clear fire assignment from vehicle details
- [ ] 7. Resolved issue history in vehicle details
- [ ] 8. Owner issue editing
  - Edit title, description, and priority
- [ ] 9. Manual light/dark theme control

## Company documents

- [x] Company-scoped list with realtime refresh
- [x] Member unread state and More tab badge
- [x] Open attachments with signed URLs
- [x] Owner upload and edit forms
- [x] Owner destructive delete confirmation
- [x] Safe cleanup for abandoned, replaced, and deleted uploads
- [x] iOS Simulator interaction pass
  - Live company document list rendered
  - Owner upload form and responsive layout rendered
  - Destructive delete and file upload were not executed against company data

## Training and registration

- [x] Scheduled and recently expired course lists
- [x] Member unread state and More tab badge
- [x] Course detail and owner attendee roster
- [x] Member signup and cancellation with capacity enforcement
- [x] Owner create and edit forms with validation
- [x] Owner destructive delete confirmation
- [x] Realtime refresh shared with web
- [x] iOS Simulator interaction pass
  - Live scheduled-course list rendered with registration capacity
  - Owner create form and mobile date/time fields rendered
  - Registration, course creation, and deletion were not executed against company data

## Operations map and incident discovery

- [x] Native incident map defaults to fires assigned to the company fleet
- [x] Assigned and All Fires scopes
- [x] All Fires hides the map and prioritizes incident discovery on mobile
- [x] All-fire state list sorted alphabetically by full state name
- [x] Fire-name search with selectable incident results
- [x] State incident lists sorted largest to smallest by reported acreage
- [x] Paginated NIFC loading beyond the previous 1,000-incident limit
- [ ] iOS Simulator interaction pass
