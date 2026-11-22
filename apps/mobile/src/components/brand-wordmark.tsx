import {Image,StyleSheet} from 'react-native';
import {useFireOpsColorScheme} from '@/theme';

export function BrandWordmark(){
  const dark=useFireOpsColorScheme().colorScheme==='dark';
  return <Image accessibilityLabel="AlarmOps" resizeMode="contain" source={dark?require('../../assets/images/alarmops-wordmark-dark.png'):require('../../assets/images/alarmops-wordmark-light.png')} style={styles.image}/>;
}
const styles=StyleSheet.create({image:{width:230,height:77}});
