import {StyleSheet,Text,TextInput,type TextInputProps,View} from 'react-native';
import {useFireOpsTheme} from '@/theme';

type Props=TextInputProps&{label:string;error?:string};
export function FormField({label,error,...props}:Props){
  const theme=useFireOpsTheme();
  return <View style={styles.field}>
    <Text style={[styles.label,{color:theme.secondary}]}>{label}</Text>
    <TextInput {...props} accessibilityLabel={label} accessibilityHint={error} placeholderTextColor={theme.secondary} selectionColor={theme.ember} cursorColor={theme.ember} style={[styles.input,{backgroundColor:theme.surfaceAlt,borderColor:error?theme.danger:theme.divider,color:theme.ink},props.style]}/>
    {error&&<Text accessibilityRole="alert" style={[styles.error,{color:theme.danger}]}>{error}</Text>}
  </View>;
}
const styles=StyleSheet.create({field:{gap:6},label:{fontSize:13,fontWeight:'700'},input:{minHeight:50,borderWidth:1,borderRadius:8,paddingHorizontal:13,fontSize:16},error:{fontSize:13,lineHeight:18}});
