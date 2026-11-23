import {describe, expect, it} from 'vitest';
import {canManageIntegrations} from './models';
import {buildSeedSnapshot} from './central-station';
import {IntegrationVault, openSecret} from './integrations';

const KEY = 'test-vault-key';
const MOTIVE_KEY = 'motive-live-key-9876';
const ACTOR = 'Elena Voss';

function jsonFetch(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}})) as typeof fetch;
}

describe('integration credential vault', () => {
  it('returns only the last four characters and keeps the secret out of the public record', async () => {
    const vault = new IntegrationVault(KEY, jsonFetch(200, {}));
    const saved = await vault.save('motive', {apiKey: MOTIVE_KEY}, ACTOR);
    expect(saved.secrets).toEqual([{field: 'apiKey', lastFour: '9876'}]);
    expect(JSON.stringify(vault.list())).not.toContain(MOTIVE_KEY);
    expect(JSON.stringify(vault.audit())).not.toContain(MOTIVE_KEY);
    const sealed = vault.sealedRecords()[0].secrets[0];
    expect(sealed.ciphertext).not.toContain(MOTIVE_KEY);
    expect(await openSecret(sealed.ciphertext, sealed.iv, KEY)).toBe(MOTIVE_KEY);
  });

  it('keeps a blank secret on edit and rotates it when a new one is saved', async () => {
    const vault = new IntegrationVault(KEY, jsonFetch(200, {}));
    await vault.save('motive', {apiKey: MOTIVE_KEY}, ACTOR);
    const edited = await vault.save('motive', {apiKey: ''}, ACTOR);
    expect(edited.secrets[0].lastFour).toBe('9876');
    const rotated = await vault.save('motive', {apiKey: 'rotated-key-4321'}, ACTOR);
    expect(rotated.secrets[0].lastFour).toBe('4321');
    expect(vault.audit()[0].summary).toContain('Rotated API key');
    expect(vault.audit()[0].summary).not.toContain('4321');
  });

  it('rejects secrets in the URL and deletes a provider', async () => {
    const vault = new IntegrationVault(KEY, jsonFetch(401, {}));
    await expect(vault.save('manitou', {baseUrl: 'http://manitou.example', authMode: 'api_key', apiKey: 'long-enough-key'}, ACTOR)).rejects.toThrow(/https/);
    await expect(vault.save('manitou', {baseUrl: 'https://user:secret@manitou.example', authMode: 'api_key', apiKey: 'long-enough-key'}, ACTOR)).rejects.toThrow(/own fields/);
    await vault.save('manitou', {baseUrl: 'https://manitou.example/api', authMode: 'password', username: 'desk', password: 'long-password'}, ACTOR);
    await vault.remove('manitou', ACTOR);
    expect(vault.list().find(item => item.provider === 'manitou')?.status).toBe('disconnected');
    expect(vault.list().find(item => item.provider === 'manitou')?.secrets).toEqual([]);
    expect(vault.audit()[0].summary).toContain('removed Manitou');
  });

  it('tests a connection without echoing the secret and leaves QuickBooks disconnected', async () => {
    const vault = new IntegrationVault(KEY, jsonFetch(200, {issuer: 'intuit'}));
    await vault.save('quickbooks', {clientId: 'client-id-value', clientSecret: 'client-secret-value', realmId: '123456789'}, ACTOR);
    const tested = await vault.test('quickbooks', ACTOR);
    expect(tested.ok).toBe(true);
    expect(tested.integration.status).toBe('disconnected');
    expect(tested.message).not.toContain('client-secret-value');
    expect(vault.audit()[0].summary).not.toContain('client-secret-value');
  });

  it('uses Manitou when the sealed credentials return a snapshot and demo data otherwise', async () => {
    const now = new Date(2026, 10, 23, 15, 42, 0);
    const empty = new IntegrationVault(KEY, jsonFetch(500, {}));
    expect((await empty.loadStation(now)).using).toBe('seed');
    const refused = new IntegrationVault(KEY, jsonFetch(401, {}));
    await refused.save('manitou', {baseUrl: 'https://manitou.example/api', authMode: 'api_key', apiKey: 'manitou-api-key'}, ACTOR);
    expect((await refused.loadStation(now)).using).toBe('seed');
    const live = buildSeedSnapshot(now);
    live.queue = live.queue.slice(0, 1);
    const accepted = new IntegrationVault(KEY, jsonFetch(200, live));
    await accepted.save('manitou', {baseUrl: 'https://manitou.example/api', authMode: 'api_key', apiKey: 'manitou-api-key'}, ACTOR);
    const loaded = await accepted.loadStation(now);
    expect(loaded.using).toBe('manitou');
    expect(loaded.snapshot.queue).toHaveLength(1);
  });

  it('limits credential management to owners and admins', () => {
    expect(canManageIntegrations('owner')).toBe(true);
    expect(canManageIntegrations('admin')).toBe(true);
    for (const role of ['accounting', 'shop_tech', 'fire_fighter', 'resource_boss'] as const) expect(canManageIntegrations(role)).toBe(false);
  });
});
