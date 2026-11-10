import {Redirect,useLocalSearchParams} from 'expo-router';

/**
 * Operations moved onto the first tab (index). Keep this route so push
 * notifications, deep links and router.push('/operations') still work,
 * carrying the incident or vehicle to focus.
 */
export default function OperationsRedirect(){
  const {incidentId,vehicleId}=useLocalSearchParams<{incidentId?:string;vehicleId?:string}>();
  const params={...(incidentId?{incidentId}:{}),...(vehicleId?{vehicleId}:{})};
  return <Redirect href={{pathname:'/(tabs)',params}}/>;
}
