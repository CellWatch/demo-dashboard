import React, { useState } from 'react';
import HexMap from './components/HexMap';
import SlidingPanel from './components/SlidingPanel';
import FiltersPanel from './components/FiltersPanel';
import SearchBar from './components/SearchBar';
import './style.css';

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

  const [typeFilters, setTypeFilters] = useState({
    all: true,
    upload:   { enabled: false, mode: 'all', threshold: '' },
    download: { enabled: false, mode: 'all', threshold: '' },
    latency:  { enabled: false, mode: 'all', threshold: '' },
  });

  const [connTypes, setConnTypes] = useState(['4G', '5G', 'Other']);
  const [providers, setProviders] = useState(['AT&T', 'T-Mobile', 'Verizon', 'Other']);

  const [dateRange, setDateRange] = useState('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  const [selectedMeasurement, setSelectedMeasurement] = useState(null);

  const [exportAllFn, setExportAllFn] = useState(null);

  // Search ↔ HexMap bridge
  const [searchFns, setSearchFns] = useState({
    getMapCenter: null,
    onPick: null,
    onPickHex: null
  });

  const handleExportAll = () => {
    if (!exportAllFn) throw new Error('Export function not ready');
    return exportAllFn();
  };

  return (
    <div id="root">
      {/* Control bar with Search (left) and Mode slider (right) */}
      <div className="control-bar control-bar-row">
        <SearchBar
          inline
          getMapCenter={searchFns.getMapCenter || undefined}
          onPick={searchFns.onPick || undefined}
          onPickHex={searchFns.onPickHex || undefined}
        />
        <ModeSlider mode={mode} setMode={setMode} />
      </div>

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

      <div id="map">
        <HexMap
          mode={mode}
          typeFilters={typeFilters}
          connTypes={connTypes}
          providers={providers}
          dateRange={{ preset: dateRange, start: customStartDate, end: customEndDate }}
          onPointClick={setSelectedMeasurement}
          onRegisterExport={(fn) => setExportAllFn(() => fn)}
          onRegisterSearch={(fns) => setSearchFns(fns)}
        />
      </div>

      {selectedMeasurement && (
        <SlidingPanel
          measurement={selectedMeasurement}
          onClose={() => setSelectedMeasurement(null)}
        />
      )}
    </div>
  );
}
