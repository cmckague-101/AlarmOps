/*
THESIS: FireOps web structure reconformed to native controls, never wrapped as a website.
OWN-WORLD: Field Command Ledger palette, flat work surfaces, semantic status, rare ember actions.
STORY: Invited crew signs in, verifies company access, then reaches familiar operational sections.
FIRST VIEWPORT: Native auth form leads; authenticated users enter Dashboard with five platform tabs.
FORM: Direct adaptation of approved web information architecture; user-pinned parity.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
*/
import {DarkTheme,DefaultTheme,router,Stack,ThemeProvider} from 'expo-router';
import {useFonts} from 'expo-font';
import {StatusBar} from 'expo-status-bar';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {AppHeaderBrand} from '@/components/app-header-brand';
import {AppProviders} from '@/providers/app-providers';
import {OfflineSyncNotice} from '@/components/offline-sync-notice';
import {useSession} from '@/providers/session-provider';
import {useFireOpsColorScheme,useFireOpsTheme} from '@/theme';

export default function RootLayout(){
  // Page titles use Outfit; screens render right away with the system font until it loads.
  useFonts({'Outfit-Bold':require('../../assets/fonts/Outfit-Bold.ttf')});
  return <GestureHandlerRootView style={styles.root}><AppProviders><RootNavigator/></AppProviders></GestureHandlerRootView>}

function RootNavigator(){
  const theme=useFireOpsTheme();
  const {colorScheme}=useFireOpsColorScheme();
  const {demoMode,signOut}=useSession();
  const insets=useSafeAreaInsets();
  return <ThemeProvider value={colorScheme==='dark'?DarkTheme:DefaultTheme}>
    <View style={styles.root}>
      <StatusBar style={colorScheme==='dark'?'light':'dark'}/>
      {demoMode?<View style={[styles.demoNotice,{paddingTop:insets.top,backgroundColor:theme.paper,borderBottomColor:theme.divider}]}>
        <View style={styles.demoCopy}><Text style={[styles.demoTitle,{color:theme.ember}]}>Demo mode · Sample data</Text><Text style={{color:theme.secondary,fontSize:12}}>Session only · External services disabled</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Exit demo and discard changes" onPress={()=>void signOut().then(()=>{router.dismissAll();router.replace('/sign-in')})} style={styles.exitDemo}><Text style={{color:theme.ember,fontWeight:'700'}}>Exit demo</Text></Pressable>
      </View>:null}
      <OfflineSyncNotice topInset={!demoMode?insets.top:0}/>
      <Stack screenOptions={{headerBackButtonDisplayMode:'minimal',headerTintColor:theme.ink,headerTitleAlign:'center',headerTitle:()=> <AppHeaderBrand/>,headerStyle:{backgroundColor:theme.paper},contentStyle:{backgroundColor:theme.canvas}}}>
        <Stack.Screen name="index"/>
        <Stack.Screen name="sign-in"/>
        <Stack.Screen name="forgot-password" options={{title:'Reset password'}}/>
        <Stack.Screen name="reset-password" options={{title:'Choose new password'}}/>
        <Stack.Screen name="(tabs)" options={{headerShown:false}}/>
      </Stack>
    </View>
  </ThemeProvider>;
}

const styles=StyleSheet.create({
  root:{flex:1},
  demoNotice:{flexDirection:'row',alignItems:'center',paddingHorizontal:16,paddingBottom:6,borderBottomWidth:1},
  demoCopy:{flex:1,gap:2},
  demoTitle:{fontWeight:'800',fontSize:13},
  exitDemo:{minHeight:44,justifyContent:'center',paddingLeft:12},
});
