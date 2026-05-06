/**
 * Secure data client — replaces direct Supabase browser calls.
 * All queries go through /api/data which validates the session
 * and uses the service role key server-side.
 *
 * Usage mirrors Supabase's builder pattern:
 *
 *   // Before (insecure):
 *   const { data } = await supabase.from('orders').select('*').eq('id', 5).order('date', { ascending: false }).limit(10);
 *
 *   // After (secure):
 *   const { data } = await db.from('orders').select('*').eq('id', 5).order('date', { ascending: false }).limit(10);
 */

type Filter = { op: string; col: string; val: any };
type Order = { col: string; asc: boolean };

interface QueryResult<T = any> {
  data: T[] | null;
  count: number | null;
  error: string | null;
}

interface SingleResult<T = any> {
  data: T | null;
  count: null;
  error: string | null;
}

class QueryBuilder {
  private _table: string;
  private _select: string = '*';
  private _filters: Filter[] = [];
  private _order: Order[] = [];
  private _limit?: number;
  private _rangeFrom?: number;
  private _rangeTo?: number;
  private _count?: string;
  private _head: boolean = false;
  private _single: boolean = false;

  constructor(table: string) {
    this._table = table;
  }

  select(columns: string = '*', opts?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) {
    this._select = columns;
    if (opts?.count) this._count = opts.count;
    if (opts?.head) this._head = opts.head;
    return this;
  }

  eq(col: string, val: any) { this._filters.push({ op: 'eq', col, val }); return this; }
  neq(col: string, val: any) { this._filters.push({ op: 'neq', col, val }); return this; }
  gt(col: string, val: any) { this._filters.push({ op: 'gt', col, val }); return this; }
  gte(col: string, val: any) { this._filters.push({ op: 'gte', col, val }); return this; }
  lt(col: string, val: any) { this._filters.push({ op: 'lt', col, val }); return this; }
  lte(col: string, val: any) { this._filters.push({ op: 'lte', col, val }); return this; }
  like(col: string, val: string) { this._filters.push({ op: 'like', col, val }); return this; }
  ilike(col: string, val: string) { this._filters.push({ op: 'ilike', col, val }); return this; }
  is(col: string, val: any) { this._filters.push({ op: 'is', col, val }); return this; }
  in(col: string, val: any[]) { this._filters.push({ op: 'in', col, val }); return this; }
  not(col: string, op: string, val: any) {
    if (op === 'is') this._filters.push({ op: 'not_is', col, val });
    else if (op === 'eq') this._filters.push({ op: 'not_eq', col, val });
    return this;
  }
  or(expr: string) { this._filters.push({ op: 'or', col: '', val: expr }); return this; }

  order(col: string, opts?: { ascending?: boolean }) {
    this._order.push({ col, asc: opts?.ascending !== false });
    return this;
  }

  limit(n: number) { this._limit = n; return this; }

  range(from: number, to: number) { this._rangeFrom = from; this._rangeTo = to; return this; }

  // Terminal methods
  async maybeSingle(): Promise<SingleResult> {
    this._single = true;
    this._limit = 1;
    return this._execute() as Promise<SingleResult>;
  }

  async single(): Promise<SingleResult> {
    this._single = true;
    this._limit = 1;
    return this._execute() as Promise<SingleResult>;
  }

  // Default execution (returns array)
  async then(resolve: (value: QueryResult) => void, reject?: (reason: any) => void) {
    try {
      const result = await this._execute();
      resolve(result);
    } catch (err) {
      if (reject) reject(err);
      else throw err;
    }
  }

  private async _execute(): Promise<QueryResult | SingleResult> {
    try {
      // The /api/data route reads query parameters from body.query.*, NOT
      // from the top level. Earlier versions of this file sent them at the
      // top level which silently dropped filters / order / range / count
      // because the route would see `body.query` as undefined. The bug was
      // invisible until tables grew past PostgREST's default 1000-row cap.
      const res = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table: this._table,
          query: {
            select: this._select,
            filters: this._filters.length > 0 ? this._filters : undefined,
            order: this._order.length > 0 ? this._order : undefined,
            limit: this._limit,
            rangeFrom: this._rangeFrom,
            rangeTo: this._rangeTo,
            count: this._count,
            head: this._head,
            single: this._single,
          },
        }),
      });

      if (res.status === 401) {
        window.location.href = '/login';
        return { data: null, count: null, error: 'Unauthorized' };
      }

      const json = await res.json();
      if (json.error) return { data: null, count: null, error: json.error };
      return { data: json.data, count: json.count ?? null, error: null };
    } catch (err: any) {
      return { data: null, count: null, error: err.message };
    }
  }
}

// Mutation builders
class MutationBuilder {
  private _table: string;
  constructor(table: string) { this._table = table; }

  async insert(data: any) {
    return this._mutate('insert', data);
  }

  async update(data: any) {
    return new MutationFilterBuilder(this._table, 'update', data);
  }

  async delete() {
    return new MutationFilterBuilder(this._table, 'delete', null);
  }

  private async _mutate(type: string, data: any, filters?: Filter[]) {
    const res = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mutate', table: this._table, type, data, filters }),
    });
    if (res.status === 401) { window.location.href = '/login'; return { data: null, error: 'Unauthorized' }; }
    const json = await res.json();
    return { data: json.data, error: json.error || null };
  }
}

class MutationFilterBuilder {
  private _table: string;
  private _type: string;
  private _data: any;
  private _filters: Filter[] = [];

  constructor(table: string, type: string, data: any) {
    this._table = table;
    this._type = type;
    this._data = data;
  }

  eq(col: string, val: any) { this._filters.push({ op: 'eq', col, val }); return this; }

  select() { return this; } // no-op for compatibility

  async single() { return this._execute(); }

  async then(resolve: (value: any) => void, reject?: (reason: any) => void) {
    try { resolve(await this._execute()); } catch (err) { if (reject) reject(err); else throw err; }
  }

  private async _execute() {
    const res = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'mutate',
        table: this._table,
        type: this._type,
        data: this._data,
        filters: this._filters,
      }),
    });
    if (res.status === 401) { window.location.href = '/login'; return { data: null, error: 'Unauthorized' }; }
    const json = await res.json();
    return { data: json.data, error: json.error || null };
  }
}

// RPC helper — the API route accepts both `kind: 'rpc'` and the legacy shape.
async function rpc(fn: string, params?: Record<string, any>) {
  const res = await fetch('/api/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'rpc', fn, args: params }),
  });
  if (res.status === 401) { window.location.href = '/login'; return { data: null, error: 'Unauthorized' }; }
  const json = await res.json();
  return { data: json.data, error: json.error || null };
}

// Main export — drop-in replacement for supabase client
export const db = {
  from: (table: string) => new QueryBuilder(table),
  rpc: (fn: string, params?: Record<string, any>) => rpc(fn, params),

  // Mutation helpers (for print_templates etc.)
  insert: (table: string, data: any) => {
    return fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mutate', table, type: 'insert', data }),
    }).then(r => r.json());
  },
  update: (table: string, data: any, filters: Filter[]) => {
    return fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mutate', table, type: 'update', data, filters }),
    }).then(r => r.json());
  },
  delete: (table: string, filters: Filter[]) => {
    return fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mutate', table, type: 'delete', filters }),
    }).then(r => r.json());
  },
};
