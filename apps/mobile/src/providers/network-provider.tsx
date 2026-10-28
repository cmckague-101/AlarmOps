import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';

import { noteAppState, notifyAppResume } from '@/lib/app-resume';

import { loadReadResponse, storeReadResponse } from '@/lib/offline-cache';

type NetworkContextValue = { isOffline: boolean };
const NetworkContext = createContext<NetworkContextValue>({ isOffline: false });
let offline = false;

function stateIsOffline(state: NetInfoState) {
  return state.isConnected === false || state.isInternetReachable === false;
}

function updateState(state: NetInfoState) {
  const wasOffline = offline;
  offline = stateIsOffline(state);
  // Reconnected: reload what realtime missed while offline.
  if (wasOffline && !offline) notifyAppResume();
  return offline;
}

export async function checkIsOffline() {
  return updateState(await NetInfo.fetch());
}

export function isOffline() {
  return offline;
}

export async function offlineAwareFetch(input: RequestInfo | URL, init?: RequestInit) {
  const request = typeof Request !== 'undefined' && input instanceof Request ? input : null;
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const read = method === 'GET' || method === 'HEAD';
  const headers = new Headers(request?.headers);
  new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
  const responseHeaders = ['accept', 'accept-profile', 'content-profile', 'prefer', 'range']
    .map((name) => `${name}:${headers.get(name) ?? ''}`).join('\n');
  const requestKey = `${method} ${url}\n${responseHeaders}`;

  if (offline) {
    if (!read) throw new Error('This action requires a connection.');
    const cached = await loadReadResponse(requestKey);
    if (cached) return cached;
    throw new Error('This data is not available offline yet. Reconnect to load it.');
  }

  try {
    const response = await fetch(input, init);
    if (read && response.ok) void storeReadResponse(requestKey, response).catch((error) => console.warn('Offline cache write failed', error));
    return response;
  } catch (error) {
    if (read) {
      const cached = await loadReadResponse(requestKey);
      if (cached) return cached;
    }
    throw error;
  }
}

export function NetworkProvider({ children }: PropsWithChildren) {
  const [isOfflineState, setIsOfflineState] = useState(offline);
  useEffect(() => NetInfo.addEventListener((state) => setIsOfflineState(updateState(state))), []);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      // Offline resumes wait for the reconnect notification instead.
      if (noteAppState(state) && !offline) notifyAppResume();
    });
    return () => subscription.remove();
  }, []);
  const value = useMemo(() => ({ isOffline: isOfflineState }), [isOfflineState]);
  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetworkStatus() {
  return useContext(NetworkContext);
}
