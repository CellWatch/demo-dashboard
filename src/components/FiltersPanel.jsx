import React from 'react';

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
}) {
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

  /* -------- Connection Type (hardcoded) -------- */
  const ALL_CONN = ['4G', '5G', 'Other'];

  const toggleConn = (label) => {
    setConnTypes((prev) =>
      prev.includes(label) ? prev.filter((v) => v !== label) : [...prev, label]
    );
  };

  /* -------- Providers (hardcoded) -------- */
  const ALL_PROVIDERS = ['AT&T', 'T-Mobile', 'Verizon', 'Other'];
  const toggleProvider = (p) => {
    setSelectedProviders((prev) =>
      prev.includes(p) ? prev.filter((v) => v !== p) : [...prev, p]
    );
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

        {/* Subfilter: indented, each option on its own line */}
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

        {/* All */}
        <label className="check">
          <input
            type="checkbox"
            checked={!!typeFilters?.all}
            onChange={() => (typeFilters?.all ? null : setAllOn())}
          />
          <span>All data types</span>
        </label>

        {/* Vertical list of types */}
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

      {/* Connection Type (vertical, with 'Other') */}
      <section className="filter-subsection">
        <div className="filter-subsection-title">Connection Type</div>
        <div className="checks-vert">
          {ALL_CONN.map((label) => (
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

      {/* Provider (hardcoded) */}
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
          <label className="radio radio-line">
            <span className="radio-head">
              <input
                type="radio"
                name="dateRange"
                value="all"
                checked={dateRange === 'all'}
                onChange={(e) => setDateRange(e.target.value)}
              />
              <span>All time</span>
            </span>
          </label>

          <label className="radio radio-line">
            <span className="radio-head">
              <input
                type="radio"
                name="dateRange"
                value="1m"
                checked={dateRange === '1m'}
                onChange={(e) => setDateRange(e.target.value)}
              />
              <span>Past month</span>
            </span>
          </label>

          <label className="radio radio-line">
            <span className="radio-head">
              <input
                type="radio"
                name="dateRange"
                value="6m"
                checked={dateRange === '6m'}
                onChange={(e) => setDateRange(e.target.value)}
              />
              <span>Past 6 months</span>
            </span>
          </label>

          <label className="radio radio-line">
            <span className="radio-head">
              <input
                type="radio"
                name="dateRange"
                value="1y"
                checked={dateRange === '1y'}
                onChange={(e) => setDateRange(e.target.value)}
              />
              <span>Past year</span>
            </span>
          </label>

          <label className="radio radio-line">
            <span className="radio-head">
              <input
                type="radio"
                name="dateRange"
                value="custom"
                checked={dateRange === 'custom'}
                onChange={(e) => setDateRange(e.target.value)}
              />
              <span>Custom range</span>
            </span>
          </label>

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
    </aside>
  );
}
