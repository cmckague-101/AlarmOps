import {assignNewsImages,type NewsImageName} from './news-images';

export type NewsFeedCategory='all'|'nwcg'|'contracting'|'fire_science';

export type NewsStory={
  id:string;category:Exclude<NewsFeedCategory,'all'|'contracting'>;source:string;headline:string;summary:string;href:string;
};

export const curatedNewsStories:ReadonlyArray<NewsStory>=[
  {id:'nwcg-announcements',category:'nwcg',source:'NWCG',headline:'Latest NWCG announcements and notices',summary:'Committee updates, safety notices, publications, and wildland fire coordination announcements.',href:'https://www.nwcg.gov/nwcg-alerts'},
  {id:'nifc-outlooks',category:'nwcg',source:'NIFC Outlook',headline:'Significant fire potential outlooks',summary:'Current monthly and seasonal outlooks from NIFC Predictive Services.',href:'https://www.nifc.gov/nicc/predictive-services/outlooks'},
  {id:'jfsp-news',category:'fire_science',source:'Fire Science',headline:'Joint Fire Science Program news and research',summary:'Research updates, science partnerships, publications, and learning opportunities.',href:'https://www.firescience.gov/ords/prd/jf_jfsp/jf_jfsp/r/jfspublic/jfsp-newsletter'},
  {id:'wildfire-lessons',category:'fire_science',source:'Wildland Fire Lessons Learned',headline:'Incident learning and operational lessons',summary:'Field learning, incident reviews, and lessons shared across the wildland fire community.',href:'https://www.wildfirelessons.net/'},
];

export type ContractingOpportunity={
  id:string;
  title:string;
  solicitationNumber:string|null;
  noticeType:string;
  agency:string;
  office:string|null;
  postedAt:string;
  responseDeadline:string|null;
  naicsCode:string|null;
  setAside:string|null;
  placeOfPerformance:string|null;
  matchedFleetCategories:string[];
  sourceUrl:string;
};

export type ContractingNewsFeed={
  fetchedAt:string;
  fleetCategories:string[];
  sourceUrl:string;
  opportunities:ContractingOpportunity[];
};

export function createDemoContractingNewsFeed():ContractingNewsFeed{
  return {
    fetchedAt:new Date().toISOString(),
    fleetCategories:['Engine','Water Tender','Dozer'],
    sourceUrl:'https://sam.gov/opportunities',
    opportunities:[
      {
        id:'demo-vipr-engine',title:'VIPR preseason solicitation · engines and heavy equipment',solicitationNumber:'DEMO-VIPR-ENGINE',noticeType:'Solicitation',agency:'USDA Forest Service',office:'Incident Procurement',postedAt:'2026-11-03',responseDeadline:'2026-12-15',naicsCode:'115310',setAside:'Total Small Business',placeOfPerformance:'Multiple western regions',matchedFleetCategories:['Engine','Dozer'],sourceUrl:'https://sam.gov/opportunities',
      },
      {
        id:'demo-vipr-water',title:'Sources sought · tactical and support water tenders',solicitationNumber:'DEMO-VIPR-WATER',noticeType:'Sources Sought',agency:'USDA Forest Service',office:'Incident Procurement',postedAt:'2026-11-01',responseDeadline:'2026-11-28',naicsCode:'115310',setAside:null,placeOfPerformance:'Intermountain Region',matchedFleetCategories:['Water Tender'],sourceUrl:'https://sam.gov/opportunities',
      },
    ],
  };
}

/**
 * Photos for the news screen. Curated stories go first so their photos never shift when the featured
 * headline changes. Pass `null` until national activity loads so the featured photo doesn't swap a
 * moment after the screen opens.
 */
export function newsFeedImages(featuredHeadline:string|null):{stories:Record<string,NewsImageName>;featured:NewsImageName|null}{
  const keys=curatedNewsStories.map(story=>story.id);
  const images=assignNewsImages(featuredHeadline===null?keys:[...keys,`featured:${featuredHeadline}`]);
  return {stories:Object.fromEntries(keys.map((key,index)=>[key,images[index]])),featured:featuredHeadline===null?null:images[keys.length]};
}
