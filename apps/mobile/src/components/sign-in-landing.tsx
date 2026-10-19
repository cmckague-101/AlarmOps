import {useRef,useState,type PropsWithChildren} from 'react';
import {Image,KeyboardAvoidingView,Linking,Platform,Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {BrandWordmark} from '@/components/brand-wordmark';
import {useFireOpsTheme} from '@/theme';

const features=[
  {name:'Dashboard',title:'Readiness at a glance',description:'See fleet blockers and recent company activity as soon as you sign in.',image:require('../../assets/landing/dashboard.webp')},
  {name:'Operations',title:'Active fires on one map',description:'Review NIFC incidents by location, then connect crews and vehicles to assignments.',image:require('../../assets/landing/operations.webp')},
  {name:'Crew management',title:'Know who’s ready to deploy',description:'Keep personnel, roles, qualifications, and resource assignments connected to your operation.',highlights:['Crew profiles and company roles','Qualifications and certificates','Crew-to-resource assignments']},
  {name:'VIPR DPLs',title:'See where resources rank',description:'Browse USFS VIPR dispatch priority lists with award rates matched by VIN.',highlights:['Filter by geographic area and dispatch center','Review resource rankings and daily rates','Verify records against official USFS sources']},
  {name:'Fleet',title:'Know what can roll',description:'Review vehicle inspections, track maintenance issues and repair history, and keep unit status, assignments, photos, and records together.',image:require('../../assets/landing/fleet.webp')},
  {name:'Training',title:'Keep qualifications moving',description:'Publish courses, monitor capacity, and manage crew registration.',image:require('../../assets/landing/training.webp')},
  {name:'Inventory',title:'Count field supplies',description:'Update equipment quantities as stock moves in or out.',image:require('../../assets/landing/inventory.webp')},
  {name:'Communications',title:'Keep updates with your crew',description:'Post company threads and keep replies tied to each operational update.',image:require('../../assets/landing/communications.webp')},
  {name:'Receipts',title:'Review field expenses',description:'Crew can upload receipts while owners filter, review, and maintain expense records.',image:require('../../assets/landing/receipts.webp')},
];
const plans=[
  {audience:'Individual',name:'Firefighter Pro',price:'$6',description:'Personal qualifications, certificates, employment profile, and career tools.',note:'Free basic account; Pro is optional.'},
  {audience:'Small contractor',name:'Starter',price:'$99',description:'Up to 10 personnel, 5 resources, fleet inspections, records, and basic operations.',note:'For one- or two-engine companies.'},
  {audience:'Growing contractor',name:'FireOps Professional',price:'$249',description:'Up to 40 personnel and 25 resources, with advanced workforce management, incident operations, maintenance, and reporting.',note:'Built for multiple resources and seasonal crews.',featured:true},
  {audience:'Large contractor',name:'Business',price:'$499',description:'Up to 100 personnel, 75 resources, advanced analytics, integrations, and multi-division operations.'},
  {audience:'Enterprise',name:'Custom',price:'$799+',description:'Large fleets, multiple operating companies, custom integrations, and dedicated onboarding.'},
];

export function SignInLanding({children}:PropsWithChildren){
  const theme=useFireOpsTheme();
  const scroll=useRef<ScrollView>(null);
  const [height,setHeight]=useState(0);
  const [featuresY,setFeaturesY]=useState(0);
  const [linkError,setLinkError]=useState('');
  const open=async(url:string)=>{
    setLinkError('');
    try{await Linking.openURL(url)}catch{setLinkError('Could not open this link. Please try again.')}
  };
  const card={backgroundColor:theme.paper,borderColor:theme.divider};
  const heading={color:theme.ink};
  const copy={color:theme.secondary};
  return <SafeAreaView style={[styles.safe,{backgroundColor:theme.canvas}]} edges={['bottom']}>
    <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS==='ios'?'padding':'height'}>
      <ScrollView ref={scroll} onLayout={event=>setHeight(event.nativeEvent.layout.height)} automaticallyAdjustKeyboardInsets keyboardDismissMode={Platform.OS==='ios'?'interactive':'on-drag'} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={[styles.hero,{minHeight:height}]}>
          <View style={styles.heroContent}>
            <BrandWordmark/>
            <View style={[styles.panel,card]}>{children}</View>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="See FireOps features, pricing, and contact information" accessibilityHint="Scrolls down to the feature list" onPress={()=>scroll.current?.scrollTo({y:featuresY,animated:true})} style={styles.discover}>
            <Text style={[styles.discoverLabel,{color:theme.commandForeground}]}>See what FireOps covers</Text>
            <Text accessible={false} style={[styles.arrow,{color:theme.ember}]}>↓</Text>
            <Text style={[styles.small,copy]}>Tap or scroll down</Text>
          </Pressable>
        </View>
        <View onLayout={event=>setFeaturesY(event.nativeEvent.layout.y)} style={styles.section}>
          <Text style={[styles.kicker,{color:theme.green}]}>Inside FireOps</Text>
          <Text accessibilityRole="header" style={[styles.title,heading]}>One view of your whole operation.</Text>
          <Text style={[styles.body,copy]}>Crew readiness, fleet inspections, incident assignments, and VIPR dispatch lists stay in one company workspace.</Text>
          {features.map(feature=><View key={feature.name} style={[styles.card,card]}>
            <Text style={[styles.kicker,{color:theme.green}]}>{feature.name}</Text>
            <Text accessibilityRole="header" style={[styles.cardTitle,heading]}>{feature.title}</Text>
            <Text style={[styles.body,copy]}>{feature.description}</Text>
            {feature.highlights?.map(text=><Text key={text} style={[styles.highlight,{color:theme.green}]}>✓ {text}</Text>)}
            {feature.image&&<Image source={feature.image} accessibilityLabel={`${feature.name} preview`} resizeMode="contain" style={styles.preview}/>}
          </View>)}
        </View>
        <View style={[styles.section,{backgroundColor:theme.surfaceAlt}]}>
          <Text style={[styles.kicker,{color:theme.green}]}>Plans for every operation</Text>
          <Text accessibilityRole="header" style={[styles.title,heading]}>Start lean. Scale when fire season demands it.</Text>
          <Text style={[styles.body,copy]}>Choose individual career tools or a shared operating workspace for your company.</Text>
          {plans.map(plan=><View key={plan.name} style={[styles.card,card,plan.featured&&{borderColor:theme.green,borderWidth:2}]}>
            <Text style={[styles.kicker,{color:theme.green}]}>{plan.audience}{plan.featured?' · Most popular':''}</Text>
            <Text accessibilityRole="header" style={[styles.cardTitle,heading]}>{plan.name}</Text>
            <Text style={[styles.price,heading]}>{plan.price}<Text style={[styles.body,copy]}> / month</Text></Text>
            <Text style={[styles.body,copy]}>{plan.description}</Text>
            {plan.note&&<Text style={[styles.note,copy]}>{plan.note}</Text>}
          </View>)}
        </View>
        <View style={styles.section}>
          <Text style={[styles.kicker,{color:theme.green}]}>Talk with Fireco</Text>
          <Text accessibilityRole="header" style={[styles.title,heading]}>Want to learn how FireOps can support your operation?</Text>
          <View style={[styles.card,card]}>
            <Pressable accessibilityRole="link" onPress={()=>void open('tel:+12088617464')} style={styles.contact}><Text style={[styles.contactLabel,{color:theme.ember}]}>208-861-7464</Text></Pressable>
            <Pressable accessibilityRole="link" onPress={()=>void open('mailto:Clint@firecollc.com')} style={styles.contact}><Text style={[styles.contactLabel,{color:theme.ember}]}>Clint@firecollc.com</Text></Pressable>
            {linkError&&<Text accessibilityRole="alert" style={{color:theme.danger}}>{linkError}</Text>}
          </View>
          <Text accessibilityRole="header" style={[styles.cardTitle,heading]}>Less time managing systems. More time supporting crews.</Text>
          <Text style={[styles.body,copy]}>FireOps keeps core workflows together, giving leaders confidence in the details and crews confidence that information will be there when needed.</Text>
          <Text style={[styles.footer,copy]}>© {new Date().getFullYear()} FireOps · Built for teams who answer the call.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const styles=StyleSheet.create({
  safe:{flex:1},content:{flexGrow:1},hero:{padding:20,justifyContent:'space-between',gap:20},heroContent:{flexGrow:1,justifyContent:'center',alignItems:'center',gap:20},panel:{width:'100%',maxWidth:440,borderWidth:1,borderRadius:16,padding:22},discover:{alignItems:'center',padding:8,minHeight:80},discoverLabel:{fontSize:15,fontWeight:'700'},arrow:{fontSize:32,lineHeight:36},small:{fontSize:12},section:{padding:20,paddingVertical:40,gap:16,width:'100%',maxWidth:760,alignSelf:'center'},kicker:{fontSize:12,fontWeight:'800',letterSpacing:1,textTransform:'uppercase'},title:{fontSize:28,lineHeight:34,fontWeight:'800',letterSpacing:-.5},body:{fontSize:16,lineHeight:24},card:{borderWidth:1,borderRadius:16,padding:20,gap:12},cardTitle:{fontSize:22,lineHeight:28,fontWeight:'700'},highlight:{fontSize:15,lineHeight:23},preview:{width:'100%',height:240,borderRadius:8},price:{fontSize:36,fontWeight:'800'},note:{fontSize:14,lineHeight:21,fontStyle:'italic'},contact:{minHeight:48,justifyContent:'center'},contactLabel:{fontSize:17,fontWeight:'700'},footer:{fontSize:12,lineHeight:20,marginTop:24},
});
