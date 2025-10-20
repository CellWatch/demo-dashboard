import React, { useState, useEffect } from 'react';

/**
 * Props:
 * - typeFilters
 * - setTypeFilters(fn)
 * - connTypes: string[]                 // e.g., ['4G','5G','Other']
 * - setConnTypes(fn)
 * - selectedProviders: string[]
 * - setSelectedProviders(fn)
 * - dateRange: 'all'|'1m'|'6m'|'1y'|'custom'
 * - setDateRange(fn)
 * - customStartDate: string
 * - setCustomStartDate(fn)
 * - customEndDate: string
 * - setCustomEndDate(fn)
 * - onExportAll: () => Promise<void> | void
 */
export default function FiltersPanel({
  typeFilters,
  setTypeFilters,
  connTypes,
  setConnTypes,
  selectedProviders = [],
  setSelectedProviders,
  dateRange,
  setDateRange,
  customStartDate,
  setCustomStartDate,
  customEndDate,
  setCustomEndDate,
  onExportAll,
}) {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    console.log('[FiltersPanel] mounted. onExportAll present?', !!onExportAll);
    return () => console.log('[FiltersPanel] unmounted');
  }, [onExportAll]);

  const tidyNumber = (raw) => {
    const v = (raw ?? '').toString().replace(/[^\d.]/g, '');
    const parts = v.split('.');
    return parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : v;
  };

  /* -------- Data Type handlers -------- */

  const setAllOn = () => {
    setTypeFilters((prev) => ({
      all: true,
      upload:   { ...prev.upload,   enabled: false },
      download: { ...prev.download, enabled: false },
      latency:  { ...prev.latency,  enabled: false },
    }));
  };

  const toggleType = (key) => {
    setTypeFilters((prev) => {
      const nextEnabled = !prev[key].enabled;
      const anyEnabledAfter = ['upload', 'download', 'latency'].some(
        (k) => (k === key ? nextEnabled : prev[k].enabled)
      );
      return {
        ...prev,
        all: anyEnabledAfter ? false : true,
        [key]: { ...prev[key], enabled: nextEnabled },
      };
    });
  };

  const setTypeMode = (key, mode) => {
    setTypeFilters((prev) => ({ ...prev, [key]: { ...prev[key], mode } }));
  };

  const setTypeThreshold = (key, raw) => {
    const cleaned = tidyNumber(raw);
    setTypeFilters((prev) => ({ ...prev, [key]: { ...prev[key], threshold: cleaned } }));
  };

  /* -------- Connection Type -------- */
  const toggleConn = (label) => {
    setConnTypes((prev) =>
      prev.includes(label) ? prev.filter((v) => v !== label) : [...prev, label]
    );
  };

  /* -------- Providers -------- */
  const toggleProvider = (p) => {
    setSelectedProviders((prev) =>
      prev.includes(p) ? prev.filter((v) => v !== p) : [...prev, p]
    );
  };

  /* -------- Export handler with logs + loading -------- */
  const handleExport = async () => {
    console.log('[FiltersPanel] Export button CLICKED');
    if (!onExportAll) {
      console.error('[FiltersPanel] onExportAll is not provided. Export aborted.');
      alert('Export isn’t ready yet. Try again in a moment.');
      return;
    }
    try {
      console.log('[FiltersPanel] Export started… setting loading=true');
      setLoading(true);
      const maybePromise = onExportAll();
      if (maybePromise && typeof maybePromise.then === 'function') {
        await maybePromise;
      }
      console.log('[FiltersPanel] Export finished.');
    } catch (e) {
      console.error('[FiltersPanel] Export failed:', e);
      alert('Export failed. Check the console for details.');
    } finally {
      setLoading(false);
      console.log('[FiltersPanel] loading=false');
    }
  };

  /* -------- Render helpers -------- */

  const TypeRow = ({ typeKey, label, unit = 'Mbps' }) => {
    const tf = typeFilters?.[typeKey] || { enabled: false, mode: 'all', threshold: '' };
    return (
      <div className="type-row">
        <label className="check type-label">
          <input
            type="checkbox"
            checked={!!tf.enabled}
            onChange={() => toggleType(typeKey)}
          />
          <span>{label}</span>
        </label>

        {tf.enabled && !typeFilters?.all && (
          <div className="subgroup">
            <div className="radios-vert">
              <label className="radio radio-line">
                <span className="radio-head">
                  <input
                    type="radio"
                    name={`mode-${typeKey}`}
                    value="all"
                    checked={tf.mode === 'all'}
                    onChange={(e) => setTypeMode(typeKey, e.target.value)}
                  />
                  <span>All</span>
                </span>
              </label>

              <label className="radio radio-line">
                <span className="radio-head">
                  <input
                    type="radio"
                    name={`mode-${typeKey}`}
                    value="above"
                    checked={tf.mode === 'above'}
                    onChange={(e) => setTypeMode(typeKey, e.target.value)}
                  />
                  <span>Above</span>
                </span>
                <div className="inline-input">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0"
                    value={tf.threshold ?? ''}
                    onChange={(e) => setTypeThreshold(typeKey, e.target.value)}
                    disabled={tf.mode !== 'above'}
                  />
                  <span className="suffix">{unit}</span>
                </div>
              </label>

              <label className="radio radio-line">
                <span className="radio-head">
                  <input
                    type="radio"
                    name={`mode-${typeKey}`}
                    value="below"
                    checked={tf.mode === 'below'}
                    onChange={(e) => setTypeMode(typeKey, e.target.value)}
                  />
                  <span>Below</span>
                </span>
                <div className="inline-input">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0"
                    value={tf.threshold ?? ''}
                    onChange={(e) => setTypeThreshold(typeKey, e.target.value)}
                    disabled={tf.mode !== 'below'}
                  />
                  <span className="suffix">{unit}</span>
                </div>
              </label>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="filters-panel">
      <div className="filters-header">Filters</div>

      {/* Data Type */}
      <section className="filter-subsection">
        <div className="filter-subsection-title">Data Type</div>
        <label className="check">
          <input
            type="checkbox"
            checked={!!typeFilters?.all}
            onChange={() => (typeFilters?.all ? null : setAllOn())}
          />
          <span>All data types</span>
        </label>
        <div className="types-vert">
          <TypeRow typeKey="upload" label="Upload" />
          <TypeRow typeKey="download" label="Download" />
          <TypeRow typeKey="latency" label="Latency" unit="ms" />
        </div>
        {typeFilters?.all && (
          <div className="muted">
            Showing all measurements.
          </div>
        )}
      </section>

      {/* Connection Type */}
      <section className="filter-subsection">
        <div className="filter-subsection-title">Connection Type</div>
        <div className="checks-vert">
          {['4G', '5G', 'Other'].map((label) => (
            <label key={label} className="check">
              <input
                type="checkbox"
                checked={connTypes.includes(label)}
                onChange={() => toggleConn(label)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </section>

      {/* Provider */}
      <section className="filter-subsection">
        <div className="filter-subsection-title">Provider</div>
        <div className="providers-list">
          {['AT&T', 'T-Mobile', 'Verizon', 'Other'].map((p) => (
            <label key={p} className="provider-item">
              <input
                type="checkbox"
                checked={selectedProviders.includes(p)}
                onChange={() => toggleProvider(p)}
              />
              <span>{p}</span>
            </label>
          ))}
        </div>
      </section>

      {/* Date */}
      <section className="filter-subsection">
        <div className="filter-subsection-title">Date</div>
        <div className="radios-vert">
          {['all','1m','6m','1y','custom'].map((val) => (
            <label key={val} className="radio radio-line">
              <span className="radio-head">
                <input
                  type="radio"
                  name="dateRange"
                  value={val}
                  checked={dateRange === val}
                  onChange={(e) => setDateRange(e.target.value)}
                />
                <span>
                  {val === 'all' ? 'All time' :
                   val === '1m' ? 'Past month' :
                   val === '6m' ? 'Past 6 months' :
                   val === '1y' ? 'Past year' : 'Custom range'}
                </span>
              </span>
            </label>
          ))}

          {dateRange === 'custom' && (
            <div className="date-range">
              <div className="date-row">
                <label>Start</label>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                />
              </div>
              <div className="date-row">
                <label>End</label>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Export */}
      <section className="filter-subsection">
        <button
          className="export-btn"
          onClick={handleExport}
          onMouseDown={() => console.log('[FiltersPanel] Export button mousedown')}
          disabled={loading}
          style={{
            width:'100%',
            padding:'10px 12px',
            background: loading ? '#777777' : '#1E5638',
            color:'#FFFFFF',
            border:'1px solid #1E5638',
            borderRadius:8,
            cursor: loading ? 'default' : 'pointer',
            fontWeight:700
          }}
          aria-busy={loading ? 'true' : 'false'}
        >
          {loading ? 'Exporting CSV… (please wait)' : 'Export filtered CSV'}
        </button>
      </section>
    </aside>
  );
}
