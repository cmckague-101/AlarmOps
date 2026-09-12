import {Image,StyleSheet,Text,View} from 'react-native';
import {useFireOpsTheme} from '@/theme';

export function AppHeaderBrand(){
  const theme=useFireOpsTheme();
  return <View accessible accessibilityRole="header" accessibilityLabel="FireOps" style={styles.brand}>
    <Image accessible={false} source={require('../../assets/images/fireops-ios-icon.png')} style={styles.logo}/>
    <Text style={[styles.name,{color:theme.ink}]}>FireOps</Text>
  </View>;
}

export function AppHeaderSectionTitle({title}:{title:string}){
  const theme=useFireOpsTheme();
  return <Text accessibilityRole="header" numberOfLines={1} style={[styles.sectionTitle,{color:theme.ink}]}>{title}</Text>;
}

const styles=StyleSheet.create({
  brand:{flexDirection:'row',alignItems:'center',gap:8},
  logo:{width:28,height:28},
  name:{fontSize:18,fontWeight:'800',letterSpacing:-.35},
  sectionTitle:{fontSize:17,fontWeight:'700',letterSpacing:-.25},
});
