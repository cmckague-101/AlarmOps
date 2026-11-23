import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {seedAlarmBook} from '@fireops/domain';
import {CentralStationPage} from './CentralStationPage';

describe('central station page', () => {
  it('shows the live fire queue, map status, and problem accounts', () => {
    const html = renderToStaticMarkup(<CentralStationPage book={seedAlarmBook()} onChange={() => undefined} onOpenCustomer={() => undefined} now={new Date(2026, 10, 23, 15, 42, 0)}/>);
    expect(html).toContain('Central station');
    expect(html).toContain('Zone 14 Idaho Room');
    expect(html).toContain('Boise Public Library');
    expect(html).toContain('Create work order');
    expect(html).toContain('Failed communicator timer test');
    expect(html).toContain('Low battery');
    expect(html).toContain('AC loss');
    expect(html).toContain('Nothing here calls Manitou');
  });
});
