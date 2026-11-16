import {assertEquals,assertMatch} from 'jsr:@std/assert@1';
import {fleetCategories,mapSamOpportunities,samSearchUrl} from './logic.ts';

Deno.test('derives and deduplicates fleet matching categories',()=>{
  assertEquals(fleetCategories([
    {data:{type:'Type 3 Engine',viprCategory:'Engine'}},
    {data:{type:'Water Tender'}},
    {data:{type:'Type 6 Engine',viprCategory:'Engine'}},
  ]).map(item=>item.label),['Engine','Water Tender']);
});

Deno.test('maps only active SAM opportunities matched to fleet and creates direct links',()=>{
  const categories=fleetCategories([{data:{type:'Water Tender'}},{data:{type:'Dozer'}}]);
  const result=mapSamOpportunities([
    {noticeId:'abc 123',title:'VIPR water tender solicitation',type:'Solicitation',active:'Yes',postedDate:'2026-11-03',responseDeadLine:'2026-12-01',placeOfPerformance:{city:{name:'Boise'},state:{code:'ID'}}},
    {noticeId:'other',title:'Office furniture',type:'Solicitation',active:'Yes',postedDate:'2026-11-04'},
    {noticeId:'old',title:'Dozer services',active:'No',postedDate:'2026-11-05'},
  ],categories);
  assertEquals(result.length,1);
  assertEquals(result[0].matchedFleetCategories,['Water Tender']);
  assertEquals(result[0].placeOfPerformance,'Boise, ID');
  assertEquals(result[0].sourceUrl,'https://sam.gov/opp/abc%20123/view');
});

Deno.test('builds bounded official SAM search request',()=>{
  const url=samSearchUrl('secret',new Date('2026-11-16T12:00:00Z'));
  assertEquals(url.origin,'https://api.sam.gov');
  assertEquals(url.searchParams.get('postedFrom'),'08/18/2026');
  assertEquals(url.searchParams.get('postedTo'),'11/16/2026');
  assertEquals(url.searchParams.get('organizationName'),'FOREST SERVICE');
  assertEquals(url.searchParams.getAll('ptype'),['o','k','p','r','s']);
  assertMatch(url.toString(),/api_key=secret/);
});
