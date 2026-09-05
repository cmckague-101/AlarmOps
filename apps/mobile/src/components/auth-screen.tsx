import type {PropsWithChildren} from 'react';
import {KeyboardAvoidingView,Platform,ScrollView,StyleSheet,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {BrandWordmark} from './brand-wordmark';
import {useFireOpsTheme} from '@/theme';

export function AuthScreen({children}:PropsWithChildren){
  const theme=useFireOpsTheme();
  return <SafeAreaView style={[styles.safe,{backgroundColor:theme.canvas}]}>
    <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS==='ios'?'padding':'height'}>
      <ScrollView automaticallyAdjustKeyboardInsets keyboardDismissMode={Platform.OS==='ios'?'interactive':'on-drag'} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
        <View style={styles.brand}><BrandWordmark/></View>
        <View style={[styles.panel,{backgroundColor:theme.paper,borderColor:theme.divider}]}>{children}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const styles=StyleSheet.create({safe:{flex:1},scroll:{flexGrow:1,justifyContent:'center',padding:20},brand:{alignItems:'center',marginBottom:24},panel:{width:'100%',maxWidth:440,alignSelf:'center',borderWidth:1,borderRadius:16,padding:22}});
