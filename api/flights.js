// Faris Travel – Duffel proxy for Vercel (same behaviour as flights/api.php, used for the demo link).
// Served at /flights/api.php through the rewrite in vercel.json. Token comes from the DUFFEL_TOKEN env var.

const BASE = process.env.DUFFEL_BASE_URL || 'https://api.duffel.com'
const MAX_OFFERS = 50

class HttpError extends Error {
  constructor(msg, status) { super(msg); this.status = status }
}

async function duffel(path, body) {
  if (!process.env.DUFFEL_TOKEN) throw new HttpError('Flight search is not configured yet (missing Duffel token).', 500)
  let res
  try {
    res = await fetch(BASE + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${process.env.DUFFEL_TOKEN}`,
        'Duffel-Version': 'v2',
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: body && JSON.stringify({ data: body }),
      signal: AbortSignal.timeout(45000),
    })
  } catch {
    throw new HttpError('Could not reach the flight service. Please try again.', 502)
  }
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const e = json.errors?.[0] || {}
    throw new HttpError(e.message || e.title || 'Flight service error', res.status >= 500 ? 502 : 400)
  }
  return json.data || []
}

const minutes = iso => {
  const m = /P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/.exec(iso || '')
  return m ? (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0
}

const slimSlice = s => ({
  from: s.origin.iata_code,
  to: s.destination.iata_code,
  fromCity: s.origin.city_name || s.origin.name,
  toCity: s.destination.city_name || s.destination.name,
  minutes: minutes(s.duration),
  segments: s.segments.map(g => ({
    dep: g.departing_at,
    arr: g.arriving_at,
    from: g.origin.iata_code,
    to: g.destination.iata_code,
    flight: g.marketing_carrier.iata_code + g.marketing_carrier_flight_number,
    operator: g.operating_carrier.name,
  })),
})

const slimOffer = o => {
  const slices = o.slices.map(slimSlice)
  return {
    id: o.id,
    price: o.total_amount,
    currency: o.total_currency,
    airline: o.owner.name,
    logo: o.owner.logo_symbol_url || null,
    slices,
    minutes: slices.reduce((t, s) => t + s.minutes, 0),
    stops: Math.max(...slices.map(s => s.segments.length - 1)),
    cabin: o.slices[0]?.segments[0]?.passengers?.[0]?.cabin_class_marketing_name || null,
    refundable: !!o.conditions?.refund_before_departure?.allowed,
    changeable: !!o.conditions?.change_before_departure?.allowed,
    expires: o.expires_at,
  }
}

async function places(q) {
  q = String(q || '').trim()
  if (q.length < 2 || q.length > 40) return []
  const data = await duffel('/places/suggestions?query=' + encodeURIComponent(q))
  return data
    .filter(p => p.iata_code)
    .slice(0, 8)
    .map(p => ({ code: p.iata_code, name: p.name, city: p.city_name || p.name, country: p.iata_country_code || '', type: p.type }))
}

async function search(input) {
  const from = String(input.from || '').trim().toUpperCase()
  const to = String(input.to || '').trim().toUpperCase()
  const depart = input.depart || ''
  const ret = input.return || ''
  const adults = parseInt(input.adults ?? 1, 10) || 0
  const children = parseInt(input.children ?? 0, 10) || 0
  const infants = parseInt(input.infants ?? 0, 10) || 0
  const cabin = ['economy', 'premium_economy', 'business', 'first'].includes(input.cabin) ? input.cabin : 'economy'

  const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d))
  const today = new Date().toISOString().slice(0, 10)

  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) throw new HttpError('Please choose departure and arrival airports from the list.', 400)
  if (from === to) throw new HttpError('Departure and arrival must be different.', 400)
  if (!isDate(depart) || depart < today) throw new HttpError('Please choose a valid departure date.', 400)
  if (ret && (!isDate(ret) || ret < depart)) throw new HttpError('Return date must be after the departure date.', 400)
  if (adults < 1 || children < 0 || infants < 0 || adults + children + infants > 9) throw new HttpError('Up to 9 travelers per search, with at least 1 adult.', 400)
  if (infants > adults) throw new HttpError('Each infant must travel with an adult.', 400)

  const slices = [{ origin: from, destination: to, departure_date: depart }]
  if (ret) slices.push({ origin: to, destination: from, departure_date: ret })

  const passengers = [
    ...Array(adults).fill({ type: 'adult' }),
    ...Array(children).fill({ age: 8 }),
    ...Array(infants).fill({ age: 1 }),
  ]

  const data = await duffel('/air/offer_requests?return_offers=true&supplier_timeout=20000', {
    slices,
    passengers,
    cabin_class: cabin,
    max_connections: 1,
  })

  const offers = (data.offers || [])
    .sort((a, b) => a.total_amount - b.total_amount)
    .slice(0, MAX_OFFERS)
    .map(slimOffer)

  return { live: !!data.live_mode, travelers: passengers.length, offers }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  try {
    const action = req.query.action
    if (action === 'places') return res.status(200).json(await places(req.query.q))
    if (action === 'search') {
      if (req.method !== 'POST') throw new HttpError('Use POST', 405)
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
      return res.status(200).json(await search(body))
    }
    throw new HttpError('Unknown action', 404)
  } catch (e) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong. Please try again.' })
  }
}

module.exports.config = { maxDuration: 30 }
