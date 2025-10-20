import React, { useState } from 'react';
import HexMap from './components/HexMap';
import SlidingPanel from './components/SlidingPanel';
import FiltersPanel from './components/FiltersPanel';
import './style.css';

function SearchBar() {
  return (
    <input
      type="text"
      placeholder="Search location…"
      className="search-input"
    />
  );
}

function ModeSlider({ mode, setMode }) {
  const value = mode === 'hex' ? 1 : 0;
  return (
    <input
      type="range"
      min="0"
      max="1"
      step="1"
      value={value}
      className={`mode-slider ${mode}`}
      onChange={(e) => setMode(e.target.value === '1' ? 'hex' : 'point')}
    />
  );
}

export default function App() {
  const [mode, setMode] = useState('hex');

  // ---- Data types ----
  const [typeFilters, setTypeFilters] = useState({
    all: true,
    upload:   { enabled: false, mode: 'all', threshold: '' },
    download: { enabled: false, mode: 'all', threshold: '' },
    latency:  { enabled: false, mode: 'all', threshold: '' },
  });

  // ---- Connection Types ----
  const [connTypes, setConnTypes] = useState(['4G', '5G', 'Other']);

  // ---- Providers ----
  const [providers, setProviders] = useState(['AT&T', 'T-Mobile', 'Verizon', 'Other']);

  // ---- Date range ----
  const [dateRange, setDateRange] = useState('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  const [selectedMeasurement, setSelectedMeasurement] = useState(null);

  // ---- Export wiring ----
  const [exportAllFn, setExportAllFn] = useState(null);

  const handleExportAll = () => {
    console.log('[App] handleExportAll invoked. exportAllFn present?', !!exportAllFn);
    if (!exportAllFn) {
      console.error('[App] No export function registered yet.');
      throw new Error('Export function not ready');
    }
    return exportAllFn(); // may return void or a Promise
  };

  return (
    <div id="root">
      {/* Control bar */}
      <div className="control-bar">
        <SearchBar />
        <ModeSlider mode={mode} setMode={setMode} />
      </div>

      {/* Filters panel */}
      <FiltersPanel
        typeFilters={typeFilters}
        setTypeFilters={setTypeFilters}
        connTypes={connTypes}
        setConnTypes={setConnTypes}
        selectedProviders={providers}
        setSelectedProviders={setProviders}
        dateRange={dateRange}
        setDateRange={setDateRange}
        customStartDate={customStartDate}
        setCustomStartDate={setCustomStartDate}
        customEndDate={customEndDate}
        setCustomEndDate={setCustomEndDate}
        onExportAll={handleExportAll}
      />

      {/* Map */}
      <div id="map">
        <HexMap
          mode={mode}
          typeFilters={typeFilters}
          connTypes={connTypes}
          providers={providers}
          dateRange={{ preset: dateRange, start: customStartDate, end: customEndDate }}
          onPointClick={setSelectedMeasurement}
          onRegisterExport={(fn) => {
            console.log('[App] onRegisterExport called. Setting exportAllFn.');
            setExportAllFn(() => fn);
          }}
        />
      </div>

      {/* Sliding panel */}
      {selectedMeasurement && (
        <SlidingPanel
          measurement={selectedMeasurement}
          onClose={() => setSelectedMeasurement(null)}
        />
      )}
    </div>
  );
}
