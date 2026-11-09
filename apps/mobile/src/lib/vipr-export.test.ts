import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({files:new Map<string,string>(),share:vi.fn(),shareAsync:vi.fn(),available:vi.fn()}));
vi.mock('react-native',()=>({Share:{share:mocks.share}}));
vi.mock('expo-sharing',()=>({isAvailableAsync:mocks.available,shareAsync:mocks.shareAsync}));
vi.mock('expo-file-system',()=>{
  class Directory{uri:string;constructor(...parts:{uri?:string}[]|string[]){this.uri=parts.map(part=>typeof part==='string'?part:part.uri).join('/')}create(){}}
  class File{uri:string;constructor(directory:{uri:string},name:string){this.uri=`${directory.uri}/${name}`}get exists(){return mocks.files.has(this.uri)}delete(){mocks.files.delete(this.uri)}create(){mocks.files.set(this.uri,'')}write(text:string){mocks.files.set(this.uri,text)}}
  return {Directory,File,Paths:{cache:{uri:'cache'}}};
});
import {viprFieldsFor} from '@fireops/domain';
import type {FleetVehicle} from './fleet-store';
import {saveViprBidPackageFile,shareViprBidPackageText,viprVehicle} from './vipr-export';

const fleetVehicle=(source:Record<string,unknown>,fields:Partial<FleetVehicle>={}):FleetVehicle=>({id:'v1',name:'Engine 701',type:'Type 3 Engine',status:'Ready',location:null,detail:null,year:'2019',make:'International',model:'HV',vin:'1HTMMMML9KH483201',plate:'CA 8F701',assignedTo:null,notes:null,inspections:[],photo:null,documents:[],files:[],updatedAt:null,source,...fields});
beforeEach(()=>{vi.clearAllMocks();mocks.files.clear();mocks.available.mockResolvedValue(true)});

describe('mobile VIPR export',()=>{
  it('maps the stored fleet record, including the VIPR fields, onto the shared mapping',()=>{
    const vehicle=viprVehicle(fleetVehicle({id:'v1',createdAt:'2025-02-04',viprCategory:'Engine',engineType:'Type 3',pumpGpm:150,pumpPsi:250,tankGallons:500,gvwrLbs:26000,dailyRate:1850}));
    expect(vehicle).toMatchObject({unit:'Engine 701',year:2019,status:'Ready',pumpGpm:150});
    expect(viprFieldsFor(vehicle).every(field=>field.status==='mapped')).toBe(true);
    expect(viprVehicle(fleetVehicle({},{year:null,status:'Out of service'}))).toMatchObject({year:0,status:'Out of service'});
  });
  it('shares the package as text or saves it as a .txt file',async()=>{
    await shareViprBidPackageText('package');
    expect(mocks.share).toHaveBeenCalledWith({message:'package',title:'VIPR bid package'});
    const uri=await saveViprBidPackageFile('package','fireops-vipr-bid-package-2027-01-05.txt');
    expect(uri).toBe('cache/vipr-exports/fireops-vipr-bid-package-2027-01-05.txt');
    expect(mocks.files.get(uri)).toBe('package');
    expect(mocks.shareAsync).toHaveBeenCalledWith(uri,expect.objectContaining({mimeType:'text/plain'}));
  });
  it('reports when sharing is unavailable',async()=>{
    mocks.available.mockResolvedValue(false);
    await expect(saveViprBidPackageFile('package','x.txt')).rejects.toThrow(/Sharing is unavailable/);
  });
});
