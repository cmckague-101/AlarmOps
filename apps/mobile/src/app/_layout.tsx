/*
THESIS: FireOps web structure reconformed to native controls, never wrapped as a website.
OWN-WORLD: Field Command Ledger palette, flat work surfaces, semantic status, rare ember actions.
STORY: Invited crew signs in, verifies company access, then reaches familiar operational sections.
FIRST VIEWPORT: Native auth form leads; authenticated users enter Dashboard with five platform tabs.
FORM: Direct adaptation of approved web information architecture; user-pinned parity.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
*/
import {DarkTheme,DefaultTheme,Stack,ThemeProvider} from 'expo-router';
import {StatusBar} from 'expo-status-bar';
import {StyleSheet,Text,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {AppHeaderBrand} from '@/components/app-header-brand';
import {AppProviders} from '@/providers/app-providers';
import {useNetworkStatus} from '@/providers/network-provider';
import {useFireOpsColorScheme,useFireOpsTheme} from '@/theme';

export default function RootLayout(){return <AppProviders><RootNavigator/></AppProviders>}

function RootNavigator(){
  const theme=useFireOpsTheme();
  const {colorScheme}=useFireOpsColorScheme();
  const {isOffline}=useNetworkStatus();
  const insets=useSafeAreaInsets();
  return <ThemeProvider value={colorScheme==='dark'?DarkTheme:DefaultTheme}>
    <View style={styles.root}>
      <StatusBar style={isOffline?'light':colorScheme==='dark'?'light':'dark'}/>
      {isOffline?<View accessibilityRole="alert" style={[styles.offlineNotice,{paddingTop:insets.top,backgroundColor:theme.warning}]}><Text style={styles.offlineText}>Offline · Read-only mode · Showing saved data</Text></View>:null}
      <Stack screenOptions={{headerBackButtonDisplayMode:'minimal',headerTintColor:theme.ink,headerTitleAlign:'left',headerTitle:()=> <AppHeaderBrand/>,headerStyle:{backgroundColor:theme.paper},contentStyle:{backgroundColor:theme.canvas}}}>
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
  offlineNotice:{paddingBottom:7,paddingHorizontal:16},
  offlineText:{color:'#FFFFFF',fontSize:12,fontWeight:'700',letterSpacing:.2,textAlign:'center'},
});
