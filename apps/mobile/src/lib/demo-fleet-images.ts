import {Image,type ImageSourcePropType} from 'react-native';

// Static requires let Metro bundle the same demo photos used on the website.
const images:Record<string,ImageSourcePropType>={
  'demo-fleet/engine-701.webp':require('../../assets/demo-vehicles/engine-701.webp'),
  'demo-fleet/tender-12.webp':require('../../assets/demo-vehicles/tender-12.webp'),
  'demo-fleet/dozer-4.webp':require('../../assets/demo-vehicles/dozer-4.webp'),
};

export function demoFleetImageUrl(path:string|undefined){
  const source=path?images[path]:undefined;
  return source?Image.resolveAssetSource(source)?.uri??null:null;
}
