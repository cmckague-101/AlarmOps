import {describe,expect,it,vi} from 'vitest';
import {RESUME_AFTER_MS,noteAppState,notifyAppResume,onAppResume,refreshOnRejoin} from './app-resume';

describe('app resume',()=>{
  it('reports a resume only after a long enough background stay',()=>{
    expect(noteAppState('background',1000)).toBe(false);
    expect(noteAppState('inactive',1500)).toBe(false);
    expect(noteAppState('active',1000+RESUME_AFTER_MS-1)).toBe(false);
    noteAppState('background',5000);noteAppState('background',9000);
    expect(noteAppState('active',5000+RESUME_AFTER_MS)).toBe(true);
    expect(noteAppState('active',99_000)).toBe(false);
  });
  it('notifies listeners until unsubscribed and isolates failures',async()=>{
    const failing=vi.fn(()=>{throw new Error('boom')});const rejected=vi.fn(async()=>{throw new Error('boom')});const listener=vi.fn();
    const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
    const stops=[onAppResume(failing),onAppResume(rejected),onAppResume(listener)];
    notifyAppResume();await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);expect(rejected).toHaveBeenCalledTimes(1);
    stops.forEach(stop=>stop());notifyAppResume();
    expect(listener).toHaveBeenCalledTimes(1);warn.mockRestore();
  });
  it('refreshes on realtime rejoins but not the first join',()=>{
    const refresh=vi.fn();const callback=refreshOnRejoin(refresh);
    callback('SUBSCRIBED');expect(refresh).not.toHaveBeenCalled();
    callback('CLOSED');callback('TIMED_OUT');expect(refresh).not.toHaveBeenCalled();
    callback('SUBSCRIBED');expect(refresh).toHaveBeenCalledTimes(1);
  });
});
