import {describe,expect,it} from 'vitest';
import {isNestedPush,isNestedReturn,pageSlideDirection,pageStageClassName} from './page-transition';

describe('pageSlideDirection',()=>{
  it('slides forward when moving right along primary nav',()=>{
    expect(pageSlideDirection('overview','vehicles')).toBe('forward');
    expect(pageSlideDirection('vehicles','communications')).toBe('forward');
    expect(pageSlideDirection('news','more')).toBe('forward');
  });

  it('slides back when moving left along primary nav or returning via Back',()=>{
    expect(pageSlideDirection('vehicles','overview')).toBe('back');
    expect(pageSlideDirection('settings','overview')).toBe('back');
    expect(pageSlideDirection('more','news')).toBe('back');
  });

  it('treats nested drill-ins as push and returns as pop',()=>{
    expect(pageSlideDirection('qualifications','add-credential')).toBe('forward');
    expect(pageSlideDirection('add-credential','qualifications')).toBe('back');
    expect(pageSlideDirection('vehicles','send-vipr')).toBe('forward');
    expect(pageSlideDirection('send-vipr','vehicles')).toBe('back');
    expect(pageSlideDirection('vipr-intelligence','dispatch')).toBe('forward');
    expect(pageSlideDirection('dispatch','vipr-intelligence')).toBe('back');
    expect(pageSlideDirection('send-vipr','vipr-intelligence')).toBe('back');
  });

  it('exposes nested helpers used by the direction rules',()=>{
    expect(isNestedPush('qualifications','credential-detail')).toBe(true);
    expect(isNestedReturn('credential-detail','qualifications')).toBe(true);
    expect(isNestedReturn('dispatch','vehicles')).toBe(false);
  });

  it('maps direction to the page-stage class names',()=>{
    expect(pageStageClassName('forward')).toBe('page-stage page-stage-forward');
    expect(pageStageClassName('back')).toBe('page-stage page-stage-back');
  });
});
