import {SymbolView,type SymbolViewProps} from 'expo-symbols';
import type {ColorValue} from 'react-native';

type Props={name:SymbolViewProps['name'];color:ColorValue;size?:number};
export function AppSymbol({name,color,size=24}:Props){return <SymbolView name={name} size={size} tintColor={color} weight="semibold"/>}
