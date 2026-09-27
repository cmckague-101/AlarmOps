import type {PropsWithChildren} from 'react';
import {KeyboardAvoidingView,Platform,ScrollView,StyleSheet,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useFireOpsTheme} from '@/theme';

export function AuthScreen({children}:PropsWithChildren){
  const theme=useFireOpsTheme();
  return <SafeAreaView style={[styles.safe,{backgroundColor:theme.canvas}]} edges={['bottom']}>
    <KeyboardAvoidingView style={[styles.safe,{backgroundColor:theme.canvas}]} behavior={Platform.OS==='ios'?'padding':'height'}>
      <ScrollView style={{backgroundColor:theme.canvas}} automaticallyAdjustKeyboardInsets keyboardDismissMode={Platform.OS==='ios'?'interactive':'on-drag'} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
        <View style={[styles.panel,{backgroundColor:theme.paper,borderColor:theme.divider}]}>{children}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const styles=StyleSheet.create({safe:{flex:1},scroll:{flexGrow:1,justifyContent:'center',padding:20},panel:{width:'100%',maxWidth:440,alignSelf:'center',borderWidth:1,borderRadius:16,padding:22}});
