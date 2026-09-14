export type AuthLinkParameters=
  | {type:'code';code:string}
  | {type:'tokens';accessToken:string;refreshToken:string};

export function parseAuthLink(url:string):AuthLinkParameters|null{
  try{
    const parsed=new URL(url);
    const params=new URLSearchParams(parsed.search);
    const fragment=new URLSearchParams(parsed.hash.replace(/^#/,''));
    fragment.forEach((value,key)=>{if(!params.has(key))params.set(key,value)});
    const code=params.get('code');
    if(code)return {type:'code',code};
    const accessToken=params.get('access_token');
    const refreshToken=params.get('refresh_token');
    if(accessToken&&refreshToken)return {type:'tokens',accessToken,refreshToken};
    return null;
  }catch{
    return null;
  }
}
