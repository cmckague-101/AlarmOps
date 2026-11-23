import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {seedAlarmBook} from '@fireops/domain';
import {AlarmWorkspace} from './AlarmWorkspace';

describe('Alarmco workspace', () => {
  it('renders the seeded command desk with the open quote and unpaid invoice', () => {
    const html = renderToStaticMarkup(<AlarmWorkspace section="command" book={seedAlarmBook()} onChange={() => undefined} onOpen={() => undefined} today="2026-11-23"/>);
    expect(html).toContain('Alarmco, Inc.');
    expect(html).toContain('WOSB / EDWOSB');
    expect(html).toContain("St. Luke&#x27;s Plaza Clinic");
    expect(html).toContain('Q-2026-022');
    expect(html).toContain('West entrance card reader offline');
    expect(html).toContain('$3,120.00');
  });

  it('shows the library site, monitoring contract, and panel on the customer record', () => {
    const html = renderToStaticMarkup(<AlarmWorkspace section="customers" book={seedAlarmBook()} onChange={() => undefined} onOpen={() => undefined} focusId="c-library" today="2026-11-23"/>);
    expect(html).toContain('715 S Capitol Blvd');
    expect(html).toContain('ALM-MON-1042');
    expect(html).toContain('Silent Knight 6820');
    expect(html).toContain('Monitored');
  });
});
