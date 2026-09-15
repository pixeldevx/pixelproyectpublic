import { supabase, SUPABASE_DOCUMENTS_TABLE } from './client';
import { getClientWorkspace, requireClientWorkspace } from '@/lib/workspaces/client-context';

type Primitive = string | number | boolean | null;
type DataValue = Primitive | DataValue[] | { [key: string]: DataValue };

type Row = {
  id?: string;
  collection_path: string;
  doc_id: string;
  data: Record<string, any>;
  created_at?: string;
  updated_at?: string;
};

type WhereOperator = '==' | '!=' | 'array-contains' | 'in';

type WhereConstraint = {
  type: 'where';
  field: string;
  op: WhereOperator;
  value: any;
};

type OrderConstraint = {
  type: 'orderBy';
  field: string;
  direction: 'asc' | 'desc';
};

type OrConstraint = {
  type: 'or';
  constraints: WhereConstraint[];
};

type QueryConstraint = WhereConstraint | OrderConstraint | OrConstraint;

const SERVER_TIMESTAMP = Symbol('serverTimestamp');
const LOCAL_DOCUMENT_CHANGE_EVENT = 'pixel-project:document-store-change';
const COLLECTION_FETCH_PAGE_SIZE = 1000;
const BULK_WRITE_CHUNK_SIZE = 250;
const BULK_READ_ID_CHUNK_SIZE = 250;
const REMOTE_CHANGE_DEBOUNCE_MS = 450;
const REALTIME_CHANNEL_RELEASE_DELAY_MS = 750;
const DOCUMENT_SELECT_COLUMNS = 'collection_path,doc_id,data,created_at,updated_at';

class IncrementTransform {
  constructor(public by: number) {}
}

class ArrayUnionTransform {
  constructor(public values: any[]) {}
}

class ArrayRemoveTransform {
  constructor(public values: any[]) {}
}

export class Timestamp {
  private date: Date;

  constructor(date: Date | string | number) {
    this.date = date instanceof Date ? date : new Date(date);
  }

  static now() {
    return new Timestamp(new Date());
  }

  static fromDate(date: Date) {
    return new Timestamp(date);
  }

  toDate() {
    return this.date;
  }

  toMillis() {
    return this.date.getTime();
  }

  toJSON() {
    return this.date.toISOString();
  }
}

export type CollectionReference = {
  kind: 'collection';
  collectionPath: string;
  id: string;
  path: string;
  parent: DocumentReference | null;
  isCollectionGroup?: boolean;
};

export type DocumentReference = {
  kind: 'doc';
  collectionPath: string;
  id: string;
  path: string;
  parent: CollectionReference;
};

export type SupabaseQuery = {
  kind: 'query';
  source: CollectionReference;
  constraints: QueryConstraint[];
};

const flattenSegments = (segments: unknown[]) =>
  segments
    .flatMap((segment) =>
      String(segment)
        .split('/')
        .map((part) => part.trim())
        .filter(Boolean)
    );

const randomId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
};

type LocalDocumentChangeDetail = {
  collectionPath: string;
  docId: string;
};

type BatchOperation =
  | { type: 'set'; ref: DocumentReference; data: Record<string, any>; options?: { merge?: boolean } }
  | { type: 'update'; ref: DocumentReference; data: Record<string, any> }
  | { type: 'delete'; ref: DocumentReference };

const emitLocalDocumentChange = (ref: DocumentReference) => {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new CustomEvent<LocalDocumentChangeDetail>(LOCAL_DOCUMENT_CHANGE_EVENT, {
    detail: {
      collectionPath: ref.collectionPath,
      docId: ref.id,
    },
  }));
};

const documentKey = (ref: DocumentReference) => `${ref.collectionPath}\u0000${ref.id}`;

const chunkArray = <T,>(items: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const getUniqueRefs = (refs: DocumentReference[]) => {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = documentKey(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const getQuerySource = (source: CollectionReference | SupabaseQuery) =>
  (source as SupabaseQuery).kind === 'query'
    ? (source as SupabaseQuery).source
    : (source as CollectionReference);

const getWatchedCollection = (source: DocumentReference | CollectionReference | SupabaseQuery) => {
  if ((source as DocumentReference).kind === 'doc') {
    return {
      collectionPath: (source as DocumentReference).collectionPath,
      docId: (source as DocumentReference).id,
      isCollectionGroup: false,
      collectionGroupId: null as string | null,
    };
  }

  const collectionRef = getQuerySource(source as CollectionReference | SupabaseQuery);
  return {
    collectionPath: collectionRef.collectionPath,
    docId: null as string | null,
    isCollectionGroup: Boolean(collectionRef.isCollectionGroup),
    collectionGroupId: collectionRef.isCollectionGroup ? collectionRef.id : null,
  };
};

const rowBelongsToCollectionGroup = (collectionPath: string, collectionGroupId: string) =>
  collectionPath === collectionGroupId || collectionPath.endsWith(`/${collectionGroupId}`);

const changeMatchesSource = (
  source: DocumentReference | CollectionReference | SupabaseQuery,
  change: { collectionPath?: string | null; docId?: string | null }
) => {
  const watched = getWatchedCollection(source);
  if (!change.collectionPath) return true;

  if (watched.isCollectionGroup && watched.collectionGroupId) {
    return rowBelongsToCollectionGroup(change.collectionPath, watched.collectionGroupId);
  }

  if (change.collectionPath !== watched.collectionPath) return false;
  if (watched.docId) return change.docId === watched.docId;
  return true;
};

const getRealtimeFilter = (_source: DocumentReference | CollectionReference | SupabaseQuery) =>
  `tenant_id=eq.${requireClientWorkspace()}`;

type SharedRealtimeListener = (payload: any) => void;

type SharedRealtimeChannel = {
  channel: ReturnType<typeof supabase.channel>;
  listeners: Set<SharedRealtimeListener>;
  releaseTimer: ReturnType<typeof setTimeout> | null;
};

const sharedRealtimeChannels = new Map<string, SharedRealtimeChannel>();

const acquireSharedRealtimeChannel = (
  source: DocumentReference | CollectionReference | SupabaseQuery,
  listener: SharedRealtimeListener,
) => {
  const realtimeFilter = getRealtimeFilter(source);
  const channelKey = `${getClientWorkspace()}:${realtimeFilter || 'all_documents'}`;
  let shared = sharedRealtimeChannels.get(channelKey);

  if (!shared) {
    const listeners = new Set<SharedRealtimeListener>();
    const postgresChangesConfig = {
      event: '*' as const,
      schema: 'public',
      table: SUPABASE_DOCUMENTS_TABLE,
      ...(realtimeFilter ? { filter: realtimeFilter } : {}),
    };
    const channel = supabase
      .channel(`app_documents_shared_${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        postgresChangesConfig,
        (payload) => {
          Array.from(listeners).forEach((currentListener) => currentListener(payload));
        },
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(`Supabase Realtime channel ${channelKey} reported ${status}.`);
        }
      });

    shared = {
      channel,
      listeners,
      releaseTimer: null,
    };
    sharedRealtimeChannels.set(channelKey, shared);
  } else if (shared.releaseTimer) {
    clearTimeout(shared.releaseTimer);
    shared.releaseTimer = null;
  }

  shared.listeners.add(listener);

  return () => {
    const current = sharedRealtimeChannels.get(channelKey);
    if (!current) return;

    current.listeners.delete(listener);
    if (current.listeners.size > 0 || current.releaseTimer) return;

    current.releaseTimer = setTimeout(() => {
      const latest = sharedRealtimeChannels.get(channelKey);
      if (!latest || latest.listeners.size > 0) return;
      sharedRealtimeChannels.delete(channelKey);
      void supabase.removeChannel(latest.channel);
    }, REALTIME_CHANNEL_RELEASE_DELAY_MS);
  };
};

const parentDocForCollectionPath = (collectionPath: string): DocumentReference | null => {
  const segments = flattenSegments([collectionPath]);
  if (segments.length < 3) return null;

  const parentDocSegments = segments.slice(0, -1);
  return createDocRef(parentDocSegments);
};

const createCollectionRef = (segments: string[], isCollectionGroup = false): CollectionReference => {
  const path = segments.join('/');
  return {
    kind: 'collection',
    collectionPath: path,
    id: segments[segments.length - 1] || path,
    path,
    parent: isCollectionGroup ? null : parentDocForCollectionPath(path),
    isCollectionGroup,
  };
};

const createDocRef = (segments: string[]): DocumentReference => {
  const id = segments[segments.length - 1] || randomId();
  const collectionSegments = segments.slice(0, -1);
  const parent = createCollectionRef(collectionSegments);
  return {
    kind: 'doc',
    collectionPath: parent.collectionPath,
    id,
    path: segments.join('/'),
    parent,
  };
};

export const collection = (_db: unknown, ...pathSegments: unknown[]) => {
  return createCollectionRef(flattenSegments(pathSegments));
};

export const collectionGroup = (_db: unknown, collectionId: string) => {
  return createCollectionRef([collectionId], true);
};

export const doc = (base: unknown, ...pathSegments: unknown[]) => {
  if ((base as CollectionReference)?.kind === 'collection') {
    const collectionRef = base as CollectionReference;
    const id = pathSegments.length ? flattenSegments(pathSegments)[0] : randomId();
    return createDocRef([...flattenSegments([collectionRef.collectionPath]), id]);
  }

  const segments = flattenSegments(pathSegments);
  if (segments.length === 0) {
    throw new Error('doc() requires a document path or a collection reference.');
  }
  return createDocRef(segments);
};

export const where = (field: string, op: WhereOperator, value: any): WhereConstraint => ({
  type: 'where',
  field,
  op,
  value,
});

export const orderBy = (field: string, direction: 'asc' | 'desc' = 'asc'): OrderConstraint => ({
  type: 'orderBy',
  field,
  direction,
});

export const or = (...constraints: WhereConstraint[]): OrConstraint => ({
  type: 'or',
  constraints,
});

export const query = (source: CollectionReference, ...constraints: QueryConstraint[]): SupabaseQuery => ({
  kind: 'query',
  source,
  constraints,
});

export const serverTimestamp = () => SERVER_TIMESTAMP;
export const increment = (by: number) => new IncrementTransform(by);
export const arrayUnion = (...values: any[]) => new ArrayUnionTransform(values);
export const arrayRemove = (...values: any[]) => new ArrayRemoveTransform(values);

const isIsoDateString = (value: string) =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value) && !Number.isNaN(Date.parse(value));

const shouldHydrateTimestamp = (key: string, value: string) => {
  if (!isIsoDateString(value)) return false;
  const normalized = key.toLowerCase();
  return (
    normalized === 'date' ||
    normalized.includes('date') ||
    normalized.endsWith('at') ||
    normalized.includes('timestamp')
  );
};

const hydrateValue = (value: any, key = ''): any => {
  if (Array.isArray(value)) return value.map((item) => hydrateValue(item, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, hydrateValue(entryValue, entryKey)]));
  }
  if (typeof value === 'string' && shouldHydrateTimestamp(key, value)) {
    return new Timestamp(value);
  }
  return value;
};

const normalizeValue = (value: any): DataValue | undefined => {
  if (value === undefined) return undefined;
  if (value === SERVER_TIMESTAMP) return new Date().toISOString();
  if (value instanceof Timestamp) return value.toJSON();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item)).filter((item) => item !== undefined) as DataValue[];
  }
  if (value && typeof value === 'object') {
    if (value instanceof IncrementTransform || value instanceof ArrayUnionTransform || value instanceof ArrayRemoveTransform) {
      return value as any;
    }
    return Object.fromEntries(
      Object.entries(value)
        .map(([entryKey, entryValue]) => [entryKey, normalizeValue(entryValue)])
        .filter(([, entryValue]) => entryValue !== undefined)
    ) as { [key: string]: DataValue };
  }
  return value as DataValue;
};

const normalizeData = (data: Record<string, any>) =>
  Object.fromEntries(
    Object.entries(data)
      .map(([key, value]) => [key, normalizeValue(value)])
      .filter(([, value]) => value !== undefined)
  );

const getByPath = (data: Record<string, any>, path: string) => {
  return path.split('.').reduce((current: any, part) => (current == null ? undefined : current[part]), data);
};

const setByPath = (data: Record<string, any>, path: string, value: any) => {
  const parts = path.split('.');
  let current = data;
  parts.slice(0, -1).forEach((part) => {
    if (!current[part] || typeof current[part] !== 'object' || Array.isArray(current[part])) {
      current[part] = {};
    }
    current = current[part];
  });
  current[parts[parts.length - 1]] = value;
};

const stableStringify = (value: any) => JSON.stringify(normalizeValue(value));
const collectionFetchInFlight = new Map<string, Promise<Row[]>>();

const getCollectionFetchKey = (source: CollectionReference, constraints: QueryConstraint[] = []) =>
  stableStringify({
    workspaceId: getClientWorkspace(),
    collectionPath: source.collectionPath,
    collectionGroup: source.isCollectionGroup ? source.id : null,
    constraints,
  });

const applyUpdate = (base: Record<string, any>, update: Record<string, any>) => {
  const next = { ...base };

  Object.entries(update).forEach(([key, rawValue]) => {
    const current = getByPath(next, key);

    if (rawValue instanceof IncrementTransform) {
      setByPath(next, key, (Number(current) || 0) + rawValue.by);
      return;
    }

    if (rawValue instanceof ArrayUnionTransform) {
      const currentArray = Array.isArray(current) ? current : [];
      const known = new Set(currentArray.map((item) => stableStringify(item)));
      const valuesToAdd = rawValue.values.filter((item) => !known.has(stableStringify(item)));
      setByPath(next, key, [...currentArray, ...valuesToAdd]);
      return;
    }

    if (rawValue instanceof ArrayRemoveTransform) {
      const removeSet = new Set(rawValue.values.map((item) => stableStringify(item)));
      const currentArray = Array.isArray(current) ? current : [];
      setByPath(
        next,
        key,
        currentArray.filter((item) => !removeSet.has(stableStringify(item)))
      );
      return;
    }

    const value = normalizeValue(rawValue);
    if (value !== undefined) {
      setByPath(next, key, value);
    }
  });

  return next;
};

export class QueryDocumentSnapshot {
  id: string;
  ref: DocumentReference;
  private row: Row;

  constructor(row: Row) {
    this.id = row.doc_id;
    this.ref = createDocRef([...flattenSegments([row.collection_path]), row.doc_id]);
    this.row = row;
  }

  data() {
    return hydrateValue(this.row.data);
  }
}

export class DocumentSnapshot {
  id: string;
  ref: DocumentReference;
  private row: Row | null;

  constructor(ref: DocumentReference, row: Row | null) {
    this.id = ref.id;
    this.ref = ref;
    this.row = row;
  }

  exists() {
    return Boolean(this.row);
  }

  data() {
    return this.row ? hydrateValue(this.row.data) : undefined;
  }
}

export class QuerySnapshot {
  docs: QueryDocumentSnapshot[];
  empty: boolean;

  constructor(rows: Row[]) {
    this.docs = rows.map((row) => new QueryDocumentSnapshot(row));
    this.empty = this.docs.length === 0;
  }

  forEach(callback: (doc: QueryDocumentSnapshot) => void) {
    this.docs.forEach(callback);
  }
}

const matchesWhere = (row: Row, data: Record<string, any>, constraint: WhereConstraint) => {
  const actual = constraint.field === '__name__' ? row.doc_id : getByPath(data, constraint.field);
  switch (constraint.op) {
    case '==':
      return actual === constraint.value;
    case '!=':
      return actual !== constraint.value;
    case 'array-contains':
      return Array.isArray(actual) && actual.includes(constraint.value);
    case 'in':
      return Array.isArray(constraint.value) && constraint.value.includes(actual);
    default:
      return false;
  }
};

const compareValues = (left: any, right: any) => {
  const l = left instanceof Timestamp ? left.toMillis() : left;
  const r = right instanceof Timestamp ? right.toMillis() : right;
  if (l === r) return 0;
  if (l == null) return -1;
  if (r == null) return 1;
  return l > r ? 1 : -1;
};

const applyConstraints = (rows: Row[], constraints: QueryConstraint[]) => {
  let next = rows.filter((row) => {
    const data = hydrateValue(row.data);
    return constraints.every((constraint) => {
      if (constraint.type === 'where') return matchesWhere(row, data, constraint);
      if (constraint.type === 'or') {
        return constraint.constraints.some((innerConstraint) => matchesWhere(row, data, innerConstraint));
      }
      return true;
    });
  });

  constraints
    .filter((constraint): constraint is OrderConstraint => constraint.type === 'orderBy')
    .reverse()
    .forEach((constraint) => {
      next = [...next].sort((a, b) => {
        const left = getByPath(hydrateValue(a.data), constraint.field);
        const right = getByPath(hydrateValue(b.data), constraint.field);
        const result = compareValues(left, right);
        return constraint.direction === 'desc' ? -result : result;
      });
    });

  return next;
};

const getServerConstraintColumn = (field: string) => {
  if (field === '__name__') return 'doc_id';
  if (!/^[A-Za-z0-9_]+$/.test(field)) return null;
  return `data->>${field}`;
};

const getServerComparableValue = (value: any) => {
  const normalized = normalizeValue(value);
  if (normalized == null) return null;
  if (typeof normalized === 'string' || typeof normalized === 'number' || typeof normalized === 'boolean') {
    return String(normalized);
  }
  return null;
};

const applyServerConstraints = (request: any, constraints: QueryConstraint[]) => {
  return constraints.reduce((currentRequest, constraint) => {
    if (constraint.type !== 'where') return currentRequest;

    const column = getServerConstraintColumn(constraint.field);
    if (!column) return currentRequest;

    if (constraint.op === '==') {
      const value = getServerComparableValue(constraint.value);
      return value == null ? currentRequest : currentRequest.eq(column, value);
    }

    if (constraint.op === 'in' && Array.isArray(constraint.value) && constraint.value.length > 0) {
      const values = constraint.value
        .map((item) => getServerComparableValue(item))
        .filter((item): item is string => item != null);
      return values.length === constraint.value.length ? currentRequest.in(column, values) : currentRequest;
    }

    return currentRequest;
  }, request);
};

const fetchRowsForCollection = async (source: CollectionReference, constraints: QueryConstraint[] = []) => {
  const fetchKey = getCollectionFetchKey(source, constraints);
  const activeFetch = collectionFetchInFlight.get(fetchKey);
  if (activeFetch) return activeFetch;

  const fetchPromise = (async () => {
    const rows: Row[] = [];
    let from = 0;

    while (true) {
      let request: any = supabase.from(SUPABASE_DOCUMENTS_TABLE).select(DOCUMENT_SELECT_COLUMNS);

      if (source.isCollectionGroup) {
        request = request.eq('collection_group', source.id);
      } else {
        request = request.eq('collection_path', source.collectionPath);
      }

      request = applyServerConstraints(request, constraints);

      const { data, error } = await request
        .order('collection_path', { ascending: true })
        .order('doc_id', { ascending: true })
        .range(from, from + COLLECTION_FETCH_PAGE_SIZE - 1);
      if (error) throw error;

      const page = (data || []) as Row[];
      rows.push(...page);

      if (page.length < COLLECTION_FETCH_PAGE_SIZE) break;
      from += COLLECTION_FETCH_PAGE_SIZE;
    }

    return rows;
  })();

  collectionFetchInFlight.set(fetchKey, fetchPromise);

  try {
    return await fetchPromise;
  } finally {
    if (collectionFetchInFlight.get(fetchKey) === fetchPromise) {
      collectionFetchInFlight.delete(fetchKey);
    }
  }
};

const fetchDocRow = async (ref: DocumentReference) => {
  const { data, error } = await supabase
    .from(SUPABASE_DOCUMENTS_TABLE)
    .select(DOCUMENT_SELECT_COLUMNS)
    .eq('collection_path', ref.collectionPath)
    .eq('doc_id', ref.id)
    .maybeSingle();

  if (error) throw error;
  return (data || null) as Row | null;
};

const fetchDocRows = async (refs: DocumentReference[]) => {
  const uniqueRefs = getUniqueRefs(refs);
  const rowsByKey = new Map<string, Row>();
  if (uniqueRefs.length === 0) return rowsByKey;

  const refsByCollection = new Map<string, string[]>();
  uniqueRefs.forEach((ref) => {
    const ids = refsByCollection.get(ref.collectionPath) || [];
    ids.push(ref.id);
    refsByCollection.set(ref.collectionPath, ids);
  });

  await Promise.all(
    Array.from(refsByCollection.entries()).flatMap(([collectionPath, ids]) =>
      chunkArray(ids, BULK_READ_ID_CHUNK_SIZE).map(async (idChunk) => {
        const { data, error } = await supabase
          .from(SUPABASE_DOCUMENTS_TABLE)
          .select(DOCUMENT_SELECT_COLUMNS)
          .eq('collection_path', collectionPath)
          .in('doc_id', idChunk);

        if (error) throw error;
        ((data || []) as Row[]).forEach((row) => {
          rowsByKey.set(`${row.collection_path}\u0000${row.doc_id}`, row);
        });
      })
    )
  );

  return rowsByKey;
};

export const getDoc = async (ref: DocumentReference) => {
  return new DocumentSnapshot(ref, await fetchDocRow(ref));
};

export const getDocs = async (source: CollectionReference | SupabaseQuery) => {
  const querySource = (source as SupabaseQuery).kind === 'query' ? (source as SupabaseQuery).source : (source as CollectionReference);
  const constraints = (source as SupabaseQuery).kind === 'query' ? (source as SupabaseQuery).constraints : [];
  const rows = await fetchRowsForCollection(querySource, constraints);
  return new QuerySnapshot(applyConstraints(rows, constraints));
};

const saveDocData = async (ref: DocumentReference, data: Record<string, any>) => {
  const { error } = await supabase.from(SUPABASE_DOCUMENTS_TABLE).upsert(
    {
      tenant_id: requireClientWorkspace(),
      collection_path: ref.collectionPath,
      doc_id: ref.id,
      data,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id,collection_path,doc_id' }
  );

  if (error) throw error;
};

const saveDocDataMany = async (items: Array<{ ref: DocumentReference; data: Record<string, any> }>) => {
  if (items.length === 0) return;
  const updatedAt = new Date().toISOString();

  for (const chunk of chunkArray(items, BULK_WRITE_CHUNK_SIZE)) {
    const { error } = await supabase.from(SUPABASE_DOCUMENTS_TABLE).upsert(
      chunk.map(({ ref, data }) => ({
        tenant_id: requireClientWorkspace(),
        collection_path: ref.collectionPath,
        doc_id: ref.id,
        data,
        updated_at: updatedAt,
      })),
      { onConflict: 'tenant_id,collection_path,doc_id' }
    );

    if (error) throw error;
  }
};

const deleteDocDataMany = async (refs: DocumentReference[]) => {
  const uniqueRefs = getUniqueRefs(refs);
  if (uniqueRefs.length === 0) return;

  const refsByCollection = new Map<string, string[]>();
  uniqueRefs.forEach((ref) => {
    const ids = refsByCollection.get(ref.collectionPath) || [];
    ids.push(ref.id);
    refsByCollection.set(ref.collectionPath, ids);
  });

  for (const [collectionPath, ids] of refsByCollection.entries()) {
    for (const idChunk of chunkArray(ids, BULK_READ_ID_CHUNK_SIZE)) {
      const { error } = await supabase
        .from(SUPABASE_DOCUMENTS_TABLE)
        .delete()
        .eq('collection_path', collectionPath)
        .in('doc_id', idChunk);

      if (error) throw error;
    }
  }
};

export const setDoc = async (
  ref: DocumentReference,
  data: Record<string, any>,
  options?: { merge?: boolean }
) => {
  const existing = options?.merge ? (await fetchDocRow(ref))?.data || {} : {};
  const next = options?.merge ? applyUpdate(existing, data) : normalizeData(data);
  await saveDocData(ref, next);
  emitLocalDocumentChange(ref);
};

export const updateDoc = async (ref: DocumentReference, data: Record<string, any>) => {
  const existing = await fetchDocRow(ref);
  if (!existing) {
    throw new Error(`Document does not exist: ${ref.path}`);
  }
  const nextData = applyUpdate(existing.data, data);
  const { data: updatedRow, error } = await supabase
    .from(SUPABASE_DOCUMENTS_TABLE)
    .update({
      data: nextData,
      updated_at: new Date().toISOString(),
    })
    .eq('collection_path', ref.collectionPath)
    .eq('doc_id', ref.id)
    .select('doc_id')
    .maybeSingle();

  if (error) throw error;
  if (!updatedRow) {
    throw new Error(`Document does not exist or cannot be updated: ${ref.path}`);
  }
  emitLocalDocumentChange(ref);
};

export const addDoc = async (collectionRef: CollectionReference, data: Record<string, any>) => {
  const ref = doc(collectionRef);
  await setDoc(ref, data);
  return ref;
};

export const deleteDoc = async (ref: DocumentReference) => {
  const { error } = await supabase
    .from(SUPABASE_DOCUMENTS_TABLE)
    .delete()
    .eq('collection_path', ref.collectionPath)
    .eq('doc_id', ref.id);
  if (error) throw error;
  emitLocalDocumentChange(ref);
};

class WriteBatch {
  private operations: BatchOperation[] = [];

  set(ref: DocumentReference, data: Record<string, any>, options?: { merge?: boolean }) {
    this.operations.push({ type: 'set', ref, data, options });
  }

  update(ref: DocumentReference, data: Record<string, any>) {
    this.operations.push({ type: 'update', ref, data });
  }

  delete(ref: DocumentReference) {
    this.operations.push({ type: 'delete', ref });
  }

  async commit() {
    if (this.operations.length === 0) return;

    const operationsByDocument = new Map<string, BatchOperation[]>();
    this.operations.forEach((operation) => {
      const key = documentKey(operation.ref);
      const current = operationsByDocument.get(key) || [];
      current.push(operation);
      operationsByDocument.set(key, current);
    });

    const refsNeedingExistingData = getUniqueRefs(
      Array.from(operationsByDocument.values())
        .filter((operations) => {
          let hasKnownFreshData = false;
          return operations.some((operation) => {
            if (operation.type === 'set' && !operation.options?.merge) {
              hasKnownFreshData = true;
              return false;
            }
            if (operation.type === 'set' && operation.options?.merge) return !hasKnownFreshData;
            if (operation.type === 'update') return !hasKnownFreshData;
            if (operation.type === 'delete') return false;
            return false;
          });
        })
        .map((operations) => operations[0].ref)
    );

    const existingRows = await fetchDocRows(refsNeedingExistingData);
    const upserts: Array<{ ref: DocumentReference; data: Record<string, any> }> = [];
    const deletes: DocumentReference[] = [];
    const changedRefs: DocumentReference[] = [];

    for (const operations of operationsByDocument.values()) {
      const ref = operations[0].ref;
      const existingRow = existingRows.get(documentKey(ref)) || null;
      let exists = Boolean(existingRow);
      let currentData: Record<string, any> | null = existingRow?.data ? { ...existingRow.data } : null;
      let deleted = false;

      for (const operation of operations) {
        if (operation.type === 'set') {
          currentData = operation.options?.merge
            ? applyUpdate(currentData || {}, operation.data)
            : normalizeData(operation.data);
          exists = true;
          deleted = false;
          continue;
        }

        if (operation.type === 'update') {
          if (!exists || !currentData) {
            throw new Error(`Document does not exist: ${operation.ref.path}`);
          }
          currentData = applyUpdate(currentData, operation.data);
          deleted = false;
          continue;
        }

        currentData = null;
        exists = false;
        deleted = true;
      }

      if (deleted) {
        deletes.push(ref);
      } else if (currentData) {
        upserts.push({ ref, data: currentData });
      }
      changedRefs.push(ref);
    }

    await Promise.all([
      saveDocDataMany(upserts),
      deleteDocDataMany(deletes),
    ]);

    getUniqueRefs(changedRefs).forEach(emitLocalDocumentChange);
  }
}

export const writeBatch = (_db?: unknown) => new WriteBatch();

export function onSnapshot(
  source: DocumentReference,
  onNext: (snapshot: DocumentSnapshot) => void,
  onError?: (error: any) => void
): () => void;
export function onSnapshot(
  source: CollectionReference | SupabaseQuery,
  onNext: (snapshot: QuerySnapshot) => void,
  onError?: (error: any) => void
): () => void;
export function onSnapshot(
  source: DocumentReference | CollectionReference | SupabaseQuery,
  onNext: (snapshot: any) => void,
  onError?: (error: any) => void
) {
  let active = true;
  const subscribedWorkspace = getClientWorkspace();
  let emitting = false;
  let pendingEmit = false;
  let remoteEmitTimer: ReturnType<typeof setTimeout> | null = null;

  const emit = async () => {
    try {
      if (!active || subscribedWorkspace !== getClientWorkspace()) return;
      if ((source as DocumentReference).kind === 'doc') {
        const snapshot = await getDoc(source as DocumentReference);
        if (active && subscribedWorkspace === getClientWorkspace()) onNext(snapshot);
      } else {
        const snapshot = await getDocs(source as CollectionReference | SupabaseQuery);
        if (active && subscribedWorkspace === getClientWorkspace()) onNext(snapshot);
      }
    } catch (error) {
      if (active) onError?.(error);
    }
  };

  const requestEmit = () => {
    if (!active) return;

    if (emitting) {
      pendingEmit = true;
      return;
    }

    emitting = true;
    void (async () => {
      do {
        pendingEmit = false;
        await emit();
      } while (active && pendingEmit);
      emitting = false;
    })();
  };

  const handleLocalChange = (event: Event) => {
    const detail = (event as CustomEvent<LocalDocumentChangeDetail>).detail;
    if (changeMatchesSource(source, detail)) {
      requestEmit();
    }
  };

  const handleRemoteChange = (payload: any) => {
    const row = payload?.new || payload?.old || null;
    const change = {
      collectionPath: row?.collection_path,
      docId: row?.doc_id,
    };

    if (changeMatchesSource(source, change)) {
      if (remoteEmitTimer) clearTimeout(remoteEmitTimer);
      remoteEmitTimer = setTimeout(() => {
        remoteEmitTimer = null;
        requestEmit();
      }, REMOTE_CHANGE_DEBOUNCE_MS);
    }
  };

  requestEmit();

  if (typeof window !== 'undefined') {
    window.addEventListener(LOCAL_DOCUMENT_CHANGE_EVENT, handleLocalChange);
  }

  const releaseRealtimeChannel = acquireSharedRealtimeChannel(source, handleRemoteChange);
  // DELETE events are not published because they cannot be protected by RLS.
  const refreshIfVisible = () => {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') requestEmit();
  };
  const deletionRefresh = setInterval(refreshIfVisible, 60000);
  if (typeof window !== 'undefined') window.addEventListener('focus', refreshIfVisible);

  return () => {
    active = false;
    clearInterval(deletionRefresh);
    if (typeof window !== 'undefined') window.removeEventListener('focus', refreshIfVisible);
    if (remoteEmitTimer) {
      clearTimeout(remoteEmitTimer);
      remoteEmitTimer = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener(LOCAL_DOCUMENT_CHANGE_EVENT, handleLocalChange);
    }
    releaseRealtimeChannel();
  };
}
