import { cleanAssistantThreads, type AssistantThread } from '@fireops/domain';

// Chats stay in this browser only, per user and company. They are never sent to
// the server except as context for the next message, and owners cannot see them.
const key = (userId: string, companyId: string) => `fireops-assistant:${userId}:${companyId}`;

type Stored = { threads: AssistantThread[]; activeId: string | null };

export function loadAssistantChats(userId: string, companyId: string): Stored {
  try {
    const raw = localStorage.getItem(key(userId, companyId));
    if (!raw) return { threads: [], activeId: null };
    const parsed = JSON.parse(raw) as Partial<Stored>;
    return { threads: cleanAssistantThreads(parsed.threads), activeId: typeof parsed.activeId === 'string' ? parsed.activeId : null };
  } catch {
    return { threads: [], activeId: null };
  }
}

export function saveAssistantChats(userId: string, companyId: string, value: Stored) {
  try {
    if (!value.threads.length && !value.activeId) localStorage.removeItem(key(userId, companyId));
    else localStorage.setItem(key(userId, companyId), JSON.stringify(value));
  } catch {
    // Storage full or blocked (private mode): the chat keeps working without history.
  }
}
