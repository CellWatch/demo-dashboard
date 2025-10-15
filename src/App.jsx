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

  return (
    <div id="root">
      {}
      <div className="control-bar">
        <SearchBar />
        <ModeSlider mode={mode} setMode={setMode} />
      </div>

      {}
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
      />

      {}
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

      {}
      {selectedMeasurement && (
        <SlidingPanel
          measurement={selectedMeasurement}
          onClose={() => setSelectedMeasurement(null)}
        />
      )}
    </div>
  );
}
