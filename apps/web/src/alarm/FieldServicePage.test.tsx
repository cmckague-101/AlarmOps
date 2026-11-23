import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {demoTechTime, seedAlarmBook} from '@fireops/domain';
import {FieldServicePage} from './FieldServicePage';

const book = seedAlarmBook();
const vehicles = [{id: 'v1', unit: 'Engine 701'}, {id: 'v2', unit: 'Tender 12'}, {id: 'v3', unit: 'Dozer 4'}];

describe('field service page', () => {
  it('shows the dispatch board, unassigned work order, roster, and tech time for an owner', () => {
    const board = renderToStaticMarkup(<FieldServicePage book={book} onChange={() => undefined} techTime={demoTechTime()} onTechTime={() => undefined} today="2026-11-23" role="owner" userName="Elena Voss" vehicles={vehicles} quickBooksConnected demoMode onOpen={() => undefined}/>);
    expect(board).toContain('Field Service');
    expect(board).toContain('Panel trouble follow-up');
    expect(board).toContain('Lena Ortiz');
    const roster = renderToStaticMarkup(<FieldServicePage book={book} onChange={() => undefined} techTime={demoTechTime()} onTechTime={() => undefined} today="2026-11-23" role="owner" userName="Elena Voss" vehicles={vehicles} quickBooksConnected demoMode onOpen={() => undefined} initialView="roster"/>);
    expect(roster).toContain('Engine 701');
    expect(roster).toContain('NICET II');
    const time = renderToStaticMarkup(<FieldServicePage book={book} onChange={() => undefined} techTime={demoTechTime()} onTechTime={() => undefined} today="2026-11-23" role="owner" userName="Elena Voss" vehicles={vehicles} quickBooksConnected demoMode onOpen={() => undefined} initialView="time"/>);
    expect(time).toContain('Clock in');
    expect(time).toContain('Premium Silver');
    expect(time).toContain('Chris Hale → Chris Hale (56)');
    expect(time).toContain('8 overtime');
  });

  it('limits a technician to their own jobs', () => {
    const html = renderToStaticMarkup(<FieldServicePage book={book} onChange={() => undefined} techTime={demoTechTime()} onTechTime={() => undefined} today="2026-11-23" role="shop_tech" userName="Chris Hale" vehicles={vehicles} quickBooksConnected demoMode onOpen={() => undefined}/>);
    expect(html).toContain('West entrance card reader offline');
    expect(html).not.toContain('Panel trouble follow-up');
    expect(html).not.toContain('Hyde Park annual inspection');
    expect(html).not.toContain('Approve 2026-11-16');
  });
});
