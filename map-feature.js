/** Leaflet 촬영 지점 지도 기능 */
(function (global) {
  'use strict';

  function initMapFeature() {
    const mapElement = document.getElementById('spot-map');
    if (!mapElement || !global.L || !global.App) return;
    const app = global.App, state = app.state, markers = new Map();
    let map, userLocationMarker = null, touchMidpoint = null, renderedSpotId = null;
    function getMidpoint(touches) { return { x: (touches[0].clientX + touches[1].clientX) / 2, y: (touches[0].clientY + touches[1].clientY) / 2 }; }
    function createPointIcon(selected) {
      return global.L.divIcon({ className: 'photo-point-marker-wrap', html: `<span class="photo-point-marker${selected ? ' is-selected' : ''}" aria-hidden="true"></span>`, iconSize: [28, 38], iconAnchor: [14, 36], popupAnchor: [0, -34] });
    }
    function setSelectedPoint(pointId, openPopup) {
      state.currentPointId = pointId;
      if (typeof app.renderPointTabs === 'function') app.renderPointTabs();
      if (typeof app.renderSummaryCard === 'function') app.renderSummaryCard();
      if (typeof app.renderMatrix === 'function') app.renderMatrix();
      markers.forEach((entry, id) => { entry.marker.setIcon(createPointIcon(id === pointId)); if (id !== pointId && map.hasLayer(entry.marker)) entry.marker.closePopup(); });
      const selected = markers.get(pointId); if (selected && openPopup) selected.marker.openPopup();
    }
    function showUserLocation() {
      const coords = state.userCoords;
      if (!coords || !Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) return;
      const location = [coords.latitude, coords.longitude];
      if (!userLocationMarker) userLocationMarker = global.L.circleMarker(location, { radius: 6, color: '#FFFFFF', weight: 2, fillColor: '#2684FF', fillOpacity: 1, interactive: false, bubblingMouseEvents: false }).addTo(map);
      else userLocationMarker.setLatLng(location);
    }
    function renderSpot(shouldFit) {
      if (!map) return;
      const spot = state.spots.find(item => item.id === state.currentSpotId); if (!spot) return;
      if (renderedSpotId !== spot.id) {
        markers.forEach(entry => { map.removeLayer(entry.marker); map.removeLayer(entry.circle); }); markers.clear(); renderedSpotId = spot.id;
      }
      const points = Array.isArray(spot.points) ? spot.points : [];
      points.forEach(point => {
        let entry = markers.get(point.id);
        if (!entry) {
          const marker = global.L.marker([point.lat, point.lng], { icon: createPointIcon(point.id === state.currentPointId), title: point.name, keyboard: true }).addTo(map);
          const popup = document.createElement('span'); popup.textContent = point.name; marker.bindPopup(popup); marker.on('click', () => setSelectedPoint(point.id, true));
          const circle = global.L.circle([point.lat, point.lng], { radius: Number(point.radiusMeters) || 500, color: '#B78B4A', weight: 1.5, opacity: .75, fillColor: '#D7B778', fillOpacity: .2, interactive: false }).addTo(map);
          entry = { marker, circle }; markers.set(point.id, entry);
        } else entry.marker.setIcon(createPointIcon(point.id === state.currentPointId));
      });
      setSelectedPoint(state.currentPointId || (points[0] && points[0].id), false); showUserLocation();
      if (shouldFit && points.length) map.fitBounds(global.L.latLngBounds(points.map(point => [point.lat, point.lng])), { padding: [24, 24], maxZoom: 15 });
    }

    map = global.L.map(mapElement, { zoomControl: true, dragging: !global.L.Browser.touch, touchZoom: false, tap: true, scrollWheelZoom: false });
    global.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
    mapElement.addEventListener('touchstart', event => { touchMidpoint = event.touches.length >= 2 ? getMidpoint(event.touches) : null; }, { passive: true });
    mapElement.addEventListener('touchmove', event => {
      if (event.touches.length < 2) { touchMidpoint = null; return; }
      const next = getMidpoint(event.touches); if (event.cancelable) event.preventDefault();
      if (touchMidpoint) map.panBy([touchMidpoint.x - next.x, touchMidpoint.y - next.y], { animate: false }); touchMidpoint = next;
    }, { passive: false });
    mapElement.addEventListener('touchend', event => { touchMidpoint = event.touches.length >= 2 ? getMidpoint(event.touches) : null; }, { passive: true });
    mapElement.addEventListener('touchcancel', () => { touchMidpoint = null; }, { passive: true });
    global.SpotMap = Object.freeze({ refresh: fit => renderSpot(Boolean(fit)) });
    global.addEventListener('spotstatechange', showUserLocation);
    renderSpot(true); showUserLocation();
    global.setTimeout(() => map.invalidateSize(), 0);
    global.addEventListener('hashchange', () => global.setTimeout(() => { map.invalidateSize(); renderSpot(true); }, 0));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initMapFeature, { once: true });
  else initMapFeature();
})(globalThis);
