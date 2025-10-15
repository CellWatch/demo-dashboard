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

  // ---- Data types (multi-select when "all" is false) ----
  const [typeFilters, setTypeFilters] = useState({
    all: true,
    upload:   { enabled: false, mode: 'all', threshold: '' },
    download: { enabled: false, mode: 'all', threshold: '' },
    latency:  { enabled: false, mode: 'all', threshold: '' },
  });

  // ---- Connection Types (HARDCODED; default all ON) ----
  const [connTypes, setConnTypes] = useState(['4G', '5G', 'Other']);

  // ---- Providers (HARDCODED; default all ON) ----
  const [providers, setProviders] = useState(['AT&T', 'T-Mobile', 'Verizon', 'Other']);

  // ---- Date range ----
  const [dateRange, setDateRange] = useState('all'); // 'all' | '1m' | '6m' | '1y' | 'custom'
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  // Optional detail sheet (if you still use it)
  const [selectedMeasurement, setSelectedMeasurement] = useState(null);

  return (
    <div id="root">
      {/* Top center bar */}
      <div className="control-bar">
        <SearchBar />
        <ModeSlider mode={mode} setMode={setMode} />
      </div>

      {/* Right-side Filters */}
      <FiltersPanel
        typeFilters={typeFilters}
        setTypeFilters={setTypeFilters}
        connTypes={connTypes}
        setConnTypes={setConnTypes}
        selectedProviders={providers}
        setSelectedProviders={setProviders}
        // date
        dateRange={dateRange}
        setDateRange={setDateRange}
        customStartDate={customStartDate}
        setCustomStartDate={setCustomStartDate}
        customEndDate={customEndDate}
        setCustomEndDate={setCustomEndDate}
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
        />
      </div>

      {/* Optional measurement panel */}
      {selectedMeasurement && (
        <SlidingPanel
          measurement={selectedMeasurement}
          onClose={() => setSelectedMeasurement(null)}
        />
      )}
    </div>
  );
}
