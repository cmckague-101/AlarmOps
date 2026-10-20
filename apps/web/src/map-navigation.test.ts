import {describe, expect, it} from 'vitest';
import {constrainMapFrame, NATIONAL_FRAME, zoomMapFrame} from './map-navigation';

describe('incident map navigation', () => {
  it('zooms around the center by default', () => {
    expect(zoomMapFrame(NATIONAL_FRAME, .5)).toEqual([225, 140, 450, 280]);
  });
  it('keeps the clicked location anchored', () => {
    expect(zoomMapFrame(NATIONAL_FRAME, .5, [100, 100])).toEqual([50, 50, 450, 280]);
  });
  it('limits zoom in and zoom out', () => {
    expect(zoomMapFrame(NATIONAL_FRAME, 100)).toEqual(NATIONAL_FRAME);
    expect(zoomMapFrame(NATIONAL_FRAME, .001)[2]).toBe(900 / 16);
  });
  it('keeps panning within the national map', () => {
    expect(constrainMapFrame([-20, 500, 450, 280])).toEqual([0, 280, 450, 280]);
  });
});
