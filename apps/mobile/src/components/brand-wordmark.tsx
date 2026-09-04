import {Image,StyleSheet,useColorScheme} from 'react-native';

export function BrandWordmark(){
  const dark=useColorScheme()==='dark';
  return <Image accessibilityLabel="FireOps, powered by Fireco" resizeMode="contain" source={dark?require('../../assets/images/fireops-wordmark-dark.png'):require('../../assets/images/fireops-wordmark-light.png')} style={styles.image}/>;
}
const styles=StyleSheet.create({image:{width:230,height:81}});
