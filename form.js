function handleSubmit(e) {
  e.preventDefault()
  window.mapboxToken = document.getElementById('mapbox-token').value
  window.supabaseToken = document.getElementById('supabase-token').value
  localStorage.setItem('mapbox-token', window.mapboxToken)
  localStorage.setItem('supabase-token', window.supabaseToken)
  document.getElementById('map').style.display = 'unset'
  document.getElementById('token-form').style.display = 'none'
  setupMap()
}

document.addEventListener('DOMContentLoaded', () => {
  const mapboxToken = localStorage.getItem('mapbox-token')
  const supabaseToken = localStorage.getItem('supabase-token')

  if (mapboxToken && supabaseToken) {
    window.mapboxToken = mapboxToken
    window.supabaseToken = supabaseToken
    setupMap()
    return
  }

  document.getElementById('map').style.display = 'none'
  document.getElementById('token-form').style.display = 'unset'
})
