import {buildSeedSnapshot, type IntegrationAuditEntry, type IntegrationProvider, type PublicIntegration, type StationLoad} from '@fireops/domain';
import {supabase} from '../supabase';

type Payload = {integrations?: PublicIntegration[]; audit?: IntegrationAuditEntry[]; error?: string};

/** Signed-in credential desk. The function returns masks and audit lines, never secrets. */
export class RemoteIntegrationDesk {
  private records: PublicIntegration[] = [];
  private entries: IntegrationAuditEntry[] = [];
  constructor(private readonly companyId: string) {}
  list() { return this.records; }
  audit() { return this.entries; }
  async refresh() {
    const data = await this.call({action: 'list'});
    this.records = data.integrations ?? [];
    this.entries = data.audit ?? [];
  }
  async save(provider: IntegrationProvider, values: Record<string, string>, _actor: string) {
    const data = await this.call({action: 'save', provider, values});
    this.apply(data);
    const saved = this.records.find(item => item.provider === provider);
    if (!saved) throw new Error('Credentials could not be saved.');
    return saved;
  }
  async remove(provider: IntegrationProvider, _actor: string) {
    this.apply(await this.call({action: 'delete', provider}));
  }
  async test(provider: IntegrationProvider, _actor: string) {
    this.apply(await this.call({action: 'test', provider}));
    const integration = this.records.find(item => item.provider === provider);
    if (!integration) throw new Error('The connection could not be tested.');
    return {ok: integration.lastTestOk === true, message: integration.lastTestMessage ?? 'Tested.', integration};
  }
  async loadStation(): Promise<StationLoad> {
    if (!supabase) return {snapshot: buildSeedSnapshot(new Date()), using: 'seed'};
    const {data, error} = await supabase.functions.invoke<StationLoad>('integration-vault', {body: {companyId: this.companyId, action: 'station'}});
    if (error || !data?.snapshot) return {snapshot: buildSeedSnapshot(new Date()), using: 'seed'};
    return data;
  }
  private apply(data: Payload) {
    if (data.integrations) this.records = data.integrations;
    if (data.audit) this.entries = data.audit;
  }
  private async call(body: {action: string; provider?: IntegrationProvider; values?: Record<string, string>}) {
    if (!supabase) throw new Error('AlarmOps is not connected.');
    const {data, error} = await supabase.functions.invoke<Payload>('integration-vault', {body: {companyId: this.companyId, ...body}});
    if (error) throw new Error(error.message || 'Credentials could not be changed.');
    if (!data || data.error) throw new Error(data?.error || 'Credentials could not be changed.');
    return data;
  }
}
