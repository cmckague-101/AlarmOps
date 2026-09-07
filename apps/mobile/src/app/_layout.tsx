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
import {AppProviders} from '@/providers/app-providers';
import {useFireOpsColorScheme,useFireOpsTheme} from '@/theme';

export default function RootLayout(){return <AppProviders><RootNavigator/></AppProviders>}

function RootNavigator(){
  const theme=useFireOpsTheme();
  const {colorScheme}=useFireOpsColorScheme();
  return <ThemeProvider value={colorScheme==='dark'?DarkTheme:DefaultTheme}>
    <StatusBar style={colorScheme==='dark'?'light':'dark'}/>
    <Stack screenOptions={{headerBackButtonDisplayMode:'minimal',headerTintColor:theme.ink,headerStyle:{backgroundColor:theme.paper},contentStyle:{backgroundColor:theme.canvas}}}>
      <Stack.Screen name="index" options={{headerShown:false}}/>
      <Stack.Screen name="sign-in" options={{headerShown:false}}/>
      <Stack.Screen name="forgot-password" options={{title:'Reset password'}}/>
      <Stack.Screen name="reset-password" options={{title:'Choose new password'}}/>
      <Stack.Screen name="(tabs)" options={{headerShown:false}}/>
    </Stack>
  </ThemeProvider>;
}
