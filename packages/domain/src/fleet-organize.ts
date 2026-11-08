export type FleetOrganizeMode = 'name' | 'type';

export const fleetOrganizeOptions: {value: FleetOrganizeMode; label: string}[] = [
  {value: 'name', label: 'Name'},
  {value: 'type', label: 'Type'},
];

type FleetLabel = {unit?: string; name?: string; type?: string};

export function fleetUnitLabel(item: FleetLabel) {
  return (item.unit ?? item.name ?? '').trim();
}

export function compareFleetNames(left: string, right: string) {
  return left.localeCompare(right, undefined, {numeric: true, sensitivity: 'base'});
}

/** Flat A–Z list by unit/name. */
export function organizeFleetByName<T extends FleetLabel>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => compareFleetNames(fleetUnitLabel(a), fleetUnitLabel(b)));
}

/** Group by type (A–Z), units A–Z inside each group. */
export function organizeFleetByType<T extends FleetLabel>(items: readonly T[]): {type: string; vehicles: T[]}[] {
  const groups = new Map<string, T[]>();
  for (const item of organizeFleetByName(items)) {
    const type = (item.type ?? '').trim() || 'Unspecified';
    const list = groups.get(type);
    if (list) list.push(item);
    else groups.set(type, [item]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => compareFleetNames(a, b))
    .map(([type, vehicles]) => ({type, vehicles}));
}

export function organizeFleet<T extends FleetLabel>(items: readonly T[], mode: FleetOrganizeMode) {
  if (mode === 'type') return {mode, groups: organizeFleetByType(items), vehicles: organizeFleetByName(items)};
  const vehicles = organizeFleetByName(items);
  return {mode, groups: [{type: '', vehicles}], vehicles};
}
