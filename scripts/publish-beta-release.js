#!/usr/bin/env node
/**
 * Publish a Printventory beta release to:
 * 1. Printventory-Website (beta.version + beta.change on GitHub main)
 * 2. Discord #latest-builds (download links + changelog message)
 *
 * Requires GITHUB_TOKEN (PAT with repo write on Printventory-Website).
 * Discord: set webhookUrl in publish-beta-release.local.json (or DISCORD_WEBHOOK_URL).
 * Bot token is optional when a webhook is configured.
 *
 * Usage:
 *   GITHUB_TOKEN=... node scripts/publish-beta-release.js --changelog "- Fix foo\n- Fix bar"
 *   node scripts/publish-beta-release.js --website-only --changelog "Fix foo"
 *   node scripts/publish-beta-release.js --discord-only --changelog "- Fix foo"
 *   node scripts/publish-beta-release.js --discord-init
 *   node scripts/publish-beta-release.js --dry-run --changelog "- Fix foo"
 */

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'publish-beta-release.config.json');
const LOCAL_CONFIG_PATH = path.join(__dirname, 'publish-beta-release.local.json');
const LEGACY_DISCORD_CONFIG_PATH = path.join(__dirname, 'discord-latest-builds.config.json');
const PACKAGE_PATH = path.join(__dirname, '..', 'package.json');
const DISCORD_API = 'https://discord.com/api/v10';
const GITHUB_API = 'https://api.github.com';

function deepMerge(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = deepMerge(base?.[key] || {}, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function loadConfig() {
  let config = null;

  if (fs.existsSync(CONFIG_PATH)) {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } else if (fs.existsSync(LEGACY_DISCORD_CONFIG_PATH)) {
    const legacy = JSON.parse(fs.readFileSync(LEGACY_DISCORD_CONFIG_PATH, 'utf8'));
    config = {
      website: {
        owner: 'TechJeeper',
        repo: 'Printventory-Website',
        branch: 'main',
      },
      discord: legacy,
    };
  }

  if (!config) {
    console.error(`Missing config: ${CONFIG_PATH}`);
    process.exit(1);
  }

  if (fs.existsSync(LOCAL_CONFIG_PATH)) {
    config = deepMerge(config, JSON.parse(fs.readFileSync(LOCAL_CONFIG_PATH, 'utf8')));
  }

  return config;
}

function loadVersion(explicitVersion) {
  if (explicitVersion) return explicitVersion.replace(/^v/, '');
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));
  return pkg.version;
}

function parseArgs(argv) {
  const args = {
    version: null,
    changelog: null,
    dryRun: false,
    websiteOnly: false,
    discordOnly: false,
    discordInit: false,
    skipWebsite: false,
    skipDiscord: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--website-only') args.websiteOnly = true;
    else if (arg === '--discord-only') args.discordOnly = true;
    else if (arg === '--discord-init') args.discordInit = true;
    else if (arg === '--skip-website') args.skipWebsite = true;
    else if (arg === '--skip-discord') args.skipDiscord = true;
    else if (arg === '--version') args.version = argv[++i];
    else if (arg === '--changelog') args.changelog = argv[++i];
    else if (arg === '--init') args.discordInit = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/publish-beta-release.js [options]

Options:
  --version <semver>     Version to publish (default: package.json)
  --changelog <text>     Changelog lines (markdown bullets or plain lines)
  --dry-run              Print changes without calling GitHub or Discord
  --website-only         Update Printventory-Website only
  --discord-only         Update Discord #latest-builds only
  --discord-init         Post starter Discord messages and print config IDs
  --skip-website         Skip website update
  --skip-discord         Skip Discord update
  --help                 Show this help
`);
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  if (args.websiteOnly && args.discordOnly) {
    console.error('Use only one of --website-only or --discord-only.');
    process.exit(1);
  }

  return args;
}

function resolveTargets(args) {
  if (args.discordInit) return { website: false, discord: true, initOnly: true };
  if (args.websiteOnly) return { website: true, discord: false, initOnly: false };
  if (args.discordOnly) return { website: false, discord: true, initOnly: false };
  return {
    website: !args.skipWebsite,
    discord: !args.skipDiscord,
    initOnly: false,
  };
}

function normalizeChangelogInput(raw) {
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.startsWith('- ') ? line : `- ${line.replace(/^[-*]\s*/, '')}`));
}

function parseReleaseBody(body) {
  if (!body) return [];
  const lines = body.split(/\r?\n/).map((line) => line.trim());
  const bullets = [];
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    if (/^[-*]\s+/.test(line)) {
      bullets.push(line.startsWith('- ') ? line : `- ${line.replace(/^[-*]\s+/, '')}`);
    }
  }
  return bullets.length > 0 ? bullets : normalizeChangelogInput(body);
}

function bulletsToPlainLines(bullets) {
  return bullets.map((line) => line.replace(/^-\s*/, '').trim()).filter(Boolean);
}

function buildWebsiteChangeSection(version, bullets) {
  const lines = bulletsToPlainLines(bullets);
  if (lines.length === 0) {
    return `${version}\nRelease ${version}\n\n`;
  }
  return `${version}\n${lines.join('\n')}\n\n`;
}

function prependWebsiteChange(existingContent, version, bullets) {
  const section = buildWebsiteChangeSection(version, bullets);
  const trimmed = (existingContent || '').trim();
  if (!trimmed) return section;
  return `${section}${trimmed}\n`;
}

function buildDiscordChangelogSection(version, bullets) {
  if (bullets.length === 0) {
    return `**${version}**\n- Release ${version}`;
  }
  return `**${version}**\n${bullets.join('\n')}`;
}

function prependDiscordChangelog(existingContent, version, bullets) {
  const section = buildDiscordChangelogSection(version, bullets);
  const trimmed = (existingContent || '').trim();
  if (!trimmed) return `${section}\n`;
  return `${section}\n---\n\n${trimmed}`;
}

function buildDownloadLinks(version, baseUrl) {
  const root = baseUrl.replace(/\/$/, '');
  return [
    `${root}/Printventory-Setup-${version}.exe`,
    `${root}/Printventory-${version}-universal.dmg`,
    `${root}/Printventory-${version}.AppImage`,
  ].join('\n');
}

function requireGithubToken() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN is not set.');
    console.error('Use a PAT with repo write access to TechJeeper/Printventory-Website.');
    process.exit(1);
  }
  return token;
}

function hasDiscordWebhook(discordConfig) {
  return Boolean(parseWebhookUrl(process.env.DISCORD_WEBHOOK_URL || discordConfig.webhookUrl));
}

function resolveDiscordAuth(discordConfig) {
  const token = process.env.DISCORD_BOT_TOKEN || discordConfig.botToken || null;
  if (hasDiscordWebhook(discordConfig)) {
    return token;
  }
  if (!token) {
    console.error('Set DISCORD_WEBHOOK_URL (or webhookUrl in publish-beta-release.local.json) or DISCORD_BOT_TOKEN.');
    process.exit(1);
  }
  return token;
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

async function githubRequest(method, url, token, body) {
  const response = await fetch(url, {
    method,
    headers: githubHeaders(token),
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const detail = typeof data === 'object' ? JSON.stringify(data) : data;
    throw new Error(`GitHub API ${method} ${url} failed (${response.status}): ${detail}`);
  }

  return data;
}

async function getWebsiteFile(token, websiteConfig, filePath) {
  const { owner, repo, branch } = websiteConfig;
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(branch)}`;
  const data = await githubRequest('GET', url, token);
  const content = Buffer.from(data.content, 'base64').toString('utf8');
  return { content, sha: data.sha };
}

async function putWebsiteFile(token, websiteConfig, filePath, content, sha, message) {
  const { owner, repo, branch } = websiteConfig;
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${filePath}`;
  await githubRequest('PUT', url, token, {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    sha,
    branch,
  });
}

async function updateWebsiteBeta(token, websiteConfig, version, bullets, dryRun) {
  if (dryRun && !token) {
    console.log('--- Printventory-Website beta.version ---');
    console.log(`${version}\n`);
    console.log('\n--- Printventory-Website beta.change ---');
    console.log(buildWebsiteChangeSection(version, bullets) + '...(existing changelog preserved)\n');
    return;
  }

  const [versionFile, changeFile] = await Promise.all([
    getWebsiteFile(token, websiteConfig, 'beta.version'),
    getWebsiteFile(token, websiteConfig, 'beta.change'),
  ]);

  const newVersion = `${version}\n`;
  const newChange = prependWebsiteChange(changeFile.content, version, bullets);

  if (dryRun) {
    console.log('--- Printventory-Website beta.version ---');
    console.log(newVersion);
    console.log('\n--- Printventory-Website beta.change ---');
    console.log(newChange);
    return;
  }

  console.log(`Updating ${websiteConfig.owner}/${websiteConfig.repo} beta files for v${version}...`);
  await putWebsiteFile(
    token,
    websiteConfig,
    'beta.version',
    newVersion,
    versionFile.sha,
    `Bump beta version to ${version}`
  );
  await putWebsiteFile(
    token,
    websiteConfig,
    'beta.change',
    newChange,
    changeFile.sha,
    `Update beta changelog for ${version}`
  );
  console.log('Website beta files updated.');
}

function discordHeaders(token, useAuth = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (useAuth && token) headers.Authorization = `Bot ${token}`;
  return headers;
}

async function discordRequest(method, url, token, body, options = {}) {
  const response = await fetch(url, {
    method,
    headers: discordHeaders(token, options.useAuth !== false),
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const detail = typeof data === 'object' ? JSON.stringify(data) : data;
    throw new Error(`Discord API ${method} ${url} failed (${response.status}): ${detail}`);
  }

  return data;
}

function parseWebhookUrl(webhookUrl) {
  if (!webhookUrl) return null;
  const match = webhookUrl.match(/webhooks\/(\d+)\/([^/?#]+)/);
  if (!match) {
    throw new Error('Invalid webhookUrl. Expected .../webhooks/{id}/{token}');
  }
  return { id: match[1], token: match[2] };
}

function applyDiscordEnv(discordConfig) {
  return {
    ...discordConfig,
    channelId: process.env.DISCORD_CHANNEL_ID || discordConfig.channelId,
    webhookUrl: process.env.DISCORD_WEBHOOK_URL || discordConfig.webhookUrl,
  };
}

async function getDiscordMessage(discordConfig, token, messageId) {
  if (!messageId) {
    throw new Error('Discord message ID must be set in publish-beta-release.config.json');
  }

  const webhook = parseWebhookUrl(discordConfig.webhookUrl);
  if (webhook) {
    const url = `${DISCORD_API}/webhooks/${webhook.id}/${webhook.token}/messages/${messageId}`;
    return discordRequest('GET', url, null, null, { useAuth: false });
  }

  const { channelId } = discordConfig;
  if (!channelId || !token) {
    throw new Error('Discord channelId and bot token are required without a webhook');
  }
  return discordRequest(
    'GET',
    `${DISCORD_API}/channels/${channelId}/messages/${messageId}`,
    token
  );
}

async function editDiscordMessage(discordConfig, token, messageId, content) {
  const webhook = parseWebhookUrl(discordConfig.webhookUrl);
  if (webhook) {
    const url = `${DISCORD_API}/webhooks/${webhook.id}/${webhook.token}/messages/${messageId}`;
    return discordRequest('PATCH', url, null, { content }, { useAuth: false });
  }

  return discordRequest(
    'PATCH',
    `${DISCORD_API}/channels/${discordConfig.channelId}/messages/${messageId}`,
    token,
    { content }
  );
}

async function postDiscordMessage(discordConfig, token, content) {
  const webhook = parseWebhookUrl(discordConfig.webhookUrl);
  if (webhook) {
    const url = `${DISCORD_API}/webhooks/${webhook.id}/${webhook.token}?wait=true`;
    return discordRequest('POST', url, null, { content }, { useAuth: false });
  }

  if (!discordConfig.channelId) {
    throw new Error('Discord channelId is required to post messages without a webhook');
  }
  return discordRequest(
    'POST',
    `${DISCORD_API}/channels/${discordConfig.channelId}/messages`,
    token,
    { content }
  );
}

async function runDiscordInit(discordConfig, token, version) {
  const downloadContent = buildDownloadLinks(version, discordConfig.downloadBaseUrl);
  const changelogContent = buildDiscordChangelogSection(version, ['Initial automated changelog post']);

  console.log('Posting starter messages to #latest-builds...');
  const downloadMessage = await postDiscordMessage(discordConfig, token, downloadContent);
  const changelogMessage = await postDiscordMessage(discordConfig, token, `${changelogContent}\n`);

  console.log('\nAdd these IDs to scripts/publish-beta-release.config.json under "discord":\n');
  console.log(JSON.stringify({
    channelId: discordConfig.channelId || downloadMessage.channel_id,
    downloadLinksMessageId: downloadMessage.id,
    changelogMessageId: changelogMessage.id,
    downloadBaseUrl: discordConfig.downloadBaseUrl,
  }, null, 2));

  console.log('\nPin both messages in Discord, then delete the old manual posts when ready.');
}

async function updateDiscordLatestBuilds(discordConfig, token, version, bullets, dryRun) {
  const downloadContent = buildDownloadLinks(version, discordConfig.downloadBaseUrl);

  let changelogContent;
  if (dryRun && !discordConfig.changelogMessageId) {
    changelogContent = prependDiscordChangelog('**2.1.5**\n- Previous change\n---', version, bullets);
  } else {
    const existingChangelog = await getDiscordMessage(
      discordConfig,
      token,
      discordConfig.changelogMessageId
    );
    if (existingChangelog.content.includes('Initial automated changelog post')) {
      changelogContent = `${buildDiscordChangelogSection(version, bullets)}\n`;
    } else {
      changelogContent = prependDiscordChangelog(existingChangelog.content, version, bullets);
    }
  }

  if (dryRun) {
    console.log('--- Discord download links ---');
    console.log(downloadContent);
    console.log('\n--- Discord changelog ---');
    console.log(changelogContent);
    return;
  }

  if (!discordConfig.downloadLinksMessageId || !discordConfig.changelogMessageId) {
    throw new Error(
      'Discord downloadLinksMessageId and changelogMessageId must be set. Run with --discord-init first.'
    );
  }

  console.log(`Updating Discord #latest-builds for v${version}...`);
  await editDiscordMessage(discordConfig, token, discordConfig.downloadLinksMessageId, downloadContent);
  await editDiscordMessage(discordConfig, token, discordConfig.changelogMessageId, changelogContent);
  console.log('Discord #latest-builds updated.');
}

async function main() {
  const args = parseArgs(process.argv);
  const config = loadConfig();
  const version = loadVersion(args.version);
  const targets = resolveTargets(args);
  const discordConfig = applyDiscordEnv(config.discord || {});
  const websiteConfig = config.website;

  if (targets.initOnly) {
    const token = resolveDiscordAuth(discordConfig);
    await runDiscordInit(discordConfig, token, version);
    return;
  }

  const changelogSource =
    args.changelog ||
    process.env.CHANGELOG ||
    process.env.RELEASE_BODY ||
    process.env.GITHUB_EVENT_RELEASE_BODY;

  const bullets = normalizeChangelogInput(changelogSource);
  if (bullets.length === 0 && changelogSource) {
    bullets.push(...parseReleaseBody(changelogSource));
  }

  if (bullets.length === 0) {
    console.error('No changelog provided. Use --changelog, CHANGELOG, or RELEASE_BODY.');
    process.exit(1);
  }

  let hadError = false;

  if (targets.website) {
    try {
      const githubToken = process.env.GITHUB_TOKEN || null;
      if (!args.dryRun && !githubToken) {
        requireGithubToken();
      }
      await updateWebsiteBeta(githubToken, websiteConfig, version, bullets, args.dryRun);
    } catch (error) {
      hadError = true;
      console.error(`Website update failed: ${error.message || error}`);
    }
  }

  if (targets.discord) {
    try {
      const discordToken = args.dryRun
        ? (process.env.DISCORD_BOT_TOKEN || discordConfig.botToken || null)
        : resolveDiscordAuth(discordConfig);

      if (!args.dryRun && (!discordConfig.downloadLinksMessageId || !discordConfig.changelogMessageId)) {
        throw new Error(
          'Discord message IDs not configured. Run with --discord-init or set them in publish-beta-release.config.json.'
        );
      }

      await updateDiscordLatestBuilds(discordConfig, discordToken, version, bullets, args.dryRun);
    } catch (error) {
      hadError = true;
      console.error(`Discord update failed: ${error.message || error}`);
    }
  }

  if (hadError) process.exit(1);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
