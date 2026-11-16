import {useEffect,useMemo,useState,type ReactNode} from 'react';
import {createDemoNationalFireActivity,curatedNewsStories,type NationalFireActivity,type NewsFeedCategory,type NewsStory} from '@fireops/domain';
import {Image,Linking,Pressable,StyleSheet,Text,View} from 'react-native';
import {AppSymbol} from './app-symbol';
import {supabase} from '@/lib/supabase';
import {useSession} from '@/providers/session-provider';
import {type FireOpsTheme,useFireOpsTheme} from '@/theme';

const images:Record<NewsStory['image'],number>={
  nwcg:require('../../assets/news/nwcg-crew.jpg'),
  fire_science:require('../../assets/news/fire-science.jpg'),
  outlook:require('../../assets/news/featured-sunset.jpg'),
};
const featuredImage=require('../../assets/news/featured-sunset.jpg');
const categories:{id:NewsFeedCategory;label:string}[]=[{id:'all',label:'All'},{id:'nwcg',label:'NWCG'},{id:'contracting',label:'Contracting'},{id:'fire_science',label:'Fire Science'}];

export function NewsFeedStories({contracting}:{contracting:ReactNode}){
  const theme=useFireOpsTheme();
  const styles=useMemo(()=>createStyles(theme),[theme]);
  const {demoMode}=useSession();
  const [filter,setFilter]=useState<NewsFeedCategory>('all');
  const [activity,setActivity]=useState<NationalFireActivity|null>(()=>demoMode?createDemoNationalFireActivity():null);
  useEffect(()=>{
    if(demoMode){setActivity(createDemoNationalFireActivity());return}
    let active=true;
    if(!supabase)return;
    void supabase.functions.invoke<NationalFireActivity>('national-fire-activity').then(({data})=>{if(active&&data)setActivity(data)}).catch(()=>undefined);
    return()=>{active=false};
  },[demoMode]);
  const pl=activity?.nationalPreparednessLevel;
  const fires=activity?.largeFireCount;
  const headline=pl?`National preparedness level ${pl}${fires===null||fires===undefined?'':` · ${fires} active large ${fires===1?'fire':'fires'}`}`:'Latest national fire activity';
  const stories=filter==='all'?curatedNewsStories:curatedNewsStories.filter(story=>story.category===filter);
  return <>
    <Pressable accessibilityRole="link" onPress={()=>void Linking.openURL('https://www.nifc.gov/fire-information/nfn')} style={({pressed})=>[styles.featured,pressed&&styles.pressed]}>
      <Image source={featuredImage} style={styles.featuredImage}/><View style={styles.featuredShade}/><View style={styles.featuredCopy}><Text style={styles.featuredBadge}>NIFC</Text><Text style={styles.featuredTitle}>{headline}</Text><View style={styles.openRow}><Text style={styles.featuredMeta}>nifc.gov · Open</Text><AppSymbol name={{ios:'arrow.up.right.square',android:'open_in_new'} as never} color="#fff" size={14}/></View></View>
    </Pressable>
    <View accessibilityRole="tablist" style={styles.filters}>{categories.map(category=><Pressable key={category.id} accessibilityRole="tab" accessibilityState={{selected:filter===category.id}} onPress={()=>setFilter(category.id)} style={[styles.filter,filter===category.id&&styles.filterActive]}><Text style={[styles.filterText,filter===category.id&&styles.filterTextActive]}>{category.label}</Text></Pressable>)}</View>
    {filter==='all'||filter==='contracting'?contracting:null}
    {filter!=='contracting'?<View style={styles.cards}>{stories.map(story=><Pressable key={story.id} accessibilityRole="link" onPress={()=>void Linking.openURL(story.href)} style={({pressed})=>[styles.card,pressed&&styles.pressed]}>
      <Image source={images[story.image]} style={styles.cardImage}/><View style={styles.cardCopy}><Text style={[styles.badge,story.category==='fire_science'&&styles.badgeScience]}>{story.source}</Text><Text style={styles.cardTitle}>{story.headline}</Text><Text style={styles.cardSummary}>{story.summary}</Text><View style={styles.sourceRow}><Text style={styles.sourceText}>Official source</Text><AppSymbol name={{ios:'arrow.up.right.square',android:'open_in_new'} as never} color={theme.ember} size={14}/></View></View>
    </Pressable>)}</View>:null}
  </>;
}

function createStyles(theme:FireOpsTheme){return StyleSheet.create({
  featured:{height:270,overflow:'hidden',justifyContent:'flex-end',marginBottom:20,borderRadius:16,backgroundColor:theme.command},featuredImage:{position:'absolute',inset:0,width:'100%',height:'100%'},featuredShade:{position:'absolute',inset:0,backgroundColor:'rgba(9,13,15,.48)'},featuredCopy:{padding:22},featuredBadge:{alignSelf:'flex-start',overflow:'hidden',paddingVertical:5,paddingHorizontal:8,borderRadius:7,backgroundColor:'rgba(105,42,26,.9)',color:'#fff',fontSize:10,fontWeight:'800'},featuredTitle:{maxWidth:570,marginTop:13,color:'#fff',fontSize:25,lineHeight:31,fontWeight:'800'},openRow:{flexDirection:'row',alignItems:'center',gap:5,marginTop:12},featuredMeta:{color:'rgba(255,255,255,.86)',fontSize:12,fontWeight:'700'},filters:{flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:20},filter:{minHeight:42,alignItems:'center',justifyContent:'center',paddingHorizontal:15,borderWidth:1,borderColor:theme.divider,borderRadius:22,backgroundColor:theme.paper},filterActive:{borderColor:theme.ember,backgroundColor:theme.ember},filterText:{color:theme.ink,fontSize:12,fontWeight:'800'},filterTextActive:{color:'#fff'},cards:{gap:16,marginBottom:20},card:{overflow:'hidden',borderWidth:1,borderColor:theme.divider,borderRadius:15,backgroundColor:theme.paper},cardImage:{width:'100%',height:180,backgroundColor:theme.surfaceAlt},cardCopy:{alignItems:'flex-start',padding:17},badge:{overflow:'hidden',paddingVertical:5,paddingHorizontal:8,borderRadius:7,backgroundColor:theme.blueSurface,color:theme.blue,fontSize:10,fontWeight:'800',textTransform:'uppercase'},badgeScience:{backgroundColor:theme.greenSurface,color:theme.green},cardTitle:{marginTop:11,color:theme.ink,fontSize:17,lineHeight:23,fontWeight:'800'},cardSummary:{marginTop:7,color:theme.secondary,fontSize:13,lineHeight:20},sourceRow:{flexDirection:'row',alignItems:'center',gap:5,marginTop:14},sourceText:{color:theme.ember,fontSize:12,fontWeight:'800'},pressed:{opacity:.68}
});}
