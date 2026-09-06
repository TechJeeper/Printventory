/**
 * Printventory MCP (Model Context Protocol) server.
 * Streamable HTTP JSON-RPC at POST /mcp so local AI agents can search the library,
 * read model details, and write thumbnails while Printventory is running.
 */
'use strict';

const crypto = require('crypto');

const MCP_PROTOCOL_VERSION = '2025-03-26';
const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  '2024-11-05',
  '2025-03-26',
  '2025-06-18',
  '2025-11-25'
]);
const SERVER_NAME = 'printventory';

const TOOL_DEFINITIONS = [
  {
    name: 'search_models',
    description:
      'Search and filter the Printventory library. Returns model metadata without thumbnail image data. Use get_model for full details.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Free-text search across name, designer, notes, tags, path, source, and license' },
        designer: { type: 'string', description: 'Filter by designer name' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter to models that have these tags'
        },
        directory: { type: 'string', description: 'Filter to models under this directory path' },
        fileType: { type: 'string', description: 'File type filter such as stl, 3mf, zip, obj, step' },
        printed: { type: 'string', description: 'Print status filter (unprinted, printed, want, queued, printing, failed, ever-printed, never-printed, or all)' },
        limit: { type: 'integer', description: 'Max results (default 50, max 500)' },
        offset: { type: 'integer', description: 'Result offset for pagination' }
      }
    }
  },
  {
    name: 'get_model',
    description:
      'Get full details for one model by id or filePath, including tags and filaments. Thumbnail images are omitted unless includeThumbnails is true.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Model database id' },
        filePath: { type: 'string', description: 'Exact file path stored in the library' },
        includeThumbnails: { type: 'boolean', description: 'Include thumbnail data URLs (can be large). Default false.' }
      }
    }
  },
  {
    name: 'update_model',
    description:
      'Update metadata for an existing library model. Provide id or filePath plus the fields to change. Tags replace the current tag set when provided.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        filePath: { type: 'string' },
        designer: { type: 'string' },
        source: { type: 'string', description: 'Source URL or origin' },
        notes: { type: 'string' },
        license: { type: 'string' },
        parentModel: { type: 'string' },
        printStatus: { type: 'string', description: 'unprinted, want, queued, printing, printed, failed' },
        rating: { type: 'integer', description: '0-5' },
        favorite: { type: 'boolean' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Replacement tag list' }
      }
    }
  },
  {
    name: 'get_library_stats',
    description: 'Return library totals: model counts, file types, disk usage, and tag stats.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_folder_tree',
    description: 'Return the folder tree derived from scanned model paths.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'list_tags',
    description: 'List all tags with how many models use each tag.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'add_tag',
    description: 'Create a tag if it does not already exist. Returns the tag id and name.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Tag name' }
      },
      required: ['name']
    }
  },
  {
    name: 'list_designers',
    description: 'List distinct designer names in the library.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'list_licenses',
    description: 'List distinct license values in the library.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_models_missing_thumbnails',
    description:
      'List models that have no custom thumbnail. Use filePath to open the model file locally, generate an image, then call set_thumbnail.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Max results (default 50, max 500)' }
      }
    }
  },
  {
    name: 'get_thumbnails',
    description: 'Return thumbnail data URLs for a model (primary first).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        filePath: { type: 'string' }
      }
    }
  },
  {
    name: 'set_thumbnail',
    description:
      'Replace the primary thumbnail for a model. Pass a PNG or JPEG as a data URL (data:image/...) or raw base64. Intended for local AI agents that render thumbnails outside Printventory.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        filePath: { type: 'string' },
        image: { type: 'string', description: 'Image data URL or raw base64' },
        mimeType: { type: 'string', description: 'Used when image is raw base64. Default image/png.' }
      },
      required: ['image']
    }
  },
  {
    name: 'add_thumbnail',
    description:
      'Append a thumbnail and make it the default. Same image format as set_thumbnail.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        filePath: { type: 'string' },
        image: { type: 'string', description: 'Image data URL or raw base64' },
        mimeType: { type: 'string', description: 'Used when image is raw base64. Default image/png.' }
      },
      required: ['image']
    }
  }
];

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message, data) {
  const err = { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
  if (data !== undefined) err.error.data = data;
  return err;
}

function textResult(value, isError) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const out = { content: [{ type: 'text', text }] };
  if (isError) out.isError = true;
  return out;
}

function toDataUrl(image, mimeType) {
  if (!image || typeof image !== 'string') {
    throw new Error('image is required');
  }
  const trimmed = image.trim();
  if (trimmed.startsWith('data:image/')) return trimmed;
  const compact = trimmed.replace(/\s/g, '');
  let mime = (mimeType && String(mimeType).trim()) || 'image/png';
  if (!mime.startsWith('image/')) mime = 'image/png';
  if (compact.startsWith('/9j/')) mime = 'image/jpeg';
  else if (compact.startsWith('iVBOR')) mime = 'image/png';
  else if (compact.startsWith('R0lGOD')) mime = 'image/gif';
  else if (compact.startsWith('UklGR')) mime = 'image/webp';
  return `data:${mime};base64,${compact}`;
}

function clampLimit(value, fallback, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function buildMcpClientConfig(url) {
  return {
    mcpServers: {
      printventory: {
        url
      }
    }
  };
}

function listToolDefinitions() {
  return TOOL_DEFINITIONS.slice();
}

async function callTool(name, args, ctx) {
  const a = args && typeof args === 'object' ? args : {};
  switch (name) {
    case 'search_models':
      return ctx.searchModels({
        search: a.search,
        designer: a.designer,
        tags: a.tags,
        directory: a.directory,
        fileType: a.fileType,
        printed: a.printed,
        limit: clampLimit(a.limit, 50, 500),
        offset: Number.isFinite(parseInt(a.offset, 10)) ? Math.max(0, parseInt(a.offset, 10)) : 0
      });
    case 'get_model':
      return ctx.getModel({
        id: a.id,
        filePath: a.filePath,
        includeThumbnails: !!a.includeThumbnails
      });
    case 'update_model':
      return ctx.updateModel(a);
    case 'get_library_stats':
      return ctx.getLibraryStats();
    case 'get_folder_tree':
      return ctx.getFolderTree();
    case 'list_tags':
      return ctx.listTags();
    case 'add_tag':
      return ctx.addTag(a.name);
    case 'list_designers':
      return ctx.listDesigners();
    case 'list_licenses':
      return ctx.listLicenses();
    case 'get_models_missing_thumbnails':
      return ctx.getModelsMissingThumbnails(clampLimit(a.limit, 50, 500));
    case 'get_thumbnails':
      return ctx.getThumbnails({ id: a.id, filePath: a.filePath });
    case 'set_thumbnail':
      return ctx.setThumbnail({
        id: a.id,
        filePath: a.filePath,
        image: toDataUrl(a.image, a.mimeType)
      });
    case 'add_thumbnail':
      return ctx.addThumbnail({
        id: a.id,
        filePath: a.filePath,
        image: toDataUrl(a.image, a.mimeType)
      });
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function initializeResult(params, getVersion) {
  const requested = params && params.protocolVersion;
  const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.has(requested)
    ? requested
    : MCP_PROTOCOL_VERSION;
  return {
    protocolVersion,
    capabilities: {
      tools: { listChanged: false }
    },
    serverInfo: {
      name: SERVER_NAME,
      version: typeof getVersion === 'function' ? String(getVersion() || '0') : '0'
    },
    instructions:
      'Printventory library MCP. Search models, read details (filePath is on disk for local thumbnail rendering), update metadata, and set thumbnails with PNG/JPEG data URLs.'
  };
}

async function handleMcpJsonRpc(message, ctx) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return jsonRpcError(null, -32600, 'Invalid Request');
  }
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return jsonRpcError(message.id ?? null, -32600, 'Invalid Request');
  }

  const { id, method, params } = message;
  const isNotification = id === undefined;

  try {
    if (method === 'initialize') {
      if (isNotification) return null;
      return jsonRpcResult(id, initializeResult(params, ctx.getVersion));
    }
    if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
      return null;
    }
    if (method === 'ping') {
      if (isNotification) return null;
      return jsonRpcResult(id, {});
    }
    if (method === 'tools/list') {
      if (isNotification) return null;
      return jsonRpcResult(id, { tools: listToolDefinitions() });
    }
    if (method === 'tools/call') {
      if (isNotification) return null;
      const name = params && params.name;
      if (!name) return jsonRpcError(id, -32602, 'Missing tool name');
      try {
        const result = await callTool(name, (params && params.arguments) || {}, ctx);
        return jsonRpcResult(id, textResult(result === undefined ? { ok: true } : result));
      } catch (err) {
        return jsonRpcResult(id, textResult({ error: err.message || String(err) }, true));
      }
    }
    if (isNotification) return null;
    return jsonRpcError(id, -32601, `Method not found: ${method}`);
  } catch (err) {
    if (isNotification) return null;
    return jsonRpcError(id, -32603, err.message || String(err));
  }
}

function wantsSse(req) {
  const accept = String(req.headers.accept || '');
  return accept.includes('text/event-stream') && !accept.includes('application/json');
}

function writeSseMessage(res, payload) {
  res.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
}

function setMcpHeaders(res, sessionId) {
  res.setHeader('MCP-Protocol-Version', MCP_PROTOCOL_VERSION);
  if (sessionId) res.setHeader('Mcp-Session-Id', sessionId);
}

async function handleMcpPost(req, res, ctx) {
  const sessionId = req.headers['mcp-session-id'] || crypto.randomUUID();
  const body = req.body;

  if (body == null || (typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0)) {
    setMcpHeaders(res, sessionId);
    return res.status(400).json(jsonRpcError(null, -32700, 'Parse error'));
  }

  const messages = Array.isArray(body) ? body : [body];
  const responses = [];
  for (const msg of messages) {
    const response = await handleMcpJsonRpc(msg, ctx);
    if (response) responses.push(response);
  }

  setMcpHeaders(res, sessionId);

  if (responses.length === 0) {
    return res.status(202).end();
  }

  const payload = Array.isArray(body) ? responses : responses[0];
  if (wantsSse(req)) {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    writeSseMessage(res, payload);
    res.end();
    return;
  }

  return res.status(200).json(payload);
}

function handleMcpGet(req, res, ctx) {
  const sessionId = req.headers['mcp-session-id'] || crypto.randomUUID();
  setMcpHeaders(res, sessionId);
  const accept = String(req.headers.accept || '');
  if (accept.includes('text/event-stream')) {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write(': connected\n\n');
    const iv = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch (_) {
        clearInterval(iv);
      }
    }, 15000);
    req.on('close', () => clearInterval(iv));
    return;
  }
  const version = typeof ctx.getVersion === 'function' ? ctx.getVersion() : '0';
  return res.status(200).json({
    name: SERVER_NAME,
    version,
    transport: 'streamable-http',
    protocolVersion: MCP_PROTOCOL_VERSION,
    endpoint: '/mcp',
    tools: listToolDefinitions().map((t) => t.name)
  });
}

function handleMcpDelete(req, res) {
  setMcpHeaders(res, req.headers['mcp-session-id']);
  return res.status(200).end();
}

function registerMcpRoutes(expressApp, ctx) {
  const handlerCtx = ctx || {};
  const post = (req, res) => handleMcpPost(req, res, handlerCtx);
  const get = (req, res) => handleMcpGet(req, res, handlerCtx);
  const del = (req, res) => handleMcpDelete(req, res);
  expressApp.post('/mcp', post);
  expressApp.post('/mcp/', post);
  expressApp.get('/mcp', get);
  expressApp.get('/mcp/', get);
  expressApp.delete('/mcp', del);
  expressApp.delete('/mcp/', del);
}

module.exports = {
  MCP_PROTOCOL_VERSION,
  SERVER_NAME,
  TOOL_DEFINITIONS,
  listToolDefinitions,
  buildMcpClientConfig,
  toDataUrl,
  handleMcpJsonRpc,
  registerMcpRoutes,
  jsonRpcResult,
  jsonRpcError
};
