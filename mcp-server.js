/**
 * Printventory MCP (Model Context Protocol) server.
 * Streamable HTTP JSON-RPC at POST /mcp so local AI agents can search the library,
 * manage tags/filaments/print history, update metadata, and write thumbnails
 * while Printventory is running.
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
        tags: { type: 'array', items: { type: 'string' }, description: 'Replacement tag list' },
        filaments: {
          type: 'array',
          items: { type: 'integer' },
          description: 'Replacement filament id list'
        }
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
    name: 'rename_tag',
    description:
      'Rename a tag by id or current name. If the new name already exists, model links are merged onto that tag and the old tag is removed.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Tag id' },
        name: { type: 'string', description: 'Current tag name' },
        newName: { type: 'string', description: 'New tag name' }
      },
      required: ['newName']
    }
  },
  {
    name: 'delete_tag',
    description:
      'Delete a tag by id or name and unlink it from all models. Use list_tags first to confirm the tag and its model_count.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Tag id' },
        name: { type: 'string', description: 'Tag name' }
      }
    }
  },
  {
    name: 'add_model_tags',
    description: 'Add tags to a model without removing existing tags. Creates tags that do not already exist.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        filePath: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tag names to add' }
      },
      required: ['tags']
    }
  },
  {
    name: 'remove_model_tags',
    description: 'Remove specific tags from a model. The tags themselves remain in the library.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        filePath: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tag names to remove' }
      },
      required: ['tags']
    }
  },
  {
    name: 'list_filaments',
    description: 'List filaments with vendor, material, color, and how many models use each.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'save_filament',
    description:
      'Create a manual filament or update an existing non-Spoolman filament. Provide id to update.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        name: { type: 'string' },
        vendor: { type: 'string' },
        material: { type: 'string' },
        color_hex: { type: 'string', description: 'Hex color such as #FF8800' },
        diameter: { type: 'number', description: 'Filament diameter in mm (default 1.75)' }
      },
      required: ['name']
    }
  },
  {
    name: 'delete_filament',
    description: 'Delete a filament and unlink it from models and print events.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Filament id' }
      },
      required: ['id']
    }
  },
  {
    name: 'set_model_filaments',
    description: 'Replace the filament list on a model. Pass an empty array to clear.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        filePath: { type: 'string' },
        filaments: { type: 'array', items: { type: 'integer' }, description: 'Filament ids' }
      },
      required: ['filaments']
    }
  },
  {
    name: 'get_print_events',
    description: 'List print history events for a model.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        filePath: { type: 'string' }
      }
    }
  },
  {
    name: 'log_print_event',
    description: 'Record a print outcome for a model (printed, failed, or cancelled).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        filePath: { type: 'string' },
        outcome: { type: 'string', description: 'printed, failed, or cancelled' },
        quantity: { type: 'integer', description: 'Number of copies (default 1)' },
        printedAt: { type: 'string', description: 'ISO datetime; defaults to now' },
        notes: { type: 'string' },
        filamentIds: { type: 'array', items: { type: 'integer' } }
      },
      required: ['outcome']
    }
  },
  {
    name: 'delete_print_event',
    description: 'Delete one print history event by its event id.',
    inputSchema: {
      type: 'object',
      properties: {
        eventId: { type: 'integer' }
      },
      required: ['eventId']
    }
  },
  {
    name: 'list_parent_models',
    description: 'List distinct parent-model values in the library.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'rename_metadata',
    description:
      'Rename a designer, parentModel, or license value across all models. Merges if the new name already exists.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'designer, parentModel, or license' },
        oldName: { type: 'string' },
        newName: { type: 'string' }
      },
      required: ['type', 'oldName', 'newName']
    }
  },
  {
    name: 'delete_metadata',
    description: 'Clear a designer, parentModel, or license value from all models that use it.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'designer, parentModel, or license' },
        name: { type: 'string' }
      },
      required: ['type', 'name']
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
  },
  {
    name: 'set_default_thumbnail',
    description: 'Set which thumbnail is the default by 0-based index from get_thumbnails.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        filePath: { type: 'string' },
        index: { type: 'integer', description: '0-based thumbnail index' }
      },
      required: ['index']
    }
  },
  {
    name: 'delete_thumbnail',
    description:
      'Delete a non-default thumbnail by 0-based index. Cannot delete the active (index 0) thumbnail or the last remaining thumbnail.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        filePath: { type: 'string' },
        index: { type: 'integer', description: '0-based thumbnail index' }
      },
      required: ['index']
    }
  },
  {
    name: 'find_duplicates',
    description:
      'Find duplicate models grouped by file hash (DeDup). Returns hash groups with file paths, names, and sizes. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        includeZip: { type: 'boolean', description: 'Include models inside ZIP archives. Default false.' },
        search: { type: 'string' },
        designer: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        directory: { type: 'string' },
        fileType: { type: 'string' },
        printed: { type: 'string' },
        limit: { type: 'integer', description: 'Max groups (default 50, max 200)' }
      }
    }
  },
  {
    name: 'get_hash_status',
    description: 'Return how many models need a hash and whether hash generation is running.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        designer: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        directory: { type: 'string' },
        fileType: { type: 'string' },
        printed: { type: 'string' }
      }
    }
  },
  {
    name: 'calculate_missing_hashes',
    description:
      'Start background hash generation for models missing a hash (or still on SHA-256). Returns immediately with started/total. Use get_hash_status to poll.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        designer: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        directory: { type: 'string' },
        fileType: { type: 'string' },
        printed: { type: 'string' }
      }
    }
  },
  {
    name: 'check_files_exist',
    description:
      'Check whether model files still exist on disk. Pass filePaths, or omit to scan the library (capped). Zip entries check the archive file.',
    inputSchema: {
      type: 'object',
      properties: {
        filePaths: { type: 'array', items: { type: 'string' } },
        missingOnly: { type: 'boolean', description: 'If true, only return missing files. Default true when scanning the library.' },
        limit: { type: 'integer', description: 'Max paths to check when scanning the library (default 500, max 2000)' }
      }
    }
  },
  {
    name: 'get_all_metadata',
    description: 'List designers, parent models, and licenses with model counts.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'pull_3mf_metadata',
    description:
      'Read designer, parent model, notes, and license from 3MF files and write them to the library. If a model already has metadata, pass overwrite: true.',
    inputSchema: {
      type: 'object',
      properties: {
        filePaths: { type: 'array', items: { type: 'string' }, description: '3MF file paths. If omitted, uses id or filePath.' },
        id: { type: 'integer' },
        filePath: { type: 'string' },
        overwrite: { type: 'boolean', description: 'Overwrite existing metadata. Default false.' }
      }
    }
  },
  {
    name: 'generate_tags',
    description:
      'AI-generate tags for a model from its thumbnail. Returns suggested tags. Set apply true to merge them onto the model.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        filePath: { type: 'string' },
        apply: { type: 'boolean', description: 'If true, merge generated tags onto the model. Default false.' }
      }
    }
  },
  {
    name: 'update_models_batch',
    description: 'Update metadata for many models. Each item needs id or filePath plus fields to change.',
    inputSchema: {
      type: 'object',
      properties: {
        models: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              filePath: { type: 'string' },
              designer: { type: 'string' },
              source: { type: 'string' },
              notes: { type: 'string' },
              license: { type: 'string' },
              parentModel: { type: 'string' },
              printStatus: { type: 'string' },
              rating: { type: 'integer' },
              favorite: { type: 'boolean' },
              tags: { type: 'array', items: { type: 'string' } },
              filaments: { type: 'array', items: { type: 'integer' } }
            }
          }
        }
      },
      required: ['models']
    }
  },
  {
    name: 'log_print_events_batch',
    description: 'Record the same print outcome for many models.',
    inputSchema: {
      type: 'object',
      properties: {
        filePaths: { type: 'array', items: { type: 'string' } },
        modelIds: { type: 'array', items: { type: 'integer' } },
        outcome: { type: 'string', description: 'printed, failed, or cancelled' },
        quantity: { type: 'integer' },
        printedAt: { type: 'string' },
        notes: { type: 'string' },
        filamentIds: { type: 'array', items: { type: 'integer' } }
      },
      required: ['outcome']
    }
  },
  {
    name: 'get_models_by_directory',
    description: 'List models whose file path is under a directory.',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Directory path prefix' },
        limit: { type: 'integer', description: 'Max results (default 100, max 500)' }
      },
      required: ['directory']
    }
  },
  {
    name: 'scan_directory',
    description:
      'Scan a folder and add/update models in the library. Long-running. Omit directory to rescan the last scanned folder.',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string' }
      }
    }
  },
  {
    name: 'remove_model',
    description:
      'Remove one or more models from the library only. Files stay on disk. Requires confirm: true.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        filePath: { type: 'string' },
        filePaths: { type: 'array', items: { type: 'string' } },
        ids: { type: 'array', items: { type: 'integer' } },
        confirm: { type: 'boolean' }
      }
    }
  },
  {
    name: 'trash_file',
    description:
      'Move model file(s) to the system trash and remove them from the library. Zip entries are not trashed. Requires confirm: true.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        filePath: { type: 'string' },
        filePaths: { type: 'array', items: { type: 'string' } },
        ids: { type: 'array', items: { type: 'integer' } },
        confirm: { type: 'boolean' }
      }
    }
  },
  {
    name: 'list_slicers',
    description: 'List configured slicers (id, name, path).',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'open_in_slicer',
    description: 'Open one or more models in a configured slicer. Desktop launches locally; server mode sends a client command.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        filePath: { type: 'string' },
        filePaths: { type: 'array', items: { type: 'string' } },
        slicerId: { type: 'integer' },
        slicerName: { type: 'string' }
      }
    }
  },
  {
    name: 'move_files',
    description: 'Move model files to a destination folder and update library paths. Requires confirm: true. Zip entries are not moved.',
    inputSchema: {
      type: 'object',
      properties: {
        filePaths: { type: 'array', items: { type: 'string' } },
        destinationFolder: { type: 'string' },
        confirm: { type: 'boolean' }
      },
      required: ['filePaths', 'destinationFolder']
    }
  },
  {
    name: 'export_library',
    description: 'Export library metadata (no thumbnails) to a JSON file. Writes destPath or a timestamped file next to the database.',
    inputSchema: {
      type: 'object',
      properties: {
        destPath: { type: 'string', description: 'Optional destination JSON path' }
      }
    }
  },
  {
    name: 'backup_database',
    description: 'Copy the SQLite database to destPath or a timestamped file next to the database.',
    inputSchema: {
      type: 'object',
      properties: {
        destPath: { type: 'string', description: 'Optional destination .db path' }
      }
    }
  },
  {
    name: 'sync_spoolman_filaments',
    description: 'Pull filaments from the configured Spoolman server into Printventory.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Optional Spoolman URL override' },
        token: { type: 'string', description: 'Optional API token override' }
      }
    }
  },
  {
    name: 'get_models_with_default_thumbnails',
    description: 'List models that still have the default/empty thumbnail (same set as missing custom thumbnails).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Max results (default 50, max 500)' }
      }
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
    case 'rename_tag':
      return ctx.renameTag({ id: a.id, name: a.name, newName: a.newName });
    case 'delete_tag':
      return ctx.deleteTag({ id: a.id, name: a.name });
    case 'add_model_tags':
      return ctx.addModelTags({ id: a.id, filePath: a.filePath, tags: a.tags });
    case 'remove_model_tags':
      return ctx.removeModelTags({ id: a.id, filePath: a.filePath, tags: a.tags });
    case 'list_filaments':
      return ctx.listFilaments();
    case 'save_filament':
      return ctx.saveFilament(a);
    case 'delete_filament':
      return ctx.deleteFilament(a.id);
    case 'set_model_filaments':
      return ctx.setModelFilaments({ id: a.id, filePath: a.filePath, filaments: a.filaments });
    case 'get_print_events':
      return ctx.getPrintEvents({ id: a.id, filePath: a.filePath });
    case 'log_print_event':
      return ctx.logPrintEvent(a);
    case 'delete_print_event':
      return ctx.deletePrintEvent(a.eventId);
    case 'list_parent_models':
      return ctx.listParentModels();
    case 'rename_metadata':
      return ctx.renameMetadata({ type: a.type, oldName: a.oldName, newName: a.newName });
    case 'delete_metadata':
      return ctx.deleteMetadata({ type: a.type, name: a.name });
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
    case 'set_default_thumbnail':
      return ctx.setDefaultThumbnail({ id: a.id, filePath: a.filePath, index: a.index });
    case 'delete_thumbnail':
      return ctx.deleteThumbnail({ id: a.id, filePath: a.filePath, index: a.index });
    case 'find_duplicates':
      return ctx.findDuplicates({
        includeZip: !!a.includeZip,
        search: a.search,
        designer: a.designer,
        tags: a.tags,
        directory: a.directory,
        fileType: a.fileType,
        printed: a.printed,
        limit: clampLimit(a.limit, 50, 200)
      });
    case 'get_hash_status':
      return ctx.getHashStatus({
        search: a.search,
        designer: a.designer,
        tags: a.tags,
        directory: a.directory,
        fileType: a.fileType,
        printed: a.printed
      });
    case 'calculate_missing_hashes':
      return ctx.calculateMissingHashes({
        search: a.search,
        designer: a.designer,
        tags: a.tags,
        directory: a.directory,
        fileType: a.fileType,
        printed: a.printed
      });
    case 'check_files_exist':
      return ctx.checkFilesExist({
        filePaths: a.filePaths,
        missingOnly: a.missingOnly,
        limit: clampLimit(a.limit, 500, 2000)
      });
    case 'get_all_metadata':
      return ctx.getAllMetadata();
    case 'pull_3mf_metadata':
      return ctx.pull3mfMetadata(a);
    case 'generate_tags':
      return ctx.generateTags({ id: a.id, filePath: a.filePath, apply: !!a.apply });
    case 'update_models_batch':
      return ctx.updateModelsBatch(a.models);
    case 'log_print_events_batch':
      return ctx.logPrintEventsBatch(a);
    case 'get_models_by_directory':
      return ctx.getModelsByDirectory({
        directory: a.directory,
        limit: clampLimit(a.limit, 100, 500)
      });
    case 'scan_directory':
      return ctx.scanDirectory({ directory: a.directory });
    case 'remove_model':
      return ctx.removeModel(a);
    case 'trash_file':
      return ctx.trashFile(a);
    case 'list_slicers':
      return ctx.listSlicers();
    case 'open_in_slicer':
      return ctx.openInSlicer(a);
    case 'move_files':
      return ctx.moveFiles(a);
    case 'export_library':
      return ctx.exportLibrary({ destPath: a.destPath });
    case 'backup_database':
      return ctx.backupDatabase({ destPath: a.destPath });
    case 'sync_spoolman_filaments':
      return ctx.syncSpoolmanFilaments({ url: a.url, token: a.token });
    case 'get_models_with_default_thumbnails':
      return ctx.getModelsMissingThumbnails(clampLimit(a.limit, 50, 500));
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
      'Printventory library MCP. Search and update models, manage tags/filaments/print history, find duplicates, scan folders, pull 3MF metadata, and write thumbnails. Destructive tools (remove_model, trash_file, move_files) require confirm: true. filePath is on disk for local thumbnail rendering.'
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
