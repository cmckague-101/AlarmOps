import {afterEach,describe,expect,it,vi} from 'vitest';
import {createClient} from '@supabase/supabase-js';
import {readFileSync} from 'node:fs';
import {createDemoDispatchData,createDemoNationalFireActivity} from '@fireops/domain';
import {createDemoClient} from './demo-client';
import {demoUser} from './demo-backend';

const sessions:ReturnType<typeof createDemoClient>[]=[];
function demo(id='demo-company-test'){
  const session=createDemoClient(id);
  sessions.push(session);
  return session;
}
afterEach(()=>{sessions.splice(0).forEach(session=>session.dispose());vi.unstubAllGlobals()});

describe('native demo client',()=>{
  it('searches demo FedRooms hotels with region filters and or/ilike',async()=>{
    const {client}=demo();
    const search=await client.from('fedrooms_hotels').select('name').or('name.ilike.*redding*,city.ilike.*redding*').order('name');
    expect(search.data?.map(row=>row.name)).toEqual(['Courtyard Redding','Hampton Inn & Suites Redding']);
    const cities=await client.from('fedrooms_hotel_cities').select('city').eq('country','United States').eq('state','Oregon');
    expect(cities.data?.map(row=>row.city)).toEqual(['Medford']);
  });
  it('loads seeded native records without network or an authenticated account',async()=>{
    const network=vi.fn(()=>{throw new Error('Demo must not access the network')});
    vi.stubGlobal('fetch',network);
    const {client}=demo();
    const fleet=await client.from('fleet_vehicles').select('*').eq('company_id','demo-company-test');
    expect(fleet.error).toBeNull();
    expect(fleet.data).toHaveLength(3);
    expect((await client.auth.getSession()).data.session).toBeNull();
    const payroll=await client.from('payroll_forms').select('*').single();
    expect(payroll.data?.rows.length).toBeGreaterThan(0);
    const motive=await client.functions.invoke('motive-integration',{body:{action:'sync'}});
    expect(motive.data).toMatchObject({connected:false,mock:true});
    expect(network).not.toHaveBeenCalled();
  });

  it('serves static national fire activity and seeded USFS tables without network',async()=>{
    const network=vi.fn(()=>{throw new Error('Demo must not access the network')});
    vi.stubGlobal('fetch',network);
    const {client}=demo();
    const activity=await client.functions.invoke('national-fire-activity');
    expect(activity.error).toBeNull();
    expect(activity.data).toEqual(createDemoNationalFireActivity());
    const areas=await client.from('usfs_geographic_areas').select('id,name').eq('is_active',true).order('name');
    expect(areas.data).toMatchObject([{id:1,name:'Northern California'}]);
    const centers=await client.from('usfs_dispatch_centers').select('*').eq('geographic_area_id',1).eq('is_active',true);
    expect(centers.data).toHaveLength(1);
    const lists=await client.from('usfs_priority_lists').select('*').eq('dispatch_center_id',101).eq('is_active',true).in('sync_status',['complete','partial']).order('published_at',{ascending:false});
    expect(lists.data?.map(row=>row.file_id)).toEqual([1001,1002]);
    const fixtures=createDemoDispatchData();
    for(const list of lists.data??[]){
      const entries=await client.from('usfs_dispatch_entries').select('*').eq('priority_list_file_id',list.file_id).order('rank');
      expect(entries.error).toBeNull();
      expect(entries.data).toMatchObject(fixtures.entries[String(list.file_id)]);
    }
    expect(network).not.toHaveBeenCalled();
  });

  it('bundles identical web fleet photos and seeds resolvable local photo paths',async()=>{
    const {client}=demo();
    const vehicles=await client.from('fleet_vehicles').select('*');
    const mapping=readFileSync(new URL('./demo-fleet-images.ts',import.meta.url),'utf8');
    for(const row of vehicles.data??[]){
      const {name,path,type}=row.data.photo;
      expect(type).toBe('image/webp');
      expect(path).toBe(`demo-fleet/${name}`);
      expect(mapping).toContain(`'${path}':require('../../assets/demo-vehicles/${name}')`);
      const bundled=readFileSync(new URL(`../../assets/demo-vehicles/${name}`,import.meta.url));
      const web=readFileSync(new URL(`../../../web/public/demo-vehicles/${name}`,import.meta.url));
      expect(bundled.equals(web)).toBe(true);
    }
  });

  it('supports fleet edits, optimistic versions, local subscriptions, and deletes',async()=>{
    const {client}=demo();
    const changed=vi.fn();
    const channel=client.channel('test').on('postgres_changes',{event:'*',schema:'public',table:'fleet_vehicles'},changed).subscribe();
    const save=await client.rpc('apply_fleet_changes',{target_company_id:'demo-company-test',changes:[{collection:'vehicles',event:'update',recordId:'demo-engine',data:{id:'demo-engine',unit:'Edited engine',status:'Ready'},expectedVersion:1}]});
    expect(save.error).toBeNull();
    expect(save.data[0].version).toBe(2);
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({eventType:'UPDATE',new:expect.objectContaining({record_id:'demo-engine',version:2})}));
    const loaded=await client.from('fleet_vehicles').select('*').eq('record_id','demo-engine').single();
    expect(loaded.data?.data.unit).toBe('Edited engine');
    await client.rpc('apply_fleet_changes',{changes:[{collection:'vehicles',event:'delete',recordId:'demo-engine',expectedVersion:2}]});
    expect((await client.from('fleet_vehicles').select('*')).data).toHaveLength(2);
    await client.removeChannel(channel);
  });

  it('rejects stale fleet versions atomically',async()=>{
    const {client}=demo();
    const result=await client.rpc('apply_fleet_changes',{changes:[
      {collection:'vehicles',event:'delete',recordId:'demo-engine',expectedVersion:1},
      {collection:'vehicles',event:'delete',recordId:'demo-tender',expectedVersion:999},
    ]});
    expect(result.error?.code).toBe('40001');
    expect((await client.from('fleet_vehicles').select('*')).data).toHaveLength(3);
  });

  it('lets the restored live client clean up demo channels without a socket',async()=>{
    const {client}=demo();
    const channel=client.channel('demo').on('postgres_changes',{event:'*',schema:'public',table:'fleet_vehicles'},vi.fn()).subscribe();
    const live=createClient('https://live.invalid','public-key',{auth:{persistSession:false,autoRefreshToken:false}});
    expect(await live.removeChannel(channel)).toBe('ok');
  });

  it('supports create, update, upsert, and delete using the production query API',async()=>{
    const {client}=demo();
    const created=await client.from('company_trainings').insert({course_title:'Local course'}).select('*').single();
    expect(created.error).toBeNull();
    const id=created.data!.id;
    const updated=await client.from('company_trainings').update({course_title:'Edited'}).eq('id',id).select('*').single();
    expect(updated.data?.course_title).toBe('Edited');
    await client.from('company_trainings').upsert({id,course_title:'Upserted'});
    expect((await client.from('company_trainings').select('*').eq('id',id).single()).data?.course_title).toBe('Upserted');
    await client.from('company_trainings').delete().eq('id',id);
    expect((await client.from('company_trainings').select('*').eq('id',id)).data).toEqual([]);
  });

  it('keeps composite read markers unique and handles count/head queries',async()=>{
    const {client}=demo();
    const marker={company_id:'demo-company-test',thread_id:'demo-thread',user_id:demoUser.id,seen_at:new Date().toISOString()};
    await client.from('communication_reads').upsert(marker,{onConflict:'thread_id,user_id'});
    await client.from('communication_reads').upsert(marker,{onConflict:'thread_id,user_id'});
    const result=await client.from('communication_reads').select('*',{count:'exact',head:true});
    expect(result.count).toBe(1);
  });

  it('checks inventory out and in locally and updates qualifications',async()=>{
    const {client}=demo();
    expect((await client.rpc('checkout_inventory_item',{target_item_id:'demo-radio',checkout_quantity:2})).error).toBeNull();
    expect((await client.from('company_inventory_checkouts').select('*').single()).data?.quantity).toBe(2);
    expect((await client.from('company_inventory_items').select('*').eq('id','demo-radio').single()).data?.quantity).toBe(10);
    expect((await client.rpc('checkin_inventory_item',{target_item_id:'demo-radio',borrower_user_id:demoUser.id,checkin_quantity:2})).error).toBeNull();
    expect((await client.from('company_inventory_checkouts').select('*')).data).toEqual([]);
    expect((await client.from('company_inventory_items').select('*').eq('id','demo-radio').single()).data?.quantity).toBe(12);
    await client.rpc('add_my_crew_credential',{credential:{id:'local',name:'Demo training'}});
    const member=await client.from('fleet_crew').select('*').eq('record_id',demoUser.id).single();
    expect(member.data?.data.credentials).toContainEqual({id:'local',name:'Demo training'});
  });

  it('blocks uploads, invitations, feedback, auth, and unsupported RPCs without network',async()=>{
    const network=vi.fn(()=>{throw new Error('Unexpected network')});
    vi.stubGlobal('fetch',network);
    const {client}=demo();
    expect((await client.storage.from('fleet-files').upload('demo/file.txt','sample')).error).toBeTruthy();
    expect((await client.functions.invoke('invite-company-member',{body:{email:'test@example.com'}})).error?.message).toContain('disabled in demo mode');
    expect((await client.from('app_feedback').insert({message:'Do not send'})).error?.message).toContain('disabled');
    expect((await client.auth.signInWithPassword({email:'test@example.com',password:'test'})).error).toBeTruthy();
    expect((await client.rpc('register_push_token',{})).error).toBeTruthy();
    expect(network).not.toHaveBeenCalled();
  });

  it('discards changes on exit, isolates companies, and rejects stale requests',async()=>{
    const first=demo('demo-company-first');
    await first.client.from('fleet_vehicles').delete().eq('record_id','demo-engine');
    const staleQuery=first.client.from('company_trainings').insert({course_title:'Late write'});
    first.dispose();
    expect((await staleQuery).error?.message).toContain('ended');
    const second=demo('demo-company-second');
    expect((await second.client.from('fleet_vehicles').select('*')).data).toHaveLength(3);
    expect((await second.client.from('fleet_vehicles').select('*').eq('company_id','demo-company-first')).data).toEqual([]);
    expect((await second.client.from('company_trainings').select('*')).data).toHaveLength(1);
  });
});
