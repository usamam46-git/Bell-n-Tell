type Options={csrf?:string;key?:string;handle?:string};
export async function request<T>(path:string,method='GET',body?:unknown,options:Options={}):Promise<T> {
 let response:Response;
 try{response=await fetch(`/api/v1${path}`,{method,credentials:'same-origin',cache:'no-store',headers:{...(body!==undefined?{'content-type':'application/json'}:{}),...(options.csrf?{'x-csrf-token':options.csrf}:{}),...(options.handle?{'x-management-handle':options.handle}:{}),...(method!=='GET'?{'idempotency-key':options.key??crypto.randomUUID()}: {})},body:body!==undefined?JSON.stringify(body):undefined});}
 catch{throw new Error('The server is unavailable. Please try again shortly.');}
 if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('The server is unavailable. Please try again shortly.');
 let data:T&{error?:{message?:string}};
 try{data=await response.json();}catch{throw new Error('The server sent an invalid response. Please try again shortly.');}
 if(!response.ok)throw new Error(data.error?.message??'Request failed');
 return data;
}
