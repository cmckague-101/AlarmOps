import { assistantHistory, parseAssistantReply, type AssistantChatItem, type AssistantChatReply, type UserRole } from '@fireops/domain';
import { supabase } from '../supabase';

/** Whether this company has the FireOps Assistant add-on. False when unknown. */
export async function loadAssistantEnabled(companyId: string) {
  if (!supabase) return false;
  try {
    const { data, error } = await supabase.from('companies').select('assistant_enabled').eq('id', companyId).maybeSingle<{ assistant_enabled?: boolean }>();
    return !error && data?.assistant_enabled === true;
  } catch {
    return false;
  }
}

const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

/** Send the conversation (ending with the user's new message) to the assistant-chat edge function. The API key never reaches the browser. */
export async function askAssistant(companyId: string, role: UserRole, items: ReadonlyArray<AssistantChatItem>): Promise<AssistantChatReply> {
  if (!supabase) throw new Error('The assistant is unavailable in this build.');
  const { data, error } = await supabase.functions.invoke<unknown>('assistant-chat', { body: { companyId, today: localToday(), messages: assistantHistory(items) } });
  if (error) {
    let message = '';
    try { message = (await (error as { context?: Response }).context?.json?.())?.error ?? ''; } catch { /* not JSON */ }
    if (!message && typeof navigator !== 'undefined' && navigator.onLine === false) message = 'The assistant needs a network connection.';
    throw new Error(message || 'The assistant could not answer right now. Try again.');
  }
  return parseAssistantReply(data, role);
}
