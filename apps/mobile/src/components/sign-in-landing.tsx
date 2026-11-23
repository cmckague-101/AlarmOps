import {useRef,useState,type PropsWithChildren} from 'react';
import {Image,KeyboardAvoidingView,Linking,Platform,Pressable,ScrollView,StyleSheet,Text,View,type ScrollViewInstance} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {BrandWordmark} from '@/components/brand-wordmark';
import {useFireOpsTheme} from '@/theme';

const features=[
  {name:'Dashboard',title:'Readiness at a glance',description:'See open tickets, fleet blockers, and recent company activity as soon as you sign in.',image:require('../../assets/landing/dashboard.webp')},
  {name:'Operations',title:'Active calls on one map',description:'Track service and alarm response jobs by location, then connect technicians and vehicles to assignments.',image:require('../../assets/landing/operations.webp')},
  {name:'Team management',title:'Know who’s ready to respond',description:'Keep technicians, roles, certifications, and resource assignments connected to your operation.',highlights:['Technician profiles and company roles','Certifications and credentials','Crew-to-resource assignments']},
  {name:'Dispatch queue',title:'Prioritize the next call',description:'Browse active and pending work with clear priority so dispatchers know what moves next.',highlights:['Filter by site, zone, and urgency','Review rankings and response targets','Keep assignment history with each job']},
  {name:'Fleet',title:'Know what can roll',description:'Review vehicle inspections, track maintenance issues and repair history, and keep unit status, assignments, photos, and records together.',image:require('../../assets/landing/fleet.webp')},
  {name:'Training',title:'Keep certifications current',description:'Publish courses, monitor capacity, and manage technician registration.',image:require('../../assets/landing/training.webp')},
  {name:'Inventory',title:'Count devices and parts',description:'Update equipment and panel-component quantities as stock moves in or out.',image:require('../../assets/landing/inventory.webp')},
  {name:'Communications',title:'Keep updates with your team',description:'Post company threads and keep replies tied to each operational update.',image:require('../../assets/landing/communications.webp')},
  {name:'Receipts',title:'Review field expenses',description:'Technicians can upload receipts while owners filter, review, and maintain expense records.',image:require('../../assets/landing/receipts.webp')},
];
const plans=[
  {audience:'Individual',name:'Technician Pro',price:'$6',description:'Personal certifications, credentials, employment profile, and career tools.',note:'Free basic account; Pro is optional.'},
  {audience:'Small company',name:'Starter',price:'$99',description:'Up to 10 personnel, 5 resources, vehicle inspections, records, and basic operations.',note:'For lean service teams.'},
  {audience:'Growing company',name:'AlarmOps Professional',price:'$249',description:'Up to 40 personnel and 25 resources, with advanced workforce management, dispatch operations, maintenance, and reporting.',note:'Built for multi-truck shops and expanding accounts.',featured:true},
  {audience:'Large company',name:'Business',price:'$499',description:'Up to 100 personnel, 75 resources, advanced analytics, integrations, and multi-division operations.'},
  {audience:'Enterprise',name:'Custom',price:'$799+',description:'Large fleets, multiple operating companies, custom integrations, and dedicated onboarding.'},
];

export function SignInLanding({children}:PropsWithChildren){
  const theme=useFireOpsTheme();
  const scroll=useRef<ScrollViewInstance>(null);
  const [height,setHeight]=useState(0);
  const [featuresY,setFeaturesY]=useState(0);
  const [showBackToTop,setShowBackToTop]=useState(false);
  const [linkError,setLinkError]=useState('');
  const open=async(url:string)=>{
    setLinkError('');
    try{await Linking.openURL(url)}catch{setLinkError('Could not open this link. Please try again.')}
  };
  const heroBg='#0a0e12';
  const card={backgroundColor:theme.paper,borderColor:theme.divider};
  const heading={color:theme.ink};
  const copy={color:theme.secondary};
  return <SafeAreaView style={[styles.safe,{backgroundColor:theme.canvas}]} edges={['bottom']}>
    <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS==='ios'?'padding':'height'}>
      <ScrollView ref={scroll} onLayout={event=>setHeight(event.nativeEvent.layout.height)} onScroll={event=>setShowBackToTop(event.nativeEvent.contentOffset.y>120)} scrollEventThrottle={100} automaticallyAdjustKeyboardInsets keyboardDismissMode={Platform.OS==='ios'?'interactive':'on-drag'} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={[styles.hero,{minHeight:height,backgroundColor:heroBg}]}>
          <Image source={require('../../assets/landing/hero.webp')} accessibilityIgnoresInvertColors style={styles.heroImage} resizeMode="cover"/>
          <View style={styles.heroScrim}/>
          <View style={styles.heroContent}>
            <BrandWordmark onDark/>
            <Text style={styles.eyebrow}>Fire alarm & security operations</Text>
            <Text accessibilityRole="header" style={styles.heroTitle}>Monitor. Respond. Stay ahead.</Text>
            <Text style={styles.heroLede}>AlarmOps keeps monitoring, dispatch, technicians, and field work in one clear operating picture.</Text>
            <View style={[styles.panel,card]}>{children}</View>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="See AlarmOps features, pricing, and contact information" accessibilityHint="Scrolls down to the feature list" onPress={()=>scroll.current?.scrollTo({y:featuresY,animated:true})} style={styles.discover}>
            <Text style={styles.discoverLabel}>See what AlarmOps covers</Text>
            <Text accessible={false} style={[styles.arrow,{color:theme.ember}]}>↓</Text>
            <Text style={styles.small}>Tap or scroll down</Text>
          </Pressable>
        </View>
        <View onLayout={event=>setFeaturesY(event.nativeEvent.layout.y)} style={styles.section}>
          <Text style={[styles.kicker,{color:theme.ember}]}>Inside AlarmOps</Text>
          <Text accessibilityRole="header" style={[styles.title,heading]}>One view of your whole operation.</Text>
          <Text style={[styles.body,copy]}>Technician readiness, service fleet status, alarm response, and work orders stay in one company workspace.</Text>
          {features.map(feature=><View key={feature.name} style={[styles.card,card]}>
            <Text style={[styles.kicker,{color:theme.ember}]}>{feature.name}</Text>
            <Text accessibilityRole="header" style={[styles.cardTitle,heading]}>{feature.title}</Text>
            <Text style={[styles.body,copy]}>{feature.description}</Text>
            {feature.highlights?.map(text=><Text key={text} style={[styles.highlight,{color:theme.ink}]}>✓ {text}</Text>)}
            {feature.image&&<Image source={feature.image} accessibilityLabel={`${feature.name} preview`} resizeMode="contain" style={styles.preview}/>}
          </View>)}
        </View>
        <View style={[styles.section,{backgroundColor:theme.surfaceAlt}]}>
          <Text style={[styles.kicker,{color:theme.ember}]}>Plans for every operation</Text>
          <Text accessibilityRole="header" style={[styles.title,heading]}>Start lean. Scale as your book grows.</Text>
          <Text style={[styles.body,copy]}>Choose individual career tools or a shared operating workspace for your company.</Text>
          {plans.map(plan=><View key={plan.name} style={[styles.card,card,plan.featured&&{borderColor:theme.ember,borderWidth:2}]}>
            <Text style={[styles.kicker,{color:theme.ember}]}>{plan.audience}{plan.featured?' · Most popular':''}</Text>
            <Text accessibilityRole="header" style={[styles.cardTitle,heading]}>{plan.name}</Text>
            <Text style={[styles.price,heading]}>{plan.price}<Text style={[styles.body,copy]}> / month</Text></Text>
            <Text style={[styles.body,copy]}>{plan.description}</Text>
            {plan.note&&<Text style={[styles.note,copy]}>{plan.note}</Text>}
          </View>)}
        </View>
        <View style={styles.section}>
          <Text style={[styles.kicker,{color:theme.ember}]}>Talk with the AlarmOps team</Text>
          <Text accessibilityRole="header" style={[styles.title,heading]}>Want to learn how AlarmOps can support your operation?</Text>
          <View style={[styles.card,card]}>
            <Pressable accessibilityRole="link" onPress={()=>void open('tel:+12088617464')} style={styles.contact}><Text style={[styles.contactLabel,{color:theme.ember}]}>208-861-7464</Text></Pressable>
            <Pressable accessibilityRole="link" onPress={()=>void open('mailto:Clint@firecollc.com')} style={styles.contact}><Text style={[styles.contactLabel,{color:theme.ember}]}>Clint@firecollc.com</Text></Pressable>
            {linkError&&<Text accessibilityRole="alert" style={{color:theme.danger}}>{linkError}</Text>}
          </View>
          <Text accessibilityRole="header" style={[styles.cardTitle,heading]}>Less time managing systems. More time protecting sites.</Text>
          <Text style={[styles.body,copy]}>AlarmOps keeps core workflows together, giving leaders confidence in the details and technicians confidence that information will be there when needed.</Text>
          <Text style={[styles.footer,copy]}>© {new Date().getFullYear()} AlarmOps · Built for teams who answer the call.</Text>
        </View>
      </ScrollView>
      {showBackToTop&&<Pressable accessibilityRole="button" accessibilityLabel="Back to top" accessibilityHint="Returns to the sign-in form" onPress={()=>scroll.current?.scrollTo({y:0,animated:true})} style={({pressed})=>[styles.backToTop,{backgroundColor:pressed?theme.emberPressed:theme.ember}]}>
        <Text accessible={false} style={styles.backToTopArrow}>↑</Text>
      </Pressable>}
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const styles=StyleSheet.create({
  backToTop:{position:'absolute',right:20,bottom:16,width:52,height:52,borderRadius:26,alignItems:'center',justifyContent:'center'},backToTopArrow:{color:'#FFFFFF',fontSize:30,lineHeight:36},
  safe:{flex:1},content:{flexGrow:1,paddingBottom:80},
  hero:{padding:20,justifyContent:'space-between',gap:20,overflow:'hidden'},
  heroImage:{...StyleSheet.absoluteFill,opacity:.55},
  heroScrim:{...StyleSheet.absoluteFill,backgroundColor:'rgba(6,9,14,.72)'},
  heroContent:{flexGrow:1,justifyContent:'center',alignItems:'center',gap:16,zIndex:1},
  eyebrow:{color:'#ff8f7a',fontSize:11,fontWeight:'800',letterSpacing:1.4,textTransform:'uppercase',textAlign:'center'},
  heroTitle:{color:'#FFFFFF',fontSize:28,lineHeight:34,fontWeight:'800',letterSpacing:-.5,textAlign:'center',maxWidth:320},
  heroLede:{color:'#c5ced8',fontSize:15,lineHeight:22,textAlign:'center',maxWidth:340,marginBottom:4},
  panel:{width:'100%',maxWidth:440,borderWidth:1,borderRadius:16,padding:22},
  discover:{alignItems:'center',padding:8,minHeight:80,zIndex:1},
  discoverLabel:{fontSize:15,fontWeight:'700',color:'#FFFFFF'},
  arrow:{fontSize:32,lineHeight:36},
  small:{fontSize:12,color:'#9aa6b2'},
  section:{padding:20,paddingVertical:40,gap:16,width:'100%',maxWidth:760,alignSelf:'center'},
  kicker:{fontSize:12,fontWeight:'800',letterSpacing:1,textTransform:'uppercase'},
  title:{fontSize:28,lineHeight:34,fontWeight:'800',letterSpacing:-.5},
  body:{fontSize:16,lineHeight:24},
  card:{borderWidth:1,borderRadius:16,padding:20,gap:12},
  cardTitle:{fontSize:22,lineHeight:28,fontWeight:'700'},
  highlight:{fontSize:15,lineHeight:23},
  preview:{width:'100%',height:240,borderRadius:8},
  price:{fontSize:36,fontWeight:'800'},
  note:{fontSize:14,lineHeight:21,fontStyle:'italic'},
  contact:{minHeight:48,justifyContent:'center'},
  contactLabel:{fontSize:17,fontWeight:'700'},
  footer:{fontSize:12,lineHeight:20,marginTop:24},
});
