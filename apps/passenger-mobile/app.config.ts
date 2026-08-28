import type { ConfigContext, ExpoConfig } from 'expo/config';
export default ({config}:ConfigContext):ExpoConfig=>({
  ...config,name:'SUGAT Passenger',slug:'sugat-passenger',version:'0.1.0',orientation:'portrait',userInterfaceStyle:'light',scheme:'sugat-passenger',
  icon:'./assets/sugat-logo-official.png',splash:{image:'./assets/sugat-logo-official.png',backgroundColor:'#FFFFFF',resizeMode:'contain'},
  android:{package:process.env.SUGAT_PASSENGER_ANDROID_PACKAGE??'ph.sugata.passenger',adaptiveIcon:{foregroundImage:'./assets/sugat-logo-official.png',backgroundColor:'#FFFFFF'},permissions:['ACCESS_COARSE_LOCATION','ACCESS_FINE_LOCATION','POST_NOTIFICATIONS']},
  plugins:[['expo-location',{locationWhenInUsePermission:'Allow SUGAT to use your location to help you understand nearby stops and rides.'}],'expo-notifications'],
  extra:{apiUrl:process.env.EXPO_PUBLIC_API_URL}
});
