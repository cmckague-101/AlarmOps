-- Vehicle crew assignment changes no longer create inbox or push notifications.

drop trigger if exists fleet_vehicle_assignment_notifications on public.fleet_vehicles;
drop function if exists public.notify_vehicle_assigned();

-- Remove existing assignment notifications and their cascading push jobs/deliveries.
delete from public.user_notifications
where event_type = 'vehicle_assigned';
