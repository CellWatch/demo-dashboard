import React, { useState } from 'react';
import HexMap from './components/HexMap';
import SlidingPanel from './components/SlidingPanel';
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

function FilterSection({ title, children }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="filter-section">
      <div
        className="filter-section-header"
        onClick={() => setOpen(!open)}
      >
        <span>{title}</span>
        <span className={open ? 'arrow open' : 'arrow'}>▼</span>
      </div>
      {open && <div className="filter-section-body">{children}</div>}
    </div>
  );
}

export default function App() {
  const [mode, setMode]                   = useState('hex');
  const [dataType, setDataType]           = useState('all');
  const [connTypes, setConnTypes]         = useState([]);
  const [providers, setProviders]         = useState([]);
  const [dateRange, setDateRange]         = useState('1m');
  const [selectedMeasurement, setSelectedMeasurement] = useState(null);

  return (
    <div id="root">
      <div className="control-bar">
        <SearchBar />
        <ModeSlider mode={mode} setMode={setMode} />
      </div>

      <div className="filter-control">
        {/* … your filter sections … */}
      </div>

      <div id="map">
        <HexMap
          mode={mode}
          dataType={dataType}
          connTypes={connTypes}
          providers={providers}
          dateRange={dateRange}
          onPointClick={setSelectedMeasurement}
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
