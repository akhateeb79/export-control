import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../../utils/api';

const GOOD_TYPES = ['', 'Chemical', 'Strategic'];

export default function UaeControlList() {
  const [stats, setStats] = useState(null);
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [goodType, setGoodType] = useState('');
  const [loading, setLoading] = useState(false);
  const [statsError, setStatsError] = useState(null);

  const loadStats = useCallback(async () => {
    try {
      const data = await apiFetch('/admin/uae-control-list/stats');
      setStats(data);
    } catch (err) {
      setStatsError(err.message);
    }
  }, []);

  const loadEntries = useCallback(async (currentPage, q, type) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: currentPage });
      if (q) params.set('q', q);
      if (type) params.set('type', type);
      const data = await apiFetch(`/admin/uae-control-list/search?${params}`);
      setEntries(data.entries || []);
      setTotal(data.total || 0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { loadEntries(page, query, goodType); }, [loadEntries, page, query, goodType]);

  function handleSearch(e) {
    e.preventDefault();
    setPage(1);
    loadEntries(1, query, goodType);
  }

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">UAE National Control List</h1>
        <p className="mt-1 text-sm text-slate-400">
          Chemicals and strategic goods controlled under UAE law, independent of the US EAR/CCL.
        </p>
      </div>

      {statsError && (
        <div className="rounded border border-red-700/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          Failed to load statistics: {statsError}
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {[
            { label: 'Total Entries', value: stats.total?.toLocaleString() },
            { label: 'Controlled', value: stats.controlled?.toLocaleString() },
            { label: 'Need Declaration', value: stats.needs_declaration?.toLocaleString() },
            { label: 'Chemicals', value: stats.chemicals?.toLocaleString() },
            { label: 'Strategic Goods', value: stats.strategic_goods?.toLocaleString() }
          ].map(({ label, value }) => (
            <div key={label} className="rounded border border-slate-700 bg-slate-800/50 px-4 py-3">
              <p className="text-xs text-slate-400">{label}</p>
              <p className="mt-1 text-xl font-semibold text-white">{value ?? '—'}</p>
            </div>
          ))}
        </div>
      )}

      {stats?.last_imported_at && (
        <p className="text-xs text-slate-500">
          Last import: {new Date(stats.last_imported_at).toLocaleString()}
          {' · '}
          To refresh, run <code className="rounded bg-slate-800 px-1 py-0.5">npm run db:import-uae-list</code>
        </p>
      )}

      <form onSubmit={handleSearch} className="flex flex-wrap gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, CAS number, or HS code…"
          className="flex-1 min-w-48 rounded border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
        />
        <select
          value={goodType}
          onChange={(e) => { setGoodType(e.target.value); setPage(1); }}
          className="rounded border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
        >
          {GOOD_TYPES.map((t) => <option key={t} value={t}>{t || 'All types'}</option>)}
        </select>
        <button type="submit" className="button-primary text-sm">Search</button>
      </form>

      <div className="overflow-x-auto rounded border border-slate-700">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-700 bg-slate-800/50">
            <tr>
              {['#', 'Type', 'Scientific Name', 'Product Name', 'CAS', 'HS Code', 'Controlled', 'Declaration'].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-medium text-slate-400">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">Loading…</td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">
                {total === 0 && !query ? 'No entries loaded. Run npm run db:import-uae-list to import.' : 'No matching entries.'}
              </td></tr>
            ) : entries.map((entry) => (
              <tr key={entry.id} className="hover:bg-slate-800/40">
                <td className="px-3 py-2 text-slate-500">{entry.seq_no}</td>
                <td className="px-3 py-2 text-slate-300">{entry.good_type}</td>
                <td className="px-3 py-2 text-white max-w-xs truncate" title={entry.scientific_name}>{entry.scientific_name}</td>
                <td className="px-3 py-2 text-slate-300 max-w-xs truncate" title={entry.product_name || ''}>{entry.product_name || '—'}</td>
                <td className="px-3 py-2 font-mono text-slate-400 text-xs">{entry.cas_number || '—'}</td>
                <td className="px-3 py-2 font-mono text-slate-400 text-xs">{entry.hs_code || '—'}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${entry.controlled_good ? 'bg-orange-900/40 text-orange-300' : 'bg-slate-700 text-slate-400'}`}>
                    {entry.controlled_good ? 'Yes' : 'No'}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${entry.needs_declaration ? 'bg-red-900/40 text-red-300' : 'bg-slate-700 text-slate-400'}`}>
                    {entry.needs_declaration ? 'Required' : 'No'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-400">
          <span>{total.toLocaleString()} entries · page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="rounded border border-slate-600 px-3 py-1 disabled:opacity-40">Previous</button>
            <button disabled={page === totalPages} onClick={() => setPage((p) => p + 1)} className="rounded border border-slate-600 px-3 py-1 disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
