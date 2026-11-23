import {describe, expect, it} from 'vitest';
import {seedAlarmBook} from './alarm-ops';
import {
  buildSeedSnapshot, filterSignals, manitouCentralStation, PRIORITY_RANK, RESPONSE_TARGET_SECONDS,
  seededCentralStation, sortQueue, waitingMinutes, workOrderFromProblem, type CentralStationSnapshot, type StationSignal,
} from './central-station';

const NOW = new Date(2026, 10, 23, 15, 42, 0);

describe('central station feed', () => {
  it('sorts the live queue by the owner priority, then by longest wait', () => {
    const snapshot = buildSeedSnapshot(NOW);
    expect(snapshot.queue.map(signal => signal.priority)).toEqual(['fire', 'burglary', 'panic', 'trouble', 'trouble', 'supervisory']);
    expect(snapshot.queue[0]).toMatchObject({id: 'sig-fire', zone: 'Zone 14 Idaho Room'});
    expect(snapshot.queue[3].id).toBe('sig-ac');
    expect(waitingMinutes(snapshot.queue[3], NOW)).toBeGreaterThan(waitingMinutes(snapshot.queue[4], NOW));
    const shuffled = sortQueue([...snapshot.queue].reverse());
    expect(shuffled.map(signal => signal.id)).toEqual(snapshot.queue.map(signal => signal.id));
    for (let index = 1; index < shuffled.length; index += 1) {
      expect(PRIORITY_RANK[shuffled[index].priority]).toBeGreaterThanOrEqual(PRIORITY_RANK[shuffled[index - 1].priority]);
    }
  });

  it('reports today response time, operators on shift, and test or runaway accounts', () => {
    const snapshot = buildSeedSnapshot(NOW);
    expect(snapshot.kpis).toMatchObject({activeAlarms: 6, averageResponseSeconds: 63, operatorsOnShift: 3, accountsInTest: 1, runawayAccounts: 1});
    const fire = snapshot.trends.responseByPriority.find(row => row.priority === 'fire')!;
    expect(fire).toMatchObject({averageSeconds: 50, targetSeconds: RESPONSE_TARGET_SECONDS.fire});
    expect(fire.averageSeconds!).toBeLessThan(fire.targetSeconds);
    const trouble = snapshot.trends.responseByPriority.find(row => row.priority === 'trouble')!;
    expect(trouble.averageSeconds!).toBeGreaterThan(trouble.targetSeconds);
  });

  it('filters signal history and keeps a received-to-close timeline', () => {
    const snapshot = buildSeedSnapshot(NOW);
    const today = '2026-11-23';
    expect(filterSignals(snapshot.queue, snapshot.accounts, {date: today})).toHaveLength(snapshot.queue.length);
    const ava = filterSignals([...snapshot.queue, ...snapshot.history], snapshot.accounts, {operatorId: 'op-ava'});
    expect(ava.length).toBeGreaterThan(0);
    expect(ava.every(signal => signal.operatorId === 'op-ava')).toBe(true);
    const smoke = filterSignals(snapshot.history, snapshot.accounts, {eventType: 'Smoke detector', accountId: 'a-library'});
    expect(smoke.length).toBeGreaterThan(0);
    expect(smoke.every(signal => signal.falseAlarm)).toBe(true);
    const closed = snapshot.history.find(signal => signal.id === 'hist-lib-1')!;
    expect(closed.steps.map(step => step.kind)).toEqual(['received', 'operator', 'call', 'close']);
  });

  it('lists false alarms, a failed timer test, low battery, and AC loss, and opens one work order', () => {
    const snapshot = buildSeedSnapshot(NOW);
    expect(snapshot.problems.map(problem => problem.kind)).toEqual(['false_alarms', 'timer_test', 'low_battery', 'ac_loss']);
    expect(snapshot.problems[0]).toMatchObject({accountId: 'a-library', customerId: 'c-library'});
    expect(snapshot.trends.falseAlarmRate[0].name).toBe('Boise Public Library');
    expect(snapshot.trends.alarmsByHour).toHaveLength(24);
    expect(snapshot.trends.alarmsByWeekday).toHaveLength(7);
    expect(snapshot.trends.alarmsByHour.reduce((sum, count) => sum + count, 0)).toBe(snapshot.queue.length + snapshot.history.length);
    const libraryPin = snapshot.pins.find(pin => pin.accountId === 'a-library')!;
    const vistaPin = snapshot.pins.find(pin => pin.accountId === 'a-vista')!;
    expect(libraryPin.status).toBe('fire');
    expect(vistaPin.status).toBe('runaway');
    let book = seedAlarmBook();
    const problem = snapshot.problems.find(item => item.kind === 'low_battery')!;
    book = workOrderFromProblem(book, problem, {jobId: 'j-battery', jobNumber: 'J-2026-050', techId: 't-chris', scheduledOn: '2026-11-23'});
    const job = book.jobs.find(item => item.id === 'j-battery')!;
    expect(job).toMatchObject({kind: 'service', status: 'scheduled', siteId: 's-coop', customerId: 'c-coop', title: 'Low battery'});
    expect(workOrderFromProblem(book, problem, {jobId: 'j-again', jobNumber: 'J-2026-051', techId: 't-chris', scheduledOn: '2026-11-23'})).toBe(book);
  });

  it('keeps the Manitou adapter behind the same source interface', async () => {
    const seed = await seededCentralStation().load(NOW);
    expect(seededCentralStation().kind).toBe('seed');
    const replacement: CentralStationSnapshot = {...seed, queue: seed.queue.slice(0, 1)};
    const source = manitouCentralStation(() => replacement);
    expect(source.kind).toBe('manitou');
    await expect(source.load(NOW)).resolves.toMatchObject({queue: [expect.objectContaining({id: 'sig-fire'})]});
    const unsorted: StationSignal[] = [...seed.queue].reverse();
    expect(sortQueue(unsorted)[0].priority).toBe('fire');
  });
});
