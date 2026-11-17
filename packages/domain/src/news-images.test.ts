import {describe,expect,it} from 'vitest';
import {assignNewsImages,newsImageNames} from './news-images';
import {curatedNewsStories,newsFeedImages} from './news-feed';

describe('news images',()=>{
  it('gives the same key the same image every time',()=>{
    const keys=curatedNewsStories.map(story=>story.id);
    expect(assignNewsImages(keys)).toEqual(assignNewsImages(keys));
  });

  it('never repeats an image on screen while the pool has room',()=>{
    const keys=Array.from({length:newsImageNames.length},(_,index)=>`story-${index}`);
    expect(new Set(assignNewsImages(keys)).size).toBe(newsImageNames.length);
  });

  it('keeps earlier items stable when a later item changes',()=>{
    const [first,second]=assignNewsImages(['nwcg-announcements','nifc-outlooks','featured:PL 3']);
    const next=assignNewsImages(['nwcg-announcements','nifc-outlooks','featured:PL 4']);
    expect(next.slice(0,2)).toEqual([first,second]);
  });

  it('picks a new image when an item is replaced',()=>{
    const pool=['a','b','c','d','e','f','g','h'] as const;
    const images=new Set(['one','two','three','four','five','six'].map(key=>assignNewsImages([key],pool)[0]));
    expect(images.size).toBeGreaterThan(1);
  });

  it('reuses images only once the pool is exhausted',()=>{
    expect(assignNewsImages(['a','b','c'],['x','y'])).toHaveLength(3);
    expect(()=>assignNewsImages(['a'],[])).toThrow();
  });

  it('keeps the shared pool free of duplicates',()=>{
    expect(new Set(newsImageNames).size).toBe(newsImageNames.length);
  });
});

describe('news feed images',()=>{
  it('gives every curated story a distinct photo and waits on the featured one until activity loads',()=>{
    const loading=newsFeedImages(null);
    expect(loading.featured).toBeNull();
    expect(Object.keys(loading.stories)).toEqual(curatedNewsStories.map(story=>story.id));
    const loaded=newsFeedImages('National preparedness level 3');
    expect(loaded.stories).toEqual(loading.stories);
    expect(Object.values(loaded.stories)).not.toContain(loaded.featured);
    expect(new Set(Object.values(loaded.stories)).size).toBe(curatedNewsStories.length);
  });
});

describe('bundled news photos',()=>{
  it('has a JPG for every pooled name in both the web and mobile apps',async()=>{
    const {existsSync}=await import('node:fs');
    const root=new URL('../../../',import.meta.url);
    const missing=newsImageNames.flatMap(name=>['apps/web/public/news','apps/mobile/assets/news'].map(dir=>`${dir}/${name}.jpg`)).filter(path=>!existsSync(new URL(path,root)));
    expect(missing).toEqual([]);
  });
});
