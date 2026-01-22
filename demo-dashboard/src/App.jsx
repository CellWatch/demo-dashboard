import React, { useState, useCallback } from 'react'
import HexMap from './components/HexMap.jsx'
import FilterDrawer from './components/FilterDrawer.jsx'
import PointModal from './components/PointModal.jsx'
import SearchBar from './components/SearchBar.jsx'
import './styles.css'

function ModeSlider({ mode, setMode }) {
  const value = mode === 'hex' ? 1 : 0
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
  )
}

const defaultTypeFilters = {
  all: true,
  upload: { enabled: false, mode: 'all', threshold: '' },
  download: { enabled: false, mode: 'all', threshold: '' },
  latency: { enabled: false, mode: 'all', threshold: '' }
}

export default function App() {
  const [mode, setMode] = useState('hex')

  const [drawerOpen, setDrawerOpen] = useState(false)

  const [typeFilters, setTypeFilters] = useState(defaultTypeFilters)
  const [connTypes, setConnTypes] = useState(['4G', '5G', 'Other'])
  const [providers, setProviders] = useState(['AT&T', 'T-Mobile', 'Verizon', 'Other'])

  const [dateRange, setDateRange] = useState({ preset: 'all', start: '', end: '' })

  const [selectedMeasurement, setSelectedMeasurement] = useState(null)

  const [exportFn, setExportFn] = useState(null)

  const [searchApi, setSearchApi] = useState({
    getMapCenter: null,
    onPick: null,
    onPickHex: null
  })

  const handleExportAll = useCallback(() => {
    if (!exportFn) throw new Error('Export function not ready')
    return exportFn()
  }, [exportFn])

  return (
    <div id="root">
      {/* === CONTROL BAR (unchanged layout) === */}
      <div className="control-bar control-bar-row">
        <SearchBar
          inline
          getMapCenter={searchApi.getMapCenter || undefined}
          onPick={searchApi.onPick || undefined}
          onPickHex={searchApi.onPickHex || undefined}
          onOpenFilters={() => setDrawerOpen(true)}
          onExport={handleExportAll}
        />
        <ModeSlider mode={mode} setMode={setMode} />
      </div>

      {/* === FILTERS (floating, same position as before) === */}
      <FilterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        typeFilters={typeFilters}
        setTypeFilters={setTypeFilters}
        connTypes={connTypes}
        setConnTypes={setConnTypes}
        providers={providers}
        setProviders={setProviders}
        dateRange={dateRange}
        setDateRange={setDateRange}
      />

      {/* === MAP === */}
      <div id="map">
        <HexMap
          mode={mode}
          typeFilters={typeFilters}
          connTypes={connTypes}
          providers={providers}
          dateRange={dateRange}
          onPointClick={setSelectedMeasurement}
          onRegisterExport={(fn) => setExportFn(() => fn)}
          onRegisterSearch={(api) => setSearchApi(api)}
        />
      </div>

      {/* === DETAILS SLIDE-IN === */}
      {selectedMeasurement && (
        <PointModal
          open
          row={selectedMeasurement}
          onClose={() => setSelectedMeasurement(null)}
        />
      )}
    </div>
  )
}
