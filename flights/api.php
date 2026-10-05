<?php
// Faris Travel – Duffel proxy.
// The browser only talks to this file. The Duffel token never leaves the server.
//
//   GET  api.php?action=places&q=lond   -> airport / city suggestions
//   POST api.php?action=search          -> flight offers (JSON body)

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

$cfg = is_file(__DIR__ . '/config.php') ? require __DIR__ . '/config.php' : [];
$cfg += ['token' => '', 'base_url' => 'https://api.duffel.com', 'max_offers' => 50];
if (getenv('DUFFEL_TOKEN')) $cfg['token'] = getenv('DUFFEL_TOKEN');

function out($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function duffel($path, $body = null) {
    global $cfg;
    if (!$cfg['token']) out(['error' => 'Flight search is not configured yet (missing Duffel token).'], 500);
    $ch = curl_init(rtrim($cfg['base_url'], '/') . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_ENCODING => '',
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 45,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $cfg['token'],
            'Duffel-Version: v2',
            'Accept: application/json',
            'Content-Type: application/json',
        ],
    ]);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(['data' => $body]));
    }

    $raw = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);

    if ($raw === false) out(['error' => 'Could not reach the flight service. Please try again.', 'detail' => $err], 502);

    $json = json_decode($raw, true);
    if ($code >= 400) {
        $e = $json['errors'][0] ?? [];
        out(['error' => $e['message'] ?? $e['title'] ?? 'Flight service error'], $code >= 500 ? 502 : 400);
    }
    return $json['data'] ?? [];
}

function minutes($iso) {
    if (!$iso) return 0;
    try {
        $d = new DateInterval($iso);
        return $d->d * 1440 + $d->h * 60 + $d->i;
    } catch (Exception $e) {
        return 0;
    }
}

function slim_slice($s) {
    $segs = array_map(fn($g) => [
        'dep' => $g['departing_at'],
        'arr' => $g['arriving_at'],
        'from' => $g['origin']['iata_code'],
        'to' => $g['destination']['iata_code'],
        'flight' => $g['marketing_carrier']['iata_code'] . $g['marketing_carrier_flight_number'],
        'operator' => $g['operating_carrier']['name'],
    ], $s['segments']);

    return [
        'from' => $s['origin']['iata_code'],
        'to' => $s['destination']['iata_code'],
        'fromCity' => $s['origin']['city_name'] ?? $s['origin']['name'],
        'toCity' => $s['destination']['city_name'] ?? $s['destination']['name'],
        'minutes' => minutes($s['duration'] ?? null),
        'segments' => $segs,
    ];
}

function slim_offer($o) {
    $slices = array_map('slim_slice', $o['slices']);
    return [
        'id' => $o['id'],
        'price' => $o['total_amount'],
        'currency' => $o['total_currency'],
        'airline' => $o['owner']['name'],
        'logo' => $o['owner']['logo_symbol_url'] ?? null,
        'slices' => $slices,
        'minutes' => array_sum(array_column($slices, 'minutes')),
        'stops' => max(array_map(fn($s) => count($s['segments']) - 1, $slices)),
        'cabin' => $o['slices'][0]['segments'][0]['passengers'][0]['cabin_class_marketing_name'] ?? null,
        'refundable' => !empty($o['conditions']['refund_before_departure']['allowed']),
        'changeable' => !empty($o['conditions']['change_before_departure']['allowed']),
        'expires' => $o['expires_at'],
    ];
}

$action = $_GET['action'] ?? '';

// ---- Airport / city autocomplete ----
if ($action === 'places') {
    $q = trim($_GET['q'] ?? '');
    if (mb_strlen($q) < 2 || mb_strlen($q) > 40) out([]);

    $places = duffel('/places/suggestions?query=' . rawurlencode($q));
    $list = [];
    foreach ($places as $p) {
        if (empty($p['iata_code'])) continue;
        $list[] = [
            'code' => $p['iata_code'],
            'name' => $p['name'],
            'city' => $p['city_name'] ?? $p['name'],
            'country' => $p['iata_country_code'] ?? '',
            'type' => $p['type'],
        ];
        if (count($list) === 8) break;
    }
    out($list);
}

// ---- Flight search ----
if ($action === 'search') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') out(['error' => 'Use POST'], 405);

    $in = json_decode(file_get_contents('php://input'), true) ?: [];
    $from = strtoupper(trim($in['from'] ?? ''));
    $to = strtoupper(trim($in['to'] ?? ''));
    $depart = $in['depart'] ?? '';
    $ret = $in['return'] ?? '';
    $adults = (int)($in['adults'] ?? 1);
    $children = (int)($in['children'] ?? 0);
    $infants = (int)($in['infants'] ?? 0);
    $cabin = $in['cabin'] ?? 'economy';

    $isDate = fn($d) => preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) && strtotime($d) !== false;
    $today = date('Y-m-d');

    if (!preg_match('/^[A-Z]{3}$/', $from) || !preg_match('/^[A-Z]{3}$/', $to)) out(['error' => 'Please choose departure and arrival airports from the list.'], 400);
    if ($from === $to) out(['error' => 'Departure and arrival must be different.'], 400);
    if (!$isDate($depart) || $depart < $today) out(['error' => 'Please choose a valid departure date.'], 400);
    if ($ret !== '' && (!$isDate($ret) || $ret < $depart)) out(['error' => 'Return date must be after the departure date.'], 400);
    if ($adults < 1 || $adults + $children + $infants > 9) out(['error' => 'Up to 9 travelers per search, with at least 1 adult.'], 400);
    if ($infants > $adults) out(['error' => 'Each infant must travel with an adult.'], 400);
    if (!in_array($cabin, ['economy', 'premium_economy', 'business', 'first'], true)) $cabin = 'economy';

    $slices = [['origin' => $from, 'destination' => $to, 'departure_date' => $depart]];
    if ($ret !== '') $slices[] = ['origin' => $to, 'destination' => $from, 'departure_date' => $ret];

    $pax = array_merge(
        array_fill(0, $adults, ['type' => 'adult']),
        $children ? array_fill(0, $children, ['age' => 8]) : [],
        $infants ? array_fill(0, $infants, ['age' => 1]) : []
    );

    $data = duffel('/air/offer_requests?return_offers=true&supplier_timeout=20000', [
        'slices' => $slices,
        'passengers' => $pax,
        'cabin_class' => $cabin,
        'max_connections' => 1,
    ]);

    $offers = $data['offers'] ?? [];
    usort($offers, fn($a, $b) => (float)$a['total_amount'] <=> (float)$b['total_amount']);
    $offers = array_slice($offers, 0, $cfg['max_offers']);

    out([
        'live' => (bool)($data['live_mode'] ?? false),
        'travelers' => count($pax),
        'offers' => array_map('slim_offer', $offers),
    ]);
}

out(['error' => 'Unknown action'], 404);
