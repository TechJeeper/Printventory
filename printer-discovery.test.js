'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const discovery = require('./printer-discovery');

test('parses a Bambu SSDP announcement', () => {
  const parsed = discovery.parseSsdpPayload(
    'HTTP/1.1 200 OK\r\n' +
    'Location: 192.168.1.50\r\n' +
    'ST: urn:bambulab-com:device:3dprinter:1\r\n' +
    'USN: 01P00A392000494\r\n' +
    'DevModel.bambu.com: C12\r\n' +
    'DevName.bambu.com: Workshop P1S\r\n' +
    '\r\n'
  );
  assert.equal(parsed.host, '192.168.1.50');
  assert.equal(parsed.serial, '01P00A392000494');
  assert.equal(parsed.devModel, 'C12');
  assert.equal(parsed.devName, 'Workshop P1S');
  assert.equal(discovery.bambuModelLabel('C12'), 'P1S');
  assert.equal(discovery.bambuModelLabel('3DPrinter-X1-Carbon'), 'X1 Carbon');
});

test('ignores SSDP replies that are not Bambu printers', () => {
  assert.equal(discovery.parseSsdpPayload('HTTP/1.1 200 OK\r\nST: upnp:rootdevice\r\nUSN: uuid:tv\r\n\r\n'), null);
});

test('recognizes a Bambu printer certificate and ignores other brokers', () => {
  assert.deepEqual(
    discovery.isBambuCertificate({ subject: { CN: '01P00A392000494' }, issuer: { CN: 'BBL CA' } }),
    { serial: '01P00A392000494' }
  );
  assert.equal(
    discovery.isBambuCertificate({ subject: { CN: 'mosquitto' }, issuer: { CN: 'local-ca' } }),
    null
  );
});

test('maps Bambu and Klipper states to list labels', () => {
  assert.deepEqual(discovery.mapBambuGcodeState('RUNNING'), { state: 'printing', label: 'Printing' });
  assert.deepEqual(discovery.mapBambuGcodeState('PAUSE'), { state: 'paused', label: 'Paused' });
  assert.deepEqual(discovery.mapBambuGcodeState('IDLE'), { state: 'online', label: 'Online' });
  assert.deepEqual(discovery.mapBambuGcodeState('FAILED'), { state: 'error', label: 'Error' });
  assert.equal(discovery.mapKlipperState('printing', 'ready').label, 'Printing');
  assert.equal(discovery.mapKlipperState('standby', 'ready').label, 'Online');
  assert.equal(discovery.mapKlipperState('', 'shutdown').label, 'Offline');
});

test('reads a Moonraker print_stats payload', () => {
  const status = discovery.extractKlipperStatus({
    result: {
      status: {
        print_stats: { state: 'printing', filename: 'benchy.gcode' },
        webhooks: { state: 'ready' }
      }
    }
  });
  assert.equal(status.label, 'Printing');
  assert.equal(status.detail, 'benchy.gcode');
  assert.equal(discovery.isMoonrakerInfo({ result: { moonraker_version: '0.8.0', klippy_state: 'ready' } }), true);
  assert.equal(discovery.isMoonrakerInfo({ result: { hostname: 'voron' } }), false);
});

test('only reports live status when the printer has the credentials that protocol needs', () => {
  assert.equal(discovery.liveStatusKind({ firmwareType: 'Klipper', webUrl: 'http://voron.local' }), 'klipper');
  assert.equal(discovery.liveStatusKind({ firmwareType: 'Marlin', webUrl: 'http://octopi.local' }), null);
  assert.equal(discovery.liveStatusKind({
    firmwareType: 'Bambu OS',
    host: '192.168.1.50',
    bambuSerial: '01P00A392000494',
    bambuAccessCode: '40918761'
  }), 'bambu');
  assert.equal(discovery.liveStatusKind({ firmwareType: 'Bambu OS', host: '192.168.1.50' }), null);
  assert.equal(discovery.liveStatusKind({ firmwareType: 'Prusa Buddy', webUrl: 'http://192.168.1.40' }), 'prusa');
});

test('reads PrusaLink status and recognizes a Prusa version payload', () => {
  assert.equal(discovery.looksLikePrusa({ json: { text: 'PrusaLink', hostname: 'prusa-mk4' } }), true);
  assert.equal(discovery.looksLikePrusa({ json: { text: 'OctoPrint 1.9.0' } }), false);
  assert.equal(discovery.looksLikePrusa({ headers: { server: 'PrusaLink' } }), true);
  const status = discovery.extractPrusaStatus({
    printer: { state: 'PRINTING' },
    job: { file: { display_name: 'benchy.gcode' } }
  });
  assert.equal(status.label, 'Printing');
  assert.equal(status.detail, 'benchy.gcode');
  assert.equal(discovery.mapPrusaState('IDLE').label, 'Online');
  assert.equal(discovery.mapPrusaState('PAUSED').label, 'Paused');
  assert.equal(discovery.mapPrusaState('FINISHED').label, 'Complete');
});

test('builds an HTTP digest header for PrusaLink', () => {
  const header = discovery.buildDigestAuthorization({
    username: 'Mufasa',
    password: 'Circle Of Life',
    method: 'GET',
    uri: '/dir/index.html',
    nc: '00000001',
    cnonce: '0a4f113b',
    challenge: {
      realm: 'testrealm@host.com',
      nonce: 'dcd98b7102dd2f0e8b11d0f600bfb0c093',
      qop: 'auth',
      opaque: '5ccc069c403ebaf9f0171e9517f40e41'
    }
  });
  assert.match(header, /response="6629fae49393a05397450978507c4ef1"/);
  assert.match(header, /username="Mufasa"/);
});

test('merges SSDP and MQTT discoveries for the same Bambu printer', () => {
  const merged = discovery.mergeDiscoveredPrinters([
    {
      kind: 'bambu',
      host: '192.168.1.50',
      serial: '',
      name: 'Bambu Lab @ 192.168.1.50',
      model: '',
      discoveredVia: 'mqtt'
    },
    {
      kind: 'bambu',
      host: '192.168.1.50',
      serial: '01P00A392000494',
      name: 'Workshop P1S',
      model: 'P1S',
      discoveredVia: 'ssdp'
    }
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].serial, '01P00A392000494');
  assert.equal(merged[0].name, 'Workshop P1S');
  assert.equal(merged[0].model, 'P1S');
  assert.equal(merged[0].discoveredVia, 'ssdp');
});

test('round-trips an MQTT publish frame', () => {
  const packet = discovery.buildMqttPublish('device/01P00A392000494/request', '{"pushing":{"command":"pushall"}}');
  const frame = discovery.readMqttFrame(packet);
  const published = discovery.parseMqttPublish(frame);
  assert.equal(frame.type, 3);
  assert.equal(published.topic, 'device/01P00A392000494/request');
  assert.equal(published.body.toString('utf8'), '{"pushing":{"command":"pushall"}}');
});

test('a /22 network includes printers outside the interface /24', () => {
  const hosts = discovery.hostsInSubnet('192.168.68.78', '255.255.252.0');
  assert.equal(hosts.includes('192.168.68.120'), true);
  assert.equal(hosts.includes('192.168.70.100'), true);
  assert.equal(hosts.includes('192.168.68.0'), false);
  assert.equal(hosts.includes('192.168.71.255'), false);
  assert.equal(hosts.includes('192.168.72.1'), false);
  assert.equal(hosts.length, 1022);
});

test('scans a normal /24 and skips ranges that are too wide to sweep', () => {
  const lan = discovery.hostsInSubnet('192.168.1.20', '255.255.255.0');
  assert.equal(lan.length, 254);
  assert.equal(lan.includes('192.168.1.1'), true);
  assert.equal(lan.includes('192.168.1.254'), true);
  assert.equal(discovery.hostsInSubnet('172.17.64.1', '255.255.240.0').length, 0);
  assert.equal(discovery.isVirtualInterface('vEthernet (WSL (Hyper-V firewall))'), true);
  assert.equal(discovery.isVirtualInterface('Wi-Fi'), false);
});

test('parses a user scan range as CIDR, start-end, or several ranges', () => {
  const slash22 = discovery.parseScanRange('192.168.68.78/22');
  assert.equal(slash22.networks[0], '192.168.68.0/22');
  assert.equal(slash22.hosts.includes('192.168.68.120'), true);
  assert.equal(slash22.hosts.includes('192.168.70.100'), true);
  assert.equal(slash22.hosts.length, 1022);

  const oneBlock = discovery.parseScanRange('192.168.70.0/24');
  assert.equal(oneBlock.hosts.includes('192.168.70.100'), true);
  assert.equal(oneBlock.hosts.includes('192.168.68.120'), false);

  const span = discovery.parseScanRange('192.168.68.100-192.168.68.120');
  assert.equal(span.hosts[0], '192.168.68.100');
  assert.equal(span.hosts[span.hosts.length - 1], '192.168.68.120');
  assert.equal(span.hosts.length, 21);

  const both = discovery.parseScanRange('192.168.68.120/32, 192.168.70.100/32');
  assert.deepEqual(both.hosts, ['192.168.68.120', '192.168.70.100']);
  assert.equal(discovery.parseScanRange('  '), null);
  assert.throws(() => discovery.parseScanRange('10.0.0.0/8'), /1,022/);
  assert.throws(() => discovery.parseScanRange('not-a-range'), /start and end/);
});

test('normalizes a pasted printer address', () => {
  assert.equal(discovery.normalizePrinterHost('http://192.168.1.50:8883/'), '192.168.1.50');
  assert.equal(discovery.normalizePrinterHost(''), null);
});

test('printer form no longer has a separate Running Klipper checkbox', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.equal(html.includes('printer-form-klipper'), false);
  assert.equal(html.includes('Running Klipper'), false);
  assert.equal(html.includes('id="printer-web-field"'), true);
  assert.equal(html.includes('id="printer-form-access-code"'), true);
  assert.equal(html.includes('id="printer-auto-detect-btn"'), true);
  assert.equal(html.includes('id="printer-scan-start"'), true);
  assert.equal(html.includes('id="printer-scan-end"'), true);
  assert.equal(html.includes('id="printer-scan-range"'), false);
  assert.equal(html.includes('id="printer-scan-btn"'), true);
  assert.equal(html.includes('id="printer-form-prusa-password"'), true);
});
