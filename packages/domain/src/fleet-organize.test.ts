import {describe, expect, it} from 'vitest';
import {compareFleetNames, organizeFleet, organizeFleetByName, organizeFleetByType} from './fleet-organize';

const vehicles = [
  {unit: 'Engine 70', type: 'Type 3 Engine'},
  {unit: 'Engine 12', type: 'Type 3 Engine'},
  {unit: 'Dozer 4', type: 'Dozer'},
  {unit: 'Tender 2', type: 'Water Tender'},
];

describe('fleet organize', () => {
  it('sorts unit names with numeric awareness', () => {
    expect(compareFleetNames('Engine 12', 'Engine 70')).toBeLessThan(0);
    expect(organizeFleetByName(vehicles).map((item) => item.unit)).toEqual([
      'Dozer 4',
      'Engine 12',
      'Engine 70',
      'Tender 2',
    ]);
  });

  it('groups by type then sorts units inside each group', () => {
    expect(organizeFleetByType(vehicles)).toEqual([
      {type: 'Dozer', vehicles: [{unit: 'Dozer 4', type: 'Dozer'}]},
      {type: 'Type 3 Engine', vehicles: [
        {unit: 'Engine 12', type: 'Type 3 Engine'},
        {unit: 'Engine 70', type: 'Type 3 Engine'},
      ]},
      {type: 'Water Tender', vehicles: [{unit: 'Tender 2', type: 'Water Tender'}]},
    ]);
  });

  it('exposes flat vehicles for name mode and groups for type mode', () => {
    expect(organizeFleet(vehicles, 'name').groups).toEqual([{type: '', vehicles: organizeFleetByName(vehicles)}]);
    expect(organizeFleet(vehicles, 'type').groups.map((group) => group.type)).toEqual([
      'Dozer',
      'Type 3 Engine',
      'Water Tender',
    ]);
  });

  it('sorts mobile records by name and puts blank types under Unspecified', () => {
    const mobile = [
      {name: 'Engine 70', type: 'Type 3 Engine'},
      {name: 'Engine 12', type: ' '},
      {name: 'Dozer 4', type: 'Dozer'},
    ];
    expect(organizeFleetByName(mobile).map((item) => item.name)).toEqual(['Dozer 4', 'Engine 12', 'Engine 70']);
    expect(organizeFleetByType(mobile).map((group) => group.type)).toEqual(['Dozer', 'Type 3 Engine', 'Unspecified']);
  });
});
