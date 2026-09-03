import {router} from 'expo-router';
import {ScreenState} from '@/components/screen-state';
export default function NotFound(){return <ScreenState title="Page not found" message="This FireOps link is unavailable." actionLabel="Return to FireOps" onAction={()=>router.replace('/')}/>}
