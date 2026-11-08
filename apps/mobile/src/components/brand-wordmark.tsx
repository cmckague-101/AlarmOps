import {Image,StyleSheet} from 'react-native';
import {useFireOpsColorScheme} from '@/theme';

export function BrandWordmark(){
  const dark=useFireOpsColorScheme().colorScheme==='dark';
  return <Image accessibilityLabel="FireOps, powered by Fireco" resizeMode="contain" source={dark?require('../../assets/images/fireops-wordmark-dark.png'):require('../../assets/images/fireops-wordmark-light.png')} style={styles.image}/>;
}
const styles=StyleSheet.create({image:{width:230,height:81}});
