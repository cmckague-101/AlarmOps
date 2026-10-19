// Use the deployed web app, never guess a production hostname.
export function demoUrl(webUrl=process.env.EXPO_PUBLIC_WEB_URL?.trim()){
  if(!webUrl)throw new Error('Demo is not configured. Set EXPO_PUBLIC_WEB_URL to the FireOps website before building the app.');
  const url=new URL(webUrl);
  if(url.protocol!=='https:'&&url.protocol!=='http:')throw new Error('Web URL must use HTTP or HTTPS.');
  url.pathname='/';
  url.search='?demo=1';
  url.hash='';
  return url.toString();
}
