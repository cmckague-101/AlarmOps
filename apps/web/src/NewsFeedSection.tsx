import {useCallback,useEffect,useState} from 'react';
import {ChevronDown,ChevronRight,ExternalLink,RefreshCw,Star} from 'lucide-react';
import {
  createDemoContractingNewsFeed,createDemoNationalFireActivity,curatedNewsStories,
  type ContractingNewsFeed,type NationalFireActivity,type NewsFeedCategory,type NewsStory,
} from '@fireops/domain';
import {supabase} from './supabase';
import NationalFireActivitySection from './NationalFireActivitySection';
import './NewsFeedSection.css';

const storyImages:Record<NewsStory['image'],string>={nwcg:'/news/nwcg-crew.jpg',fire_science:'/news/fire-science.jpg',outlook:'/news/featured-sunset.jpg'};
const categories:{id:NewsFeedCategory;label:string}[]=[{id:'all',label:'All'},{id:'nwcg',label:'NWCG'},{id:'contracting',label:'Contracting'},{id:'fire_science',label:'Fire Science'}];

function NewsFeedMetrics({activity}:{activity:NationalFireActivity|null}){
  const value=(number:number|null|undefined)=>number===null||number===undefined?'—':number.toLocaleString();
  return <section className="news-metrics" aria-label="Current national fire conditions">
    <div><span>National PL</span><strong className="news-metric-pl">{value(activity?.nationalPreparednessLevel)}</strong></div>
    <div><span>Large Fires</span><strong>{value(activity?.largeFireCount)}</strong></div>
    <div><span>Red Flags</span><strong className="news-metric-flags">{value(activity?.redFlagCount)}</strong></div>
  </section>;
}

function FeaturedStory({activity}:{activity:NationalFireActivity|null}){
  const pl=activity?.nationalPreparednessLevel;
  const fires=activity?.largeFireCount;
  const headline=pl?`National preparedness level ${pl}${fires===null||fires===undefined?'':` · ${fires} active large ${fires===1?'fire':'fires'}`}`:'Latest national fire activity';
  return <a className="news-featured" href="https://www.nifc.gov/fire-information/nfn" target="_blank" rel="noreferrer">
    <img src="/news/featured-sunset.jpg" alt=""/>
    <span className="news-featured-shade"/>
    <span className="news-featured-copy"><span className="news-source-badge">NIFC</span><h2>{headline}</h2><span>nifc.gov · Open <ExternalLink/></span></span>
  </a>;
}

function StoryCards({filter}:{filter:NewsFeedCategory}){
  const stories=filter==='all'?curatedNewsStories:curatedNewsStories.filter(story=>story.category===filter);
  if(!stories.length)return null;
  return <ul className="news-story-grid">{stories.map(story=><li key={story.id}><a href={story.href} target="_blank" rel="noreferrer">
    <span className="news-story-image"><img src={storyImages[story.image]} alt=""/></span>
    <span className="news-story-copy"><span className={`news-source-badge ${story.category}`}>{story.source}</span><h3>{story.headline}</h3><p>{story.summary}</p><span className="news-story-open">Official source <ExternalLink/></span></span>
  </a></li>)}</ul>;
}

function opportunityDetail(item:ContractingNewsFeed['opportunities'][number]){
  if(item.matchedFleetCategories.length)return `${item.matchedFleetCategories.join(' / ')} matched to your Fleet`;
  if(item.responseDeadline){
    const date=new Date(item.responseDeadline.length===10?`${item.responseDeadline}T12:00:00`:item.responseDeadline);
    return `Closes ${Number.isNaN(date.getTime())?item.responseDeadline:date.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`;
  }
  return item.agency;
}

export default function NewsFeedSection({companyId,demoMode=false}:{companyId?:string;demoMode?:boolean}){
  const [activity,setActivity]=useState<NationalFireActivity|null>(()=>demoMode?createDemoNationalFireActivity():null);
  const [filter,setFilter]=useState<NewsFeedCategory>('all');
  const [feed,setFeed]=useState<ContractingNewsFeed|null>(()=>demoMode?createDemoContractingNewsFeed():null);
  const [open,setOpen]=useState(false);
  const [loading,setLoading]=useState(!demoMode);
  const [error,setError]=useState('');
  useEffect(()=>{
    if(demoMode){setActivity(createDemoNationalFireActivity());return}
    let active=true;
    if(!supabase)return;
    void supabase.functions.invoke<NationalFireActivity>('national-fire-activity').then(({data})=>{if(active&&data)setActivity(data)}).catch(()=>undefined);
    return()=>{active=false};
  },[demoMode]);
  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      if(demoMode){setFeed(createDemoContractingNewsFeed());return}
      if(!companyId)throw new Error('Company is not available.');
      if(!supabase)throw new Error('FireOps data service is not configured.');
      const {data,error:failure}=await supabase.functions.invoke<ContractingNewsFeed>('news-feed',{body:{companyId}});
      if(failure)throw failure;
      if(!data)throw new Error('SAM.gov returned no news feed data.');
      setFeed(data);
    }catch(failure){setError((failure as {message?:string}).message??'Contracting opportunities could not be loaded.');}
    finally{setLoading(false)}
  },[companyId,demoMode]);
  useEffect(()=>{void load()},[load]);
  const count=feed?.opportunities.length??0;
  const showContracting=filter==='all'||filter==='contracting';
  return <div className="news-feed-content">
    <NewsFeedMetrics activity={activity}/>
    <FeaturedStory activity={activity}/>
    <div className="news-filters" role="tablist" aria-label="News categories">{categories.map(category=><button key={category.id} type="button" role="tab" aria-selected={filter===category.id} className={filter===category.id?'active':''} onClick={()=>{setFilter(category.id);if(category.id==='contracting')setOpen(true)}}>{category.label}</button>)}</div>
    {showContracting&&<section className={`news-alerts${open?' open':''}`} aria-labelledby="news-contracting-title">
      <div className="news-alerts-heading">
        <button type="button" className="news-alerts-toggle" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
          <span className="news-alerts-icon"><Star/></span>
          <span className="news-alerts-copy"><b id="news-contracting-title">{loading&&!feed?'Checking contracting alerts…':`${count} contracting ${count===1?'alert':'alerts'}`}</b><small>{demoMode?'Demo samples · matched to your Fleet categories':'Live SAM.gov notices matched to your Fleet categories'}</small></span>
          <ChevronDown className="news-alerts-chevron"/>
        </button>
        <button type="button" className="news-alerts-refresh" aria-label="Refresh contracting alerts" onClick={()=>void load()} disabled={loading}><RefreshCw className={loading?'spin':''}/></button>
      </div>
      {open&&<>
        {error&&<div className="news-alerts-state" role="alert"><span><b>Contracting feed unavailable</b><small>{error}</small></span><button type="button" onClick={()=>void load()}>Try again</button></div>}
        {feed&&!error&&count===0&&<div className="news-alerts-state"><span><b>No matching opportunities</b><small>No active Forest Service notices match your current Fleet.</small></span></div>}
        {feed&&!error&&count>0&&<ul className="news-alerts-list">{feed.opportunities.map(item=><li key={item.id}>{demoMode?<div className="news-alert-row"><span><b>{item.title}</b><small>{opportunityDetail(item)}</small></span><ChevronRight/></div>:<a className="news-alert-row" href={item.sourceUrl} target="_blank" rel="noreferrer"><span><b>{item.title}</b><small>{opportunityDetail(item)}</small></span><ChevronRight/></a>}</li>)}</ul>}
        {feed&&!demoMode&&!error&&<footer>Updated {new Date(feed.fetchedAt).toLocaleString()} · <a href={feed.sourceUrl} target="_blank" rel="noreferrer">SAM.gov <ExternalLink/></a></footer>}
      </>}
    </section>}
    {filter!=='contracting'&&<StoryCards filter={filter}/>}
    <NationalFireActivitySection demoMode={demoMode}/>
  </div>;
}
