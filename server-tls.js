const fs = require('fs');
const path = require('path');
const { X509Certificate } = require('crypto');

const TLS_MODES = {
  OFF: 'off',
  CUSTOM: 'custom',
  LETSENCRYPT: 'letsencrypt',
  SELFSIGNED: 'selfsigned'
};

const RENEW_WITHIN_DAYS = 30;
const SELF_SIGNED_DAYS = 825;
const http01Challenges = new Map();
let lastTlsError = null;

function setLastTlsError(message) {
  lastTlsError = message || null;
  if (message) console.warn('[TLS]', message);
}

function getLastTlsError() {
  return lastTlsError;
}

function getLiveCertPaths(certsDir) {
  return {
    certPath: path.join(certsDir, 'live', 'fullchain.pem'),
    keyPath: path.join(certsDir, 'live', 'privkey.pem')
  };
}

function getSelfSignedPaths(certsDir) {
  return {
    certPath: path.join(certsDir, 'selfsigned', 'cert.pem'),
    keyPath: path.join(certsDir, 'selfsigned', 'key.pem')
  };
}

function getAccountKeyPath(certsDir) {
  return path.join(certsDir, 'account.key');
}

function envTlsPaths() {
  const certEnv = process.env.PRINTVENTORY_TLS_CERT || process.env.SSL_CERT_FILE;
  const keyEnv = process.env.PRINTVENTORY_TLS_KEY || process.env.SSL_KEY_FILE;
  const caEnv = process.env.PRINTVENTORY_TLS_CA || '';
  return {
    certPath: certEnv ? path.resolve(certEnv) : '',
    keyPath: keyEnv ? path.resolve(keyEnv) : '',
    caPath: caEnv ? path.resolve(caEnv) : ''
  };
}

function hasEnvTlsOverride() {
  const { certPath, keyPath } = envTlsPaths();
  return !!(certPath && keyPath);
}

function inspectCertificate(certPem) {
  if (!certPem) return null;
  try {
    const x509 = new X509Certificate(certPem);
    const expiresAt = new Date(x509.validTo);
    const daysRemaining = Math.floor((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    return {
      subject: x509.subject,
      issuer: x509.issuer,
      expiresAt: expiresAt.toISOString(),
      daysRemaining
    };
  } catch (err) {
    return { parseError: err.message };
  }
}

function readPemTlsOptions(certPath, keyPath, caPath) {
  if (!certPath || !keyPath) return null;
  const resolvedCert = path.resolve(certPath);
  const resolvedKey = path.resolve(keyPath);
  if (!fs.existsSync(resolvedCert) || !fs.existsSync(resolvedKey)) {
    return null;
  }
  const certPem = fs.readFileSync(resolvedCert);
  const keyPem = fs.readFileSync(resolvedKey);
  const opts = { cert: certPem, key: keyPem };
  let caPem = null;
  if (caPath) {
    const resolvedCa = path.resolve(caPath);
    if (fs.existsSync(resolvedCa)) {
      caPem = fs.readFileSync(resolvedCa);
      opts.ca = caPem;
    } else {
      console.warn('[TLS] CA file not found:', resolvedCa);
    }
  }
  return {
    options: opts,
    certPem,
    paths: {
      certPath: resolvedCert,
      keyPath: resolvedKey,
      caPath: caPath ? path.resolve(caPath) : ''
    }
  };
}

/**
 * Resolve TLS for the app listener.
 * Env PRINTVENTORY_TLS_* / SSL_* wins over UI settings.
 */
function resolveServerTls({ getSetting, certsDir }) {
  const envPaths = envTlsPaths();
  if (envPaths.certPath && envPaths.keyPath) {
    const loaded = readPemTlsOptions(envPaths.certPath, envPaths.keyPath, envPaths.caPath);
    if (loaded) {
      return {
        options: loaded.options,
        source: 'env',
        envOverride: true,
        certInfo: inspectCertificate(loaded.certPem),
        paths: loaded.paths,
        mode: getSetting('tlsMode', TLS_MODES.OFF)
      };
    }
    console.warn('[TLS] TLS env vars set but certificate files not found.');
    console.warn('[TLS] cert:', envPaths.certPath, 'exists:', fs.existsSync(envPaths.certPath));
    console.warn('[TLS] key:', envPaths.keyPath, 'exists:', fs.existsSync(envPaths.keyPath));
    return {
      options: null,
      source: 'env',
      envOverride: true,
      missingFiles: true,
      paths: envPaths,
      mode: getSetting('tlsMode', TLS_MODES.OFF)
    };
  }

  const mode = String(getSetting('tlsMode', TLS_MODES.OFF) || TLS_MODES.OFF);
  if (mode === TLS_MODES.OFF) {
    return { options: null, source: 'none', envOverride: false, mode };
  }

  let certPath = '';
  let keyPath = '';
  let caPath = '';
  if (mode === TLS_MODES.CUSTOM) {
    certPath = getSetting('tlsCertPath', '') || '';
    keyPath = getSetting('tlsKeyPath', '') || '';
    caPath = getSetting('tlsCaPath', '') || '';
  } else if (mode === TLS_MODES.LETSENCRYPT) {
    ({ certPath, keyPath } = getLiveCertPaths(certsDir));
  } else if (mode === TLS_MODES.SELFSIGNED) {
    ({ certPath, keyPath } = getSelfSignedPaths(certsDir));
  } else {
    return { options: null, source: 'none', envOverride: false, mode };
  }

  const loaded = readPemTlsOptions(certPath, keyPath, caPath);
  if (!loaded) {
    return {
      options: null,
      source: mode,
      envOverride: false,
      missingFiles: true,
      mode,
      paths: { certPath, keyPath, caPath }
    };
  }
  return {
    options: loaded.options,
    source: mode,
    envOverride: false,
    certInfo: inspectCertificate(loaded.certPem),
    mode,
    paths: loaded.paths
  };
}

function shouldBindAcmeHttpPort(getSetting) {
  const mode = String(getSetting('tlsMode', TLS_MODES.OFF) || TLS_MODES.OFF);
  const redirect = String(getSetting('tlsRedirectHttp', '0') || '0') === '1';
  return mode === TLS_MODES.LETSENCRYPT || redirect;
}

function getHttp01KeyAuthorization(token) {
  if (!token) return null;
  return http01Challenges.get(token) || null;
}

function setHttp01Challenge(token, keyAuthorization) {
  if (token && keyAuthorization) http01Challenges.set(token, keyAuthorization);
}

function clearHttp01Challenge(token) {
  if (token) http01Challenges.delete(token);
}

function buildHttpsRedirectUrl(req, appPort = 5000) {
  const hostHeader = req.headers && req.headers.host ? String(req.headers.host) : '';
  const hostname = hostHeader.split(':')[0] || 'localhost';
  const url = req.url || '/';
  return `https://${hostname}:${appPort}${url}`;
}

function handleAcmeOrRedirectRequest(req, res, { getSetting, appPort = 5000, tlsActive = false }) {
  const url = req.url || '';
  const match = url.match(/^\/\.well-known\/acme-challenge\/([^/?#]+)/);
  if (match) {
    const auth = getHttp01KeyAuthorization(decodeURIComponent(match[1]));
    if (!auth) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end(auth);
    return;
  }

  const redirectOn = String(getSetting('tlsRedirectHttp', '0') || '0') === '1';
  if (redirectOn && tlsActive) {
    res.statusCode = 301;
    res.setHeader('Location', buildHttpsRedirectUrl(req, appPort));
    res.end();
    return;
  }

  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain');
  res.end('Printventory ACME HTTP-01 listener');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writePemPair(certPath, keyPath, certPem, keyPem) {
  ensureDir(path.dirname(certPath));
  ensureDir(path.dirname(keyPath));
  fs.writeFileSync(certPath, certPem, { mode: 0o644 });
  fs.writeFileSync(keyPath, keyPem, { mode: 0o600 });
}

function isIpv4(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function buildSelfSignedAltNames(hostname) {
  const dns = new Set();
  const ips = new Set();
  const add = (value) => {
    const host = String(value || '').trim();
    if (!host) return;
    if (isIpv4(host)) ips.add(host);
    else dns.add(host);
  };
  add(hostname);
  add('localhost');
  add('127.0.0.1');
  return [
    ...[...dns].map((value) => ({ type: 2, value })),
    ...[...ips].map((ip) => ({ type: 7, ip }))
  ];
}

async function generateSelfSignedCertificate({ certsDir, hostname }) {
  const selfsigned = require('selfsigned');
  const cn = String(hostname || '').trim() || 'localhost';
  if (!String(hostname || '').trim()) {
    console.log('[TLS] No hostname entered; generating self-signed cert for localhost');
  }
  const altNames = buildSelfSignedAltNames(cn);
  const notBeforeDate = new Date();
  const notAfterDate = new Date(notBeforeDate.getTime() + SELF_SIGNED_DAYS * 24 * 60 * 60 * 1000);
  const pems = await selfsigned.generate(
    [{ name: 'commonName', value: cn }],
    {
      keySize: 2048,
      algorithm: 'sha256',
      notBeforeDate,
      notAfterDate,
      extensions: [
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        { name: 'subjectAltName', altNames }
      ]
    }
  );
  if (!pems || !pems.cert || !pems.private) {
    throw new Error('Self-signed generator did not return a certificate and key.');
  }
  const paths = getSelfSignedPaths(certsDir);
  writePemPair(paths.certPath, paths.keyPath, pems.cert, pems.private);
  setLastTlsError(null);
  return {
    ...paths,
    certInfo: inspectCertificate(pems.cert)
  };
}

function certificateNeedsRenewal(certPem) {
  const info = inspectCertificate(certPem);
  if (!info || info.parseError) return true;
  return info.daysRemaining <= RENEW_WITHIN_DAYS;
}

async function loadOrCreateAccountKey(certsDir) {
  const acme = require('acme-client');
  const accountPath = getAccountKeyPath(certsDir);
  if (fs.existsSync(accountPath)) {
    return fs.readFileSync(accountPath);
  }
  ensureDir(certsDir);
  const accountKey = await acme.crypto.createPrivateKey();
  fs.writeFileSync(accountPath, accountKey, { mode: 0o600 });
  return accountKey;
}

async function obtainLetsEncryptCertificate({ certsDir, domain, email, agreeTos, useStaging }) {
  const acme = require('acme-client');
  const host = String(domain || '').trim().toLowerCase();
  const mail = String(email || '').trim();
  if (!host) throw new Error('Domain is required for Let\'s Encrypt.');
  if (!mail || !mail.includes('@')) throw new Error('A contact email is required for Let\'s Encrypt.');
  if (!agreeTos) throw new Error('You must agree to the Let\'s Encrypt Terms of Service.');

  const accountKey = await loadOrCreateAccountKey(certsDir);
  const client = new acme.Client({
    directoryUrl: useStaging ? acme.directory.letsencrypt.staging : acme.directory.letsencrypt.production,
    accountKey
  });

  await client.createAccount({
    termsOfServiceAgreed: true,
    contact: [`mailto:${mail}`]
  });

  const [key, csr] = await acme.crypto.createCsr({
    commonName: host
  });

  const cert = await client.auto({
    csr,
    email: mail,
    termsOfServiceAgreed: true,
    challengePriority: ['http-01'],
    challengeCreateFn: async (_authz, challenge, keyAuthorization) => {
      if (challenge.type === 'http-01') {
        setHttp01Challenge(challenge.token, keyAuthorization);
      }
    },
    challengeRemoveFn: async (_authz, challenge) => {
      if (challenge.type === 'http-01') {
        clearHttp01Challenge(challenge.token);
      }
    }
  });

  const live = getLiveCertPaths(certsDir);
  writePemPair(live.certPath, live.keyPath, cert, key);
  setLastTlsError(null);
  return {
    ...live,
    certInfo: inspectCertificate(cert)
  };
}

function getTlsStatusPayload({ getSetting, certsDir, serverMode, scheme, appPort }) {
  const resolved = resolveServerTls({ getSetting, certsDir });
  const envPaths = envTlsPaths();
  return {
    serverMode: !!serverMode,
    envOverride: !!resolved.envOverride,
    tlsMode: String(getSetting('tlsMode', TLS_MODES.OFF) || TLS_MODES.OFF),
    scheme: scheme || (resolved.options ? 'https' : 'http'),
    source: resolved.source,
    cert: resolved.certInfo || null,
    missingFiles: !!resolved.missingFiles,
    lastError: getLastTlsError(),
    appPort: appPort || 5000,
    envPaths,
    managedLivePaths: getLiveCertPaths(certsDir),
    managedSelfSignedPaths: getSelfSignedPaths(certsDir),
    settings: {
      tlsCertPath: getSetting('tlsCertPath', '') || '',
      tlsKeyPath: getSetting('tlsKeyPath', '') || '',
      tlsCaPath: getSetting('tlsCaPath', '') || '',
      tlsDomain: getSetting('tlsDomain', '') || '',
      tlsEmail: getSetting('tlsEmail', '') || '',
      tlsAgreeTos: String(getSetting('tlsAgreeTos', '0') || '0') === '1',
      tlsUseStaging: String(getSetting('tlsUseStaging', '0') || '0') === '1',
      tlsRedirectHttp: String(getSetting('tlsRedirectHttp', '0') || '0') === '1',
      serverHttpPort: String(getSetting('serverHttpPort', String(appPort || 5000)) || appPort || 5000)
    }
  };
}

module.exports = {
  TLS_MODES,
  RENEW_WITHIN_DAYS,
  resolveServerTls,
  hasEnvTlsOverride,
  envTlsPaths,
  shouldBindAcmeHttpPort,
  handleAcmeOrRedirectRequest,
  getHttp01KeyAuthorization,
  inspectCertificate,
  certificateNeedsRenewal,
  generateSelfSignedCertificate,
  obtainLetsEncryptCertificate,
  getLiveCertPaths,
  getSelfSignedPaths,
  getTlsStatusPayload,
  getLastTlsError,
  setLastTlsError,
  readPemTlsOptions
};
