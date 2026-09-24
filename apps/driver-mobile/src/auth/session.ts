import * as SecureStore from 'expo-secure-store';
const ACCESS='sugat.access-token',REFRESH='sugat.refresh-token',MUST_CHANGE='sugat.must-change-password';
export type Session={accessToken:string;refreshToken:string;mustChangePassword?:boolean;deviceCredential?:string};
const DEVICE='sugat.driver-device-credential';
export const getDeviceCredential=()=>SecureStore.getItemAsync(DEVICE);
export async function saveSession(session:Session){if(session.deviceCredential)await SecureStore.setItemAsync(DEVICE,session.deviceCredential,{keychainAccessible:SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY});await Promise.all([SecureStore.setItemAsync(ACCESS,session.accessToken),SecureStore.setItemAsync(REFRESH,session.refreshToken),SecureStore.setItemAsync(MUST_CHANGE,String(Boolean(session.mustChangePassword)))]);}
export async function getAccessToken(){return SecureStore.getItemAsync(ACCESS);}
export async function getRefreshToken(){return SecureStore.getItemAsync(REFRESH);}
export async function mustChangePassword(){return(await SecureStore.getItemAsync(MUST_CHANGE))==='true';}
export async function clearSession(){await Promise.all([SecureStore.deleteItemAsync(ACCESS),SecureStore.deleteItemAsync(REFRESH),SecureStore.deleteItemAsync(MUST_CHANGE)]);}
