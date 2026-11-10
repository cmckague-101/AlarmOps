import {describe,expect,it} from 'vitest';
import type {Vehicle} from './models';
import {
  canSendToVipr,engineTypeFor,guessViprCategory,parseViprForm,parseViprNumber,viprBidPackageFileName,viprBidPackageText,
  viprCategoryFor,viprExportSummary,viprFieldsFor,viprFormValues,viprIntelligenceEntries,viprSelectableVehicles,
} from './vipr';

const vehicle=(fields:Partial<Vehicle>={}):Vehicle=>({id:'v1',unit:'Engine 701',type:'Type 3 Engine',year:2019,make:'International',model:'HV',vin:'1HTMMMML9KH483201',plate:'CA 8F701',status:'Ready',createdAt:'2025-02-04',...fields});
const byKey=(v:Vehicle)=>Object.fromEntries(viprFieldsFor(v).map(field=>[field.key,field]));

describe('VIPR category',()=>{
  it('guesses from the FireOps vehicle type',()=>{
    expect(guessViprCategory('Type 3 Engine')).toBe('Engine');
    expect(guessViprCategory('Water Tender')).toBe('Water Tender');
    expect(guessViprCategory('Potable Water Tender')).toBe('Potable Water Tender');
    expect(guessViprCategory('Dozer')).toBe('Dozer');
    expect(guessViprCategory('Crew Carrier')).toBe('Crew Carrier');
    expect(guessViprCategory('Command Vehicle')).toBe('Support');
  });
  it('prefers the category the owner set and ignores unknown values',()=>{
    expect(viprCategoryFor(vehicle({type:'Other',viprCategory:'Water Tender'}))).toEqual({category:'Water Tender',guessed:false});
    expect(viprCategoryFor(vehicle({viprCategory:'Spaceship'}))).toEqual({category:'Engine',guessed:true});
  });
  it('reads the engine type from the vehicle type until one is set',()=>{
    expect(engineTypeFor(vehicle())).toEqual({engineType:'Type 3',guessed:true});
    expect(engineTypeFor(vehicle({engineType:'Type 6'}))).toEqual({engineType:'Type 6',guessed:false});
    expect(engineTypeFor(vehicle({type:'Engine'}))).toEqual({guessed:false});
  });
});

describe('VIPR field mapping',()=>{
  it('flags missing pump and tank on engines and guessed values for a check',()=>{
    const fields=byKey(vehicle());
    expect(fields.category).toMatchObject({value:'Engine',status:'check'});
    expect(fields.engineType).toMatchObject({value:'Type 3',status:'check'});
    expect(fields.pump).toMatchObject({value:'—',status:'missing'});
    expect(fields.tank).toMatchObject({status:'missing'});
    expect(fields.gvwr.status).toBe('check');
    expect(fields.dailyRate.status).toBe('check');
  });
  it('maps every field once the owner fills them in',()=>{
    const fields=viprFieldsFor(vehicle({viprCategory:'Engine',engineType:'Type 3',pumpGpm:150,pumpPsi:250,tankGallons:500,gvwrLbs:26000,dailyRate:1850.5}));
    expect(fields.every(field=>field.status==='mapped')).toBe(true);
    expect(Object.fromEntries(fields.map(field=>[field.key,field.value]))).toMatchObject({pump:'150 gpm @ 250 psi',tank:'500 gal',gvwr:'26,000 lbs',dailyRate:'$1,850.50'});
  });
  it('only asks for pump and tank on categories that have them',()=>{
    const dozer=byKey(vehicle({unit:'Dozer 4',type:'Dozer'}));
    expect(dozer.pump).toBeUndefined();
    expect(dozer.tank).toBeUndefined();
    expect(dozer.engineType).toBeUndefined();
    const potable=byKey(vehicle({type:'Potable Water Tender'}));
    expect(potable.pump).toBeUndefined();
    expect(potable.tank.status).toBe('missing');
  });
  it('requires VIN and make/model/year',()=>{
    const fields=byKey(vehicle({vin:'',plate:''}));
    expect(fields.vin.status).toBe('missing');
    expect(fields.plate.status).toBe('check');
  });
  it('summarizes the export and blocks out-of-service units',()=>{
    const ready=vehicle();const out=vehicle({id:'v3',status:'Out of service'});
    expect(viprSelectableVehicles([ready,out])).toEqual({selectable:[ready],blocked:[out]});
    expect(viprExportSummary([ready])).toMatchObject({units:1,missing:2,check:4});
  });
});

describe('VIPR bid package',()=>{
  it('lists each unit in VIPR order with missing values called out',()=>{
    const text=viprBidPackageText([vehicle({pumpGpm:150,pumpPsi:250})],{companyName:'North Ridge',generatedAt:new Date(2027,0,5)});
    expect(text).toContain('Company: North Ridge');
    expect(text).toContain('Generated: 2027-01-05');
    expect(text).toContain('=== Engine 701 · Engine ===');
    expect(text).toContain('Pump capacity: 150 gpm @ 250 psi\n');
    expect(text).toContain('Tank capacity: — (missing — fill in Fleet)');
    expect(text.indexOf('Resource ID')).toBeLessThan(text.indexOf('VIN:'));
    expect(viprBidPackageFileName(new Date(2027,0,5))).toBe('fireops-vipr-bid-package-2027-01-05.txt');
  });
});

describe('VIPR form values',()=>{
  it('parses numbers and rejects bad input',()=>{
    expect(parseViprNumber('pumpGpm','1,500')).toEqual({value:1500});
    expect(parseViprNumber('dailyRate','$1,850.50')).toEqual({value:1850.5});
    expect(parseViprNumber('pumpGpm','')).toEqual({});
    expect(parseViprNumber('pumpGpm','12.5').error).toMatch(/whole number/);
    expect(parseViprNumber('tankGallons','0').error).toMatch(/between 1 and 20,000/);
    expect(parseViprNumber('dailyRate','1.234').error).toMatch(/2 decimals/);
  });
  it('round-trips the form and clears empty values',()=>{
    const values=viprFormValues({viprCategory:'Engine',pumpGpm:150});
    expect(values).toMatchObject({viprCategory:'Engine',engineType:'',pumpGpm:'150',pumpPsi:''});
    expect(parseViprForm({...values,pumpPsi:'250'})).toEqual({errors:{},fields:{viprCategory:'Engine',engineType:undefined,pumpGpm:150,pumpPsi:250,tankGallons:undefined,gvwrLbs:undefined,dailyRate:undefined}});
    expect(parseViprForm({...values,viprCategory:'Boat'}).errors.viprCategory).toBeTruthy();
  });
  it('is for owners and admins only',()=>{
    expect(canSendToVipr('owner')).toBe(true);
    expect(canSendToVipr('admin')).toBe(true);
    expect(canSendToVipr('resource_boss')).toBe(false);
    expect(canSendToVipr('fire_fighter')).toBe(false);
  });
});

describe('VIPR Intelligence entries',()=>{
  it('shows Send to VIPR to owners and admins and VIPR DPLs to everyone',()=>{
    expect(viprIntelligenceEntries('owner').map(entry=>entry.id)).toEqual(['send-to-vipr','vipr-dpls']);
    expect(viprIntelligenceEntries('admin').map(entry=>entry.id)).toEqual(['send-to-vipr','vipr-dpls']);
    for(const role of ['fire_fighter','shop_tech','accounting','resource_boss'] as const){
      expect(viprIntelligenceEntries(role).map(entry=>entry.id)).toEqual(['vipr-dpls']);
      expect(canSendToVipr(role)).toBe(false);
    }
  });
});
