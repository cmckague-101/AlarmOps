import {CompanyResource, FireIncident, FirePerimeter, HeatDetection, WeatherAlert} from './mapTypes';

export const demoIncidents: FireIncident[] = [
  {id:'walker',name:'Walker Fire',acres:12740,containment:38,updatedAt:new Date().toISOString(),coordinate:{latitude:44.18,longitude:-116.08},source:'Demo',status:'Active',personnel:342},
  {id:'ridge',name:'Ridge Creek Fire',acres:3860,containment:12,updatedAt:new Date().toISOString(),coordinate:{latitude:45.08,longitude:-117.62},source:'Demo',status:'Active',personnel:118},
  {id:'sage',name:'Sage Hollow Fire',acres:920,containment:76,updatedAt:new Date().toISOString(),coordinate:{latitude:43.62,longitude:-116.82},source:'Demo',status:'Active',personnel:64},
];
export const demoPerimeters: FirePerimeter[] = [
  {id:'p1',incidentId:'walker',coordinates:[{latitude:44.13,longitude:-116.16},{latitude:44.23,longitude:-116.14},{latitude:44.25,longitude:-116.02},{latitude:44.18,longitude:-115.97},{latitude:44.11,longitude:-116.04}]},
  {id:'p2',incidentId:'ridge',coordinates:[{latitude:45.03,longitude:-117.70},{latitude:45.13,longitude:-117.66},{latitude:45.12,longitude:-117.55},{latitude:45.04,longitude:-117.53}]},
];
export const demoHeat: HeatDetection[] = [
  {id:'h1',coordinate:{latitude:44.19,longitude:-116.09},confidence:'high',detectedAt:new Date().toISOString()},
  {id:'h2',coordinate:{latitude:44.21,longitude:-116.04},confidence:'nominal',detectedAt:new Date().toISOString()},
  {id:'h3',coordinate:{latitude:45.09,longitude:-117.61},confidence:'high',detectedAt:new Date().toISOString()},
];
export const demoAlerts: WeatherAlert[] = [
  {id:'w1',event:'Red Flag Warning',headline:'Gusty winds and low relative humidity expected',severity:'Severe',area:'Boise and Payette Fire Weather Zones',coordinate:{latitude:43.85,longitude:-116.35}},
];
export const demoResources: CompanyResource[] = [
  {id:'r1',unit:'Engine 701',callSign:'FireCo 701',type:'Type 3 Engine',coordinate:{latitude:44.16,longitude:-116.10},status:'Assigned',incidentId:'walker',readiness:94,lastLocationUpdate:new Date().toISOString(),crew:[
    {id:'c1',name:'Tyler Nail',role:'Engine Boss',qualifications:['ENGB','FFT1','FAL1'],status:'On duty'},
    {id:'c2',name:'Maria Jensen',role:'Senior Firefighter',qualifications:['FFT1','EMT'],status:'On duty'},
    {id:'c3',name:'Cole Ramirez',role:'Firefighter',qualifications:['FFT2','FAL3'],status:'On duty'},
  ]},
  {id:'r2',unit:'Tender 12',callSign:'FireCo Tender 12',type:'Water Tender',coordinate:{latitude:44.12,longitude:-116.06},status:'Assigned',incidentId:'walker',readiness:88,lastLocationUpdate:new Date().toISOString(),crew:[
    {id:'c4',name:'Jordan Lee',role:'Tender Operator',qualifications:['WTO','CDL-A'],status:'On duty'},
    {id:'c5',name:'Sam Ortega',role:'Tender Assistant',qualifications:['FFT2','CDL-B'],status:'On duty'},
  ]},
  {id:'r3',unit:'Engine 702',callSign:'FireCo 702',type:'Type 3 Engine',coordinate:{latitude:43.61,longitude:-116.22},status:'Available',readiness:79,lastLocationUpdate:new Date().toISOString(),crew:[
    {id:'c6',name:'Alex Morgan',role:'Engine Boss',qualifications:['ENGB','ICT5'],status:'Resting'},
    {id:'c7',name:'Dylan Price',role:'Firefighter',qualifications:['FFT2'],status:'Resting'},
  ]},
];
