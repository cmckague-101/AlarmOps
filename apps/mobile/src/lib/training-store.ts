import { useEffect, useSyncExternalStore } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Training, TrainingSignup } from '@fireops/domain';

import { supabase } from '@/lib/supabase';

export type TrainingValues = Omit<Training, 'id' | 'createdAt' | 'updatedAt' | 'viewedAt' | 'signups'>;

type TrainingRow = {
  id: string;
  course_code: string;
  course_title: string;
  starts_at: string;
  location: string;
  instructor: string;
  capacity: number;
  course_information: string;
  created_at: string;
  updated_at: string;
};
type SignupRow = { training_id: string; user_id: string; user_name: string; signed_up_at: string };
type ReadRow = { training_id: string; viewed_at: string };
type TrainingSnapshot = { trainings: Training[]; loading: boolean; refreshing: boolean; error: string | null };

let snapshot: TrainingSnapshot = { trainings: [], loading: true, refreshing: false, error: null };
let activeCompanyId: string | null | undefined;
let activeUserId: string | null | undefined;
let selectionVersion = 0;
let request: Promise<void> | null = null;
let requestVersion = -1;
let refreshQueued = false;
let channel: RealtimeChannel | null = null;
const listeners = new Set<() => void>();

function emit(next: TrainingSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function signupFromRow(row: SignupRow): TrainingSignup {
  return { userId: row.user_id, userName: row.user_name, signedUpAt: row.signed_up_at };
}

function fromRow(row: TrainingRow, signups: SignupRow[] = [], viewedAt?: string): Training {
  return {
    id: row.id,
    courseCode: row.course_code,
    courseTitle: row.course_title,
    date: row.starts_at,
    location: row.location,
    instructor: row.instructor,
    capacity: row.capacity,
    information: row.course_information,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    viewedAt,
    signups: signups.filter((signup) => signup.training_id === row.id).map(signupFromRow),
  };
}

function orderTrainings(trainings: Training[]) {
  return [...trainings].sort((left, right) => Date.parse(left.date) - Date.parse(right.date));
}

export function refreshTrainings() {
  if (request && requestVersion === selectionVersion) {
    refreshQueued = true;
    return request;
  }
  refreshQueued = false;
  const version = selectionVersion;
  const companyId = activeCompanyId;
  const userId = activeUserId;
  emit({ ...snapshot, loading: snapshot.trainings.length === 0, refreshing: snapshot.trainings.length > 0, error: null });

  request = (async () => {
    if (!supabase) {
      emit({ ...snapshot, loading: false, refreshing: false, error: 'Training could not load. Supabase is not configured for this build.' });
      return;
    }
    if (!companyId || !userId) {
      if (version === selectionVersion) emit({ trainings: [], loading: false, refreshing: false, error: null });
      return;
    }
    try {
      const [trainingResult, signupResult, readResult] = await Promise.all([
        supabase.from('company_trainings').select('id,course_code,course_title,starts_at,location,instructor,capacity,course_information,created_at,updated_at').eq('company_id', companyId).order('starts_at', { ascending: true }),
        supabase.from('company_training_signups').select('training_id,user_id,user_name,signed_up_at').eq('company_id', companyId),
        supabase.from('company_training_reads').select('training_id,viewed_at').eq('company_id', companyId).eq('user_id', userId),
      ]);
      if (version !== selectionVersion) return;
      const failed = trainingResult.error ?? signupResult.error ?? readResult.error;
      if (failed) {
        emit({ ...snapshot, loading: false, refreshing: false, error: `Training could not load. ${failed.message}` });
        return;
      }
      const signupsByTraining = new Map<string, SignupRow[]>();
      for (const signup of (signupResult.data ?? []) as SignupRow[]) {
        const signups = signupsByTraining.get(signup.training_id) ?? [];
        signups.push(signup);
        signupsByTraining.set(signup.training_id, signups);
      }
      const reads = new Map(((readResult.data ?? []) as ReadRow[]).map((read) => [read.training_id, read.viewed_at]));
      const trainings = ((trainingResult.data ?? []) as TrainingRow[]).map((row) => fromRow(row, signupsByTraining.get(row.id), reads.get(row.id)));
      emit({ trainings: orderTrainings(trainings), loading: false, refreshing: false, error: null });
    } catch (loadError) {
      if (version !== selectionVersion) return;
      const detail = loadError instanceof Error ? loadError.message : 'Network request failed.';
      emit({ ...snapshot, loading: false, refreshing: false, error: `Training could not load. ${detail}` });
    }
  })().finally(() => {
    if (requestVersion !== version) return;
    request = null;
    if (refreshQueued && version === selectionVersion) {
      refreshQueued = false;
      void refreshTrainings();
    }
  });
  requestVersion = version;
  return request;
}

function databaseValues(values: TrainingValues) {
  return {
    course_code: values.courseCode,
    course_title: values.courseTitle,
    starts_at: values.date,
    location: values.location,
    instructor: values.instructor,
    capacity: values.capacity,
    course_information: values.information,
  };
}

export async function createTraining(values: TrainingValues) {
  if (!supabase || !activeCompanyId) throw new Error('Company training is unavailable.');
  const { data, error } = await supabase
    .from('company_trainings')
    .insert({ company_id: activeCompanyId, ...databaseValues(values) })
    .select('id,course_code,course_title,starts_at,location,instructor,capacity,course_information,created_at,updated_at')
    .single<TrainingRow>();
  if (error) throw new Error(error.message);
  const training = fromRow(data);
  emit({ ...snapshot, trainings: orderTrainings([training, ...snapshot.trainings.filter((item) => item.id !== training.id)]) });
  return training;
}

export async function updateTraining(training: Training, values: TrainingValues) {
  if (!supabase || !activeCompanyId) throw new Error('Company training is unavailable.');
  const { data, error } = await supabase
    .from('company_trainings')
    .update(databaseValues(values))
    .eq('company_id', activeCompanyId)
    .eq('id', training.id)
    .select('id,course_code,course_title,starts_at,location,instructor,capacity,course_information,created_at,updated_at')
    .single<TrainingRow>();
  if (error) throw new Error(error.message);
  const next = { ...fromRow(data), viewedAt: training.viewedAt, signups: training.signups };
  emit({ ...snapshot, trainings: orderTrainings([next, ...snapshot.trainings.filter((item) => item.id !== next.id)]) });
  return next;
}

export async function deleteTraining(trainingId: string) {
  if (!supabase || !activeCompanyId) throw new Error('Company training is unavailable.');
  const { error } = await supabase.from('company_trainings').delete().eq('company_id', activeCompanyId).eq('id', trainingId);
  if (error) throw new Error(error.message);
  emit({ ...snapshot, trainings: snapshot.trainings.filter((item) => item.id !== trainingId) });
}

export async function signupForTraining(trainingId: string, userName: string) {
  if (!supabase || !activeCompanyId || !activeUserId) throw new Error('Company training is unavailable.');
  const { data, error } = await supabase
    .from('company_training_signups')
    .insert({ company_id: activeCompanyId, training_id: trainingId, user_id: activeUserId, user_name: userName })
    .select('training_id,user_id,user_name,signed_up_at')
    .single<SignupRow>();
  if (error) throw new Error(error.message.toLowerCase().includes('full') ? 'Course is full.' : error.message);
  const signup = signupFromRow(data);
  emit({
    ...snapshot,
    trainings: snapshot.trainings.map((training) => training.id === trainingId
      ? { ...training, signups: [...training.signups.filter((item) => item.userId !== signup.userId), signup] }
      : training),
  });
  return signup;
}

export async function cancelTrainingSignup(trainingId: string) {
  if (!supabase || !activeCompanyId || !activeUserId) throw new Error('Company training is unavailable.');
  const { error } = await supabase
    .from('company_training_signups')
    .delete()
    .eq('company_id', activeCompanyId)
    .eq('training_id', trainingId)
    .eq('user_id', activeUserId);
  if (error) throw new Error(error.message);
  emit({
    ...snapshot,
    trainings: snapshot.trainings.map((training) => training.id === trainingId
      ? { ...training, signups: training.signups.filter((signup) => signup.userId !== activeUserId) }
      : training),
  });
}

export async function markTrainingViewed(trainingId: string) {
  if (!supabase || !activeCompanyId || !activeUserId) throw new Error('Company training is unavailable.');
  const viewedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('company_training_reads')
    .upsert(
      { company_id: activeCompanyId, training_id: trainingId, user_id: activeUserId, viewed_at: viewedAt },
      { onConflict: 'company_id,training_id,user_id' },
    )
    .select('viewed_at')
    .single<{ viewed_at: string }>();
  if (error) throw new Error(error.message);
  emit({ ...snapshot, trainings: snapshot.trainings.map((training) => training.id === trainingId ? { ...training, viewedAt: data.viewed_at } : training) });
  return data.viewed_at;
}

function selectAccount(companyId: string | null, userId: string | null) {
  if (companyId === activeCompanyId && userId === activeUserId) return;
  activeCompanyId = companyId;
  activeUserId = userId;
  selectionVersion += 1;
  refreshQueued = false;
  if (channel && supabase) void supabase.removeChannel(channel);
  channel = null;
  emit({ trainings: [], loading: Boolean(companyId && userId), refreshing: false, error: null });
  if (!companyId || !userId || !supabase) return;
  channel = supabase.channel(`mobile-training:${companyId}:${userId}`);
  ['company_trainings', 'company_training_signups', 'company_training_reads'].forEach((table) => {
    channel = channel?.on('postgres_changes', { event: '*', schema: 'public', table, filter: `company_id=eq.${companyId}` }, () => void refreshTrainings()) ?? null;
  });
  channel?.subscribe();
  void refreshTrainings();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTrainings(companyId: string | null, userId: string | null) {
  useEffect(() => selectAccount(companyId, userId), [companyId, userId]);
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}
