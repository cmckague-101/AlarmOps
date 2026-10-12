-- Capitalize the Tires label in existing vehicle inspection checklists.
update public.company_vehicle_inspection_items
set label = 'Tires'
where label = 'tires';
