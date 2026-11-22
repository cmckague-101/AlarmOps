import {describe,expect,it} from 'vitest';
import {addDispatchCenter,createAshleyNfRxDemoManifest,emptyCrewManifest} from './crew-manifest';
import {createManifestPrintHtml,manifestPdfFileName,manifestPrintStyles,OPS_CLEAN} from './manifest-print';

describe('manifest print Ops Clean',()=>{
  it.each(['live','demo'] as const)('prints only explicitly selected contacts in %s manifests',mode=>{
    const manifest=mode==='live'?emptyCrewManifest('Test Company'):createAshleyNfRxDemoManifest();
    const html=()=>createManifestPrintHtml(manifest,{name:'Test Company'});
    expect(html()).not.toMatch(/Christopher Hansen|995-1385|Boise Dispatch|384-3400/);
    expect(manifest.dispatchCenters).toEqual([]);
    const added=addDispatchCenter(manifest.dispatchCenters,{name:'Boise Dispatch',phone:'(208) 384-3400'});
    expect(added).not.toBeNull();
    manifest.dispatchCenters=added!.centers;
    manifest.handCrewCoordinator={personId:'crew-1',name:'Selected Coordinator',phone:'555-0100'};
    manifest.selectedDispatchCenterId=added!.added.id;
    expect(html()).toContain('Selected Coordinator');
    expect(html()).toContain('555-0100');
    expect(html()).toContain('Boise Dispatch');
    manifest.handCrewCoordinator={personId:'',name:'',phone:''};
    manifest.selectedDispatchCenterId='';
    expect(html()).not.toContain('Selected Coordinator');
    expect(html()).not.toContain('Boise Dispatch');
    manifest.selectedDispatchCenterId='missing-dispatch';
    expect(html()).not.toContain('Boise Dispatch');
  });
  it('ships FireCo red/black/white tokens and Fleet ID column',()=>{
    const css=manifestPrintStyles();
    expect(css).toContain(OPS_CLEAN.red);
    expect(css).toContain(OPS_CLEAN.black);
    expect(css).toContain('IBM Plex Sans');
    expect(css).toContain('company-stamp');
  });

  it('stamps company profile and avoids FireOps product branding',()=>{
    const demo=createAshleyNfRxDemoManifest(new Date('2026-11-20T12:00:00-08:00'));
    const html=createManifestPrintHtml(demo,{
      name:'FireCo LLC',
      phone:'(208) 861-7464',
      location:'Boise, ID',
      ownerName:'Clint McCaig',
      ownerEmail:'Clint@firecollc.com',
      logoDataUrl:'data:image/png;base64,abc',
    });
    expect(html).toContain('Company identification');
    expect(html).toContain('FireCo LLC');
    expect(html).toContain('Clint McCaig');
    expect(html).toContain('Clint@firecollc.com');
    expect(html).toContain('data:image/png;base64,abc');
    expect(html).toContain('Fleet ID');
    expect(html).toContain('Manifest Notes');
    expect(html).toContain('Crew Coordinator');
    expect(html).toContain('Dispatch Center');
    expect(html).toContain('FireCo personnel manifest');
    expect(html).not.toMatch(/FireOps/i);
    expect(html).not.toContain('FIR #');
    expect(manifestPdfFileName({name:'FireCo LLC'},demo)).toMatch(/^FireCo-LLC-/);
  });
});
