import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {DemoModeContext, FileInput, UploadButton} from './demo-uploads';

function render(demoMode:boolean, disabled=false) {
  return renderToStaticMarkup(<DemoModeContext.Provider value={demoMode}><FileInput type="file" disabled={disabled}/><UploadButton disabled={disabled}>Choose photo</UploadButton></DemoModeContext.Provider>);
}

describe('demo upload controls',()=>{
  it('disables file and photo selection in demo mode',()=>{
    const html=render(true);
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain('Uploads are disabled in demo mode.');
  });
  it('allows uploads outside demo mode',()=>{
    expect(render(false)).not.toContain('disabled=');
  });
  it('preserves busy-state disabling outside demo mode',()=>{
    expect(render(false,true).match(/disabled=""/g)).toHaveLength(2);
  });
});
