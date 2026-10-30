import {Image,StyleSheet,Text,View} from 'react-native';
import {useFireOpsTheme} from '@/theme';

export function AppHeaderBrand(){
  const theme=useFireOpsTheme();
  return <View accessible accessibilityRole="header" accessibilityLabel="FireOps" style={styles.brand}>
    <Image accessible={false} resizeMode="contain" source={require('../../assets/images/header.png')} style={styles.logo}/>
    <Text style={[styles.name,{color:theme.ink}]}>FireOps</Text>
  </View>;
}

const styles=StyleSheet.create({
  brand:{flexDirection:'row',alignItems:'center',gap:8},
  logo:{width:28,height:28},
  name:{fontSize:18,fontWeight:'800',letterSpacing:-.35},
});
