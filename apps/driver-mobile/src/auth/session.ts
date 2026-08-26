import * as SecureStore from 'expo-secure-store';
const ACCESS='sugat.access-token',REFRESH='sugat.refresh-token';
export type Session={accessToken:string;refreshToken:string};
export async function saveSession(session:Session){await Promise.all([SecureStore.setItemAsync(ACCESS,session.accessToken),SecureStore.setItemAsync(REFRESH,session.refreshToken)]);}
export async function getAccessToken(){return SecureStore.getItemAsync(ACCESS);}
export async function getRefreshToken(){return SecureStore.getItemAsync(REFRESH);}
export async function clearSession(){await Promise.all([SecureStore.deleteItemAsync(ACCESS),SecureStore.deleteItemAsync(REFRESH)]);}
