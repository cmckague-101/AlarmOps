import {StyleSheet,Text,type StyleProp,type TextProps,type TextStyle} from 'react-native';
import {heroTitleFontFamily,useFireOpsTheme} from '@/theme';

// Primary page titles: large gray Outfit, matching web's .hero-heading h1.
export function HeroTitle({style,...props}:TextProps&{style?:StyleProp<TextStyle>}){
  const theme=useFireOpsTheme();
  return <Text accessibilityRole="header" {...props} style={[style,styles.title,{color:theme.heroTitle}]}/>;
}
const styles=StyleSheet.create({title:{fontFamily:heroTitleFontFamily,fontWeight:'normal',fontSize:32,lineHeight:36,letterSpacing:-1.1}});
