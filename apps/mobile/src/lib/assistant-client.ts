import { assistantHistory, parseAssistantReply, type AssistantChatItem, type AssistantChatReply, type UserRole } from '@fireops/domain';
import { isDemoActive, supabase } from './supabase';

/** Whether this company has the FireOps Assistant add-on. Offline, the last cached answer is used; false when unknown. Never in demo. */
export async function loadAssistantEnabled(companyId: string) {
  if (!supabase || isDemoActive()) return false;
  try {
    const { data, error } = await supabase.from('companies').select('assistant_enabled').eq('id', companyId).maybeSingle<{ assistant_enabled?: boolean }>();
    return !error && data?.assistant_enabled === true;
  } catch {
    return false;
  }
}

/** Voice is a separate paid switch and also requires the chat add-on. */
export async function loadAssistantVoiceEnabled(companyId: string) {
  if (!supabase || isDemoActive()) return false;
  try {
    const {data,error} = await supabase.from('companies').select('assistant_enabled,assistant_voice_enabled').eq('id',companyId).maybeSingle<{assistant_enabled?:boolean;assistant_voice_enabled?:boolean}>();
    return !error && data?.assistant_enabled === true && data?.assistant_voice_enabled === true;
  } catch { return false; }
}

const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

/** Send the conversation (ending with the user's new message) to the assistant-chat edge function. The API key stays on the server. */
export async function askAssistant(companyId: string, role: UserRole, items: ReadonlyArray<AssistantChatItem>): Promise<AssistantChatReply> {
  if (!supabase || isDemoActive()) throw new Error('The assistant is unavailable here.');
  const { data, error } = await supabase.functions.invoke<unknown>('assistant-chat', { body: { companyId, today: localToday(), messages: assistantHistory(items) } });
  if (error) {
    let message = '';
    try { message = (await (error as { context?: Response }).context?.json?.())?.error ?? ''; } catch { /* not JSON */ }
    if (!message && /connection/i.test(error.message)) message = 'The assistant needs a network connection.';
    throw new Error(message || 'The assistant could not answer right now. Try again.');
  }
  return parseAssistantReply(data, role);
}
