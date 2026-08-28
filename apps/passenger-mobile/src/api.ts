const API_URL=(process.env.EXPO_PUBLIC_API_URL??'').replace(/\/$/,'');
export const SOCKET_URL=API_URL.replace(/\/api\/v1$/,'');
export class ApiError extends Error{}
export async function api<T>(path:string):Promise<T>{if(!API_URL)throw new ApiError('EXPO_PUBLIC_API_URL is not configured.');const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);try{const response=await fetch(`${API_URL}${path}`,{signal:controller.signal});if(!response.ok)throw new ApiError(`Request failed (${response.status}).`);return response.json()}catch(error){if(error instanceof ApiError)throw error;throw new ApiError(error instanceof Error&&error.name==='AbortError'?'Request timed out.':'Cannot reach SUGAT. Check your connection.')}finally{clearTimeout(timer)}}
