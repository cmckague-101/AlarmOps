import './demo-uploads.css';
import {createContext, forwardRef, useContext, type ComponentPropsWithoutRef} from 'react';

export const DemoModeContext = createContext(false);

/** Also applies inside dialogs rendered through portals. */
export const FileInput = forwardRef<HTMLInputElement, ComponentPropsWithoutRef<'input'>>(function FileInput(props, ref) {
  const demoMode = useContext(DemoModeContext);
  return <input {...props} ref={ref} disabled={demoMode || props.disabled} title={demoMode ? 'Uploads are disabled in demo mode.' : props.title}/>;
});

export function UploadButton(props: ComponentPropsWithoutRef<'button'>) {
  const demoMode = useContext(DemoModeContext);
  return <button {...props} disabled={demoMode || props.disabled} title={demoMode ? 'Uploads are disabled in demo mode.' : props.title}/>;
}
