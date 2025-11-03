;(() => {
  // ========== PARTICLE SYSTEM ==========
  const canvas = document.getElementById("particleCanvas")
  const ctx = canvas.getContext("2d")
  let particles = []

  function resizeCanvas() {
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
  }

  class Particle {
    constructor() {
      this.x = Math.random() * canvas.width
      this.y = Math.random() * canvas.height
      this.vx = (Math.random() - 0.5) * 0.5
      this.vy = (Math.random() - 0.5) * 0.5
      this.size = Math.random() * 1.5
      this.opacity = Math.random() * 0.5 + 0.2
      this.color = Math.random() > 0.5 ? "#00ff88" : "#00aaff"
    }

    update() {
      this.x += this.vx
      this.y += this.vy
      this.opacity -= 0.002

      if (this.x < 0 || this.x > canvas.width) this.vx *= -1
      if (this.y < 0 || this.y > canvas.height) this.vy *= -1
      if (this.opacity <= 0) return false
      return true
    }

    draw() {
      ctx.fillStyle = this.color
      ctx.globalAlpha = this.opacity
      ctx.beginPath()
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  function animateParticles() {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.globalAlpha = 1

    particles = particles.filter((p) => p.update())

    if (Math.random() < 0.3 && particles.length < 50) {
      particles.push(new Particle())
    }

    particles.forEach((p) => p.draw())
    requestAnimationFrame(animateParticles)
  }

  resizeCanvas()
  window.addEventListener("resize", resizeCanvas)
  animateParticles()

  // ========== MAP SETUP ==========
  const map = window.L.map("map").setView([0, 0], 2)
  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors",
  }).addTo(map)

  // Enhanced marker with glow effect
  const marker = window.L.circleMarker([0, 0], {
    radius: 12,
    fillColor: "#00ff88",
    color: "#00aaff",
    weight: 3,
    opacity: 0.9,
    fillOpacity: 0.8,
  }).addTo(map)

  // Trail with gradient effect
  const trail = window.L.polyline([], {
    weight: 3,
    color: "#00aaff",
    opacity: 0.7,
    dashArray: "5, 5",
  }).addTo(map)

  const trailPoints = []

  // ========== UI HELPERS ==========
  const el = (id) => document.getElementById(id)

  function smoothNumberTransition(element, newValue, duration = 300) {
    const oldValue = Number.parseFloat(element.textContent) || 0
    const startTime = Date.now()

    function animate() {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)
      const current = oldValue + (newValue - oldValue) * progress
      element.textContent = current.toFixed(2)

      if (progress < 1) {
        requestAnimationFrame(animate)
      }
    }

    animate()
  }

  function updateUIFields(data) {
    if (!data) return

    if (data.lat !== undefined && data.lon !== undefined && data.lat !== null && data.lon !== null) {
      el("lat").textContent = data.lat.toFixed(6)
      el("lon").textContent = data.lon.toFixed(6)
    }

    if (data.speedKmh !== undefined && data.speedKmh !== null) {
      el("speed").textContent = Math.round(data.speedKmh)
    }

    if (data.track !== undefined && data.track !== null) {
      el("track").textContent = Math.round(data.track) + "°"
      // Rotate compass needle
      const needle = document.getElementById("heading-needle")
      if (needle) {
        needle.style.transform = `translateX(-50%) rotate(${data.track}deg)`
      }
    }

    if (data.sats !== undefined && data.sats !== null) {
      el("sats").textContent = data.sats
    }

    if (data.alt !== undefined && data.alt !== null) {
      el("alt").textContent = Math.round(data.alt) + " m"
    }

    el("when").textContent = new Date().toLocaleTimeString()

    // Update trail list
    el("trailList").innerHTML =
      trailPoints
        .slice(-50)
        .map((p) => `<div>📍 ${p.lat.toFixed(6)}, ${p.lon.toFixed(6)} — ${p.speedKmh ?? "—"} km/h</div>`)
        .join("") || "No positions yet"
  }

  // ========== SMOOTH ANIMATION SYSTEM ==========
  let animStart = 0
  let animDuration = 600
  let currentPos = null
  let targetPos = null
  let animating = false

  function setTargetPosition(p) {
    if (!p || p.lat == null || p.lon == null) return

    const mkLatLng = marker.getLatLng()
    if (!mkLatLng || (mkLatLng.lat === 0 && mkLatLng.lng === 0 && trailPoints.length === 0 && map.getZoom() === 2)) {
      marker.setLatLng([p.lat, p.lon])
      trailPoints.push({ lat: p.lat, lon: p.lon, speedKmh: p.speedKmh })
      trail.setLatLngs(trailPoints.map((pt) => [pt.lat, pt.lon]))
      map.setView([p.lat, p.lon], 14)
      updateUIFields(p)
      return
    }

    const m = marker.getLatLng()
    currentPos = { lat: m.lat, lon: m.lng }
    targetPos = { lat: p.lat, lon: p.lon, speedKmh: p.speedKmh, track: p.track, receivedAt: p.receivedAt }

    const ageMs = p.receivedAt ? Math.max(0, Date.now() - new Date(p.receivedAt).getTime()) : 0
    animDuration = Math.max(120, Math.min(1200, 700 - Math.floor(ageMs / 2)))

    if (!animating) requestAnimationFrame(animateMarker)
  }

  function animateMarker() {
    if (!currentPos || !targetPos) {
      animating = false
      return
    }

    animating = true
    if (!animStart) animStart = Date.now()

    const now = Date.now()
    const t = (now - animStart) / animDuration

    if (t >= 1) {
      marker.setLatLng([targetPos.lat, targetPos.lon])
      trailPoints.push({ lat: targetPos.lat, lon: targetPos.lon, speedKmh: targetPos.speedKmh })

      if (trailPoints.length > 2000) trailPoints.splice(0, trailPoints.length - 2000)
      trail.setLatLngs(trailPoints.map((pt) => [pt.lat, pt.lon]))

      updateUIFields(targetPos)

      animStart = 0
      currentPos = null
      targetPos = null
      animating = false
      return
    }

    const easeT = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t

    const lat = currentPos.lat + (targetPos.lat - currentPos.lat) * easeT
    const lon = currentPos.lon + (targetPos.lon - currentPos.lon) * easeT

    marker.setLatLng([lat, lon])

    if (map.getZoom() < 13) map.panTo([lat, lon], { animate: false })

    updateUIFields({ lat, lon, speedKmh: targetPos.speedKmh, track: targetPos.track })

    requestAnimationFrame(animateMarker)
  }

  // ========== SSE CONNECTION ==========
  const es = new EventSource("/events")

  es.onmessage = (e) => {
    try {
      const obj = JSON.parse(e.data)

      if (obj.snapshot && obj.parsed) {
        setTargetPosition(obj.parsed)
        return
      }

      const parsed = obj.parsed || {}

      if (parsed.lat !== undefined && parsed.lon !== undefined && parsed.lat !== null && parsed.lon !== null) {
        setTargetPosition(parsed)
      } else {
        updateUIFields(parsed)
      }
    } catch (err) {
      console.error("SSE parse error", err, e.data)
    }
  }

  es.onerror = (err) => {
    console.error("EventSource error", err)
  }
})()
