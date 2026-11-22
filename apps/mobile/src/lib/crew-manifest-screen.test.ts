import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

// Source-level wiring checks, following the mobile screen regression-test pattern.
// Pure manifest/fleet behavior is covered in crew-manifest.test.ts.
const screen=readFileSync(new URL('../app/crew/manifest.tsx',import.meta.url),'utf8');
const roster=readFileSync(new URL('../app/crew.tsx',import.meta.url),'utf8');

describe('manifest screen permissions',()=>{
  it('gates both the roster entry and direct route with the same permission helper',()=>{
    expect(roster).toContain('const canManifest=Boolean(member&&canCreateCrewManifest(member.user.role))');
    expect(roster).toMatch(/\{canManifest\?<Pressable/);
    expect(screen).toContain('const allowed=Boolean(member&&canCreateCrewManifest(member.user.role))');
    expect(screen).toContain('if(!allowed)return <Redirect href="/(tabs)/more"/>');
    expect(screen.indexOf('if(!allowed)return')).toBeLessThan(screen.indexOf('const addFromRoster='));
  });
  it('redirects unauthenticated or failed-access sessions before the manifest is rendered',()=>{
    expect(screen).toContain('if(!session||access.status===\'error\')return <Redirect href="/"/>');
  });
});

describe('manifest screen demo isolation',()=>{
  it('allows demo fleet options only when the session is in demo mode',()=>{
    expect(screen).toContain('fleetOptionsForManifest(fromApp,demoMode)');
    expect(screen).not.toContain('demoMode||fromApp.length===0');
  });
  it('does not expose a Load Ashley / Load demo button',()=>{
    expect(screen).not.toMatch(/Load demo|Load Ashley|Ashley NF RX demo/i);
    expect(screen).not.toContain('setManifest(createAshleyNfRxDemoManifest())');
  });
});

describe('manifest screen phone UX + export gates',()=>{
  it('requires explicit contacts before Create PDF / Share',()=>{
    expect(screen).toContain('hasManifestContacts(manifest)');
    expect(screen).toContain('Select a Crew Coordinator and Dispatch Center before exporting.');
  });
  it('uses modal pickers and avoids meta count boxes',()=>{
    expect(screen).toContain("type PickerMode='roster'|'fleet'|'coordinator'|'dispatch'|null");
    expect(screen).not.toMatch(/sectionCount|Crew listed|With qualifications/);
  });
  it('labels vehicles Fleet ID and Manifest Notes',()=>{
    expect(screen).toContain('Fleet ID');
    expect(screen).toContain('Manifest Notes');
    expect(screen).not.toContain('FIR #');
  });
});
