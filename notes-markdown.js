/**
 * Markdown for model notes. Source stays plain text (existing notes keep working).
 * HTML is escaped before any tags are added, and link URLs are limited to http(s)/mailto.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.NotesMarkdown = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sanitizeUrl(url) {
    const trimmed = String(url || '').trim();
    if (!trimmed || /[\u0000-\u001f]/.test(trimmed)) return '';
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch (_) {
      return '';
    }
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:' && protocol !== 'mailto:') return '';
    return parsed.href;
  }

  function inline(raw) {
    const re = /(`[^`\n]+`)|(\[([^\]]+)\]\(([^)\s]+)\))|(\*\*([\s\S]+?)\*\*)|(__(.+?)__)|(~~([^~\n]+)~~)|(\*([^*\n]+?)\*)/g;
    let out = '';
    let last = 0;
    let match;
    while ((match = re.exec(raw))) {
      out += escapeHtml(raw.slice(last, match.index));
      if (match[1]) {
        out += '<code>' + escapeHtml(match[1].slice(1, -1)) + '</code>';
      } else if (match[2]) {
        const safe = sanitizeUrl(match[4]);
        if (safe) {
          out += '<a href="' + escapeHtml(safe) + '" target="_blank" rel="noopener noreferrer">' + inline(match[3]) + '</a>';
        } else {
          out += escapeHtml(match[2]);
        }
      } else if (match[5]) {
        out += '<strong>' + inline(match[6]) + '</strong>';
      } else if (match[7]) {
        out += '<strong>' + inline(match[8]) + '</strong>';
      } else if (match[9]) {
        out += '<s>' + inline(match[10]) + '</s>';
      } else if (match[11]) {
        out += '<em>' + inline(match[12]) + '</em>';
      }
      last = match.index + match[0].length;
    }
    out += escapeHtml(raw.slice(last));
    return out;
  }

  function isBlockStart(line) {
    return /^(```|#{1,6}\s|>\s?|\s*[-*]\s+|\s*\d+\.\s+|-{3,}\s*$|\*{3,}\s*$)/.test(line);
  }

  function render(markdown) {
    const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
    let html = '';
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (line.startsWith('```')) {
        const code = [];
        i += 1;
        while (i < lines.length && !lines[i].startsWith('```')) {
          code.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1;
        html += '<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>';
        continue;
      }

      if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
        html += '<hr>';
        i += 1;
        continue;
      }

      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) {
        const level = heading[1].length;
        html += '<h' + level + '>' + inline(heading[2]) + '</h' + level + '>';
        i += 1;
        continue;
      }

      if (/^>\s?/.test(line)) {
        const quote = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          quote.push(lines[i].replace(/^>\s?/, ''));
          i += 1;
        }
        html += '<blockquote>' + render(quote.join('\n')) + '</blockquote>';
        continue;
      }

      if (/^\s*[-*]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
          i += 1;
        }
        html += '<ul>' + items.map((item) => '<li>' + inline(item) + '</li>').join('') + '</ul>';
        continue;
      }

      if (/^\s*\d+\.\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
          i += 1;
        }
        html += '<ol>' + items.map((item) => '<li>' + inline(item) + '</li>').join('') + '</ol>';
        continue;
      }

      if (line.trim() === '') {
        i += 1;
        continue;
      }

      const para = [];
      while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) {
        para.push(lines[i]);
        i += 1;
      }
      html += '<p>' + para.map(inline).join('<br>') + '</p>';
    }

    return html;
  }

  function applyFormatToText(value, start, end, kind) {
    const selected = value.slice(start, end);
    let insert = '';
    let selectFrom = start;
    let selectTo = start;

    function wrap(before, after, placeholder) {
      const inner = selected || placeholder;
      insert = before + inner + after;
      selectFrom = start + before.length;
      selectTo = selectFrom + inner.length;
    }

    switch (kind) {
      case 'bold':
        wrap('**', '**', 'bold');
        break;
      case 'italic':
        wrap('*', '*', 'italic');
        break;
      case 'strike':
        wrap('~~', '~~', 'text');
        break;
      case 'code':
        if (selected.includes('\n')) {
          const inner = selected || 'code';
          insert = '```\n' + inner + '\n```';
          selectFrom = start + 4;
          selectTo = selectFrom + inner.length;
        } else {
          wrap('`', '`', 'code');
        }
        break;
      case 'h2':
        wrap('## ', '', 'Heading');
        break;
      case 'list': {
        const body = selected || 'item';
        insert = body.split('\n').map((line) => {
          if (/^\s*([-*]|\d+\.)\s+/.test(line)) return line;
          return '- ' + line;
        }).join('\n');
        selectFrom = start;
        selectTo = start + insert.length;
        break;
      }
      case 'link': {
        const looksLikeUrl = /^https?:\/\//i.test(selected);
        const label = selected && !looksLikeUrl ? selected : 'link text';
        const href = looksLikeUrl ? selected : 'https://';
        insert = '[' + label + '](' + href + ')';
        if (href === 'https://') {
          selectFrom = start + insert.indexOf('https://');
          selectTo = start + insert.length - 1;
        } else {
          selectFrom = start + 1;
          selectTo = start + 1 + label.length;
        }
        break;
      }
      default:
        return { value, selectionStart: start, selectionEnd: end };
    }

    return {
      value: value.slice(0, start) + insert + value.slice(end),
      selectionStart: selectFrom,
      selectionEnd: selectTo
    };
  }

  function previewElement(textarea) {
    if (!textarea) return null;
    if (textarea.id === 'model-notes' && typeof document !== 'undefined') {
      return document.getElementById('model-notes-preview');
    }
    const editor = textarea.closest ? textarea.closest('.notes-editor') : null;
    return editor ? editor.querySelector('.notes-preview') : null;
  }

  function richElementFor(textarea) {
    if (!textarea || textarea.id !== 'notes-modal-textarea' || typeof document === 'undefined') return null;
    return document.getElementById('notes-richtext');
  }

  const BLOCK_TAGS = new Set([
    'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'blockquote', 'pre', 'hr'
  ]);

  function isBlockNode(node) {
    if (!node || node.nodeType !== 1) return false;
    return BLOCK_TAGS.has(node.tagName.toLowerCase());
  }

  function renderInlineNode(node) {
    if (!node) return '';
    if (node.nodeType === 3) {
      return node.textContent.replace(/\u00a0/g, ' ');
    }
    if (node.nodeType !== 1) return '';

    const tag = node.tagName.toLowerCase();
    if (tag === 'br') return '\n';

    if (isBlockNode(node)) {
      return blocksFromNode(node).join('\n');
    }

    let inner = Array.from(node.childNodes).map(renderInlineNode).join('');

    if (tag === 'code') {
      return '`' + inner.replace(/`/g, '') + '`';
    }

    if (tag === 'a') {
      const href = sanitizeUrl(node.getAttribute('href') || '');
      return href ? `[${inner}](${href})` : inner;
    }

    const styleAttr = node.getAttribute ? (node.getAttribute('style') || '') : '';
    const styleObj = node.style || {};

    const isBold = tag === 'strong' || tag === 'b' ||
      styleObj.fontWeight === 'bold' || styleObj.fontWeight === 'bolder' ||
      parseInt(styleObj.fontWeight, 10) >= 600 ||
      /font-weight:\s*(bold|bolder|[6-9]00)/i.test(styleAttr);

    const isItalic = tag === 'em' || tag === 'i' ||
      styleObj.fontStyle === 'italic' || styleObj.fontStyle === 'oblique' ||
      /font-style:\s*(italic|oblique)/i.test(styleAttr);

    const isStrike = tag === 's' || tag === 'strike' || tag === 'del' ||
      (styleObj.textDecoration && styleObj.textDecoration.includes('line-through')) ||
      (styleObj.textDecorationLine && styleObj.textDecorationLine.includes('line-through')) ||
      /text-decoration(-line)?:\s*[^;]*line-through/i.test(styleAttr);

    if (!isBold && !isItalic && !isStrike) {
      return inner;
    }

    const matchLead = inner.match(/^\s*/);
    const leading = matchLead ? matchLead[0] : '';
    const matchTrail = inner.match(/\s*$/);
    const trailing = matchTrail ? matchTrail[0] : '';
    const trimmed = inner.slice(leading.length, inner.length - trailing.length);

    if (!trimmed) return inner;

    let wrapped = trimmed;
    if (isBold) wrapped = `**${wrapped}**`;
    if (isItalic) wrapped = `*${wrapped}*`;
    if (isStrike) wrapped = `~~${wrapped}~~`;

    return leading + wrapped + trailing;
  }

  function renderInline(container) {
    if (!container) return '';
    return Array.from(container.childNodes).map(renderInlineNode).join('');
  }

  function blocksFromNode(node) {
    if (!node) return [];
    if (node.nodeType === 3) {
      const text = node.textContent.replace(/\u00a0/g, ' ');
      return text.trim() ? [text] : [];
    }
    if (node.nodeType !== 1) return [];

    const tag = node.tagName.toLowerCase();

    if (tag === 'pre') {
      const code = node.textContent.replace(/\r\n/g, '\n').replace(/\n$/, '');
      return ['```\n' + code + '\n```'];
    }

    if (tag === 'hr') {
      return ['---'];
    }

    if (tag === 'ul' || tag === 'ol') {
      const lis = Array.from(node.children).filter((el) => el.tagName && el.tagName.toLowerCase() === 'li');
      const items = lis.map((li, index) => {
        const line = renderInline(li).replace(/\n+/g, ' ').trim();
        return tag === 'ol' ? `${index + 1}. ${line}` : `- ${line}`;
      });
      return items.length ? [items.join('\n')] : [];
    }

    if (tag === 'blockquote') {
      const innerBlocks = convertChildBlocks(node);
      const quoted = innerBlocks.join('\n\n').split('\n').map((l) => '> ' + l).join('\n');
      return quoted ? [quoted] : [];
    }

    if (/^h[1-6]$/.test(tag)) {
      const listChild = node.querySelector('ul, ol');
      if (listChild) {
        return blocksFromNode(listChild);
      }
      const level = Number(tag[1]);
      const text = renderInline(node).trim();
      return text ? ['#'.repeat(level) + ' ' + text] : [];
    }

    const hasBlockChildren = Array.from(node.children).some(isBlockNode);
    if (hasBlockChildren) {
      return convertChildBlocks(node);
    }

    const inlineText = renderInline(node).trim();
    return inlineText ? [inlineText] : [];
  }

  function convertChildBlocks(container) {
    const blocks = [];
    let currentInlines = [];

    function flushInlines() {
      if (currentInlines.length > 0) {
        const text = currentInlines.map(renderInlineNode).join('').replace(/\n{3,}/g, '\n\n').trim();
        if (text) {
          blocks.push(text);
        }
        currentInlines = [];
      }
    }

    container.childNodes.forEach((child) => {
      if (isBlockNode(child)) {
        flushInlines();
        const childBlocks = blocksFromNode(child);
        blocks.push(...childBlocks);
      } else {
        currentInlines.push(child);
      }
    });

    flushInlines();
    return blocks.filter(Boolean);
  }

  function htmlToMarkdown(root) {
    if (!root) return '';
    const blocks = convertChildBlocks(root);
    return blocks.join('\n\n').trim();
  }

  function sync(textarea) {
    if (!textarea) return;
    const text = textarea.value || '';
    const html = text.trim() ? render(text) : '';
    const preview = previewElement(textarea);
    if (preview) {
      preview.innerHTML = html || (textarea.id === 'model-notes' ? '<p class="notes-preview-empty">Click to add notes...</p>' : '');
    }
    const rich = richElementFor(textarea);
    if (rich && typeof document !== 'undefined' && document.activeElement !== rich) {
      rich.innerHTML = html;
    }
  }

  function commit() {
    if (typeof document === 'undefined') return '';
    const rich = document.getElementById('notes-richtext');
    const textarea = document.getElementById('notes-modal-textarea');
    if (!rich || !textarea) return textarea ? textarea.value : '';
    textarea.value = htmlToMarkdown(rich);
    return textarea.value;
  }

  function applyRichCommand(kind) {
    const rich = document.getElementById('notes-richtext');
    if (!rich) return;
    rich.focus();
    try { document.execCommand('styleWithCSS', false, false); } catch (_) { /* ignore */ }
    if (kind === 'bold') document.execCommand('bold');
    else if (kind === 'italic') document.execCommand('italic');
    else if (kind === 'strike') document.execCommand('strikeThrough');
    else if (kind === 'h2') {
      const selection = window.getSelection();
      let parent = selection && selection.anchorNode;
      if (parent && parent.nodeType === 3) parent = parent.parentNode;
      const isH2 = parent && (parent.closest ? parent.closest('h2') : null);
      if (isH2) {
        document.execCommand('formatBlock', false, 'p');
      } else {
        document.execCommand('formatBlock', false, 'H2');
      }
    } else if (kind === 'list') {
      document.execCommand('insertUnorderedList');
    } else if (kind === 'link') {
      const selection = window.getSelection();
      const range = selection && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
      const url = window.prompt('Link URL', 'https://');
      const safe = url ? sanitizeUrl(url) : '';
      if (safe && range) {
        selection.removeAllRanges();
        selection.addRange(range);
        if (range.collapsed) {
          const a = document.createElement('a');
          a.href = safe;
          a.textContent = safe;
          range.insertNode(a);
          range.setStartAfter(a);
          range.setEndAfter(a);
          selection.removeAllRanges();
          selection.addRange(range);
        } else {
          document.execCommand('createLink', false, safe);
        }
      }
    } else if (kind === 'code') {
      const selection = window.getSelection();
      if (selection && selection.rangeCount) {
        const range = selection.getRangeAt(0);
        if (range.collapsed) {
          const code = document.createElement('code');
          code.textContent = 'code';
          range.insertNode(code);
          range.selectNodeContents(code);
          selection.removeAllRanges();
          selection.addRange(range);
        } else {
          const code = document.createElement('code');
          try {
            range.surroundContents(code);
          } catch (_) {
            code.textContent = range.toString() || 'code';
            range.deleteContents();
            range.insertNode(code);
          }
        }
      }
    }
    commit();
  }

  function applyFormat(textarea, kind) {
    if (!textarea) return;
    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || 0;
    const result = applyFormatToText(textarea.value || '', start, end, kind);
    textarea.value = result.value;
    textarea.focus();
    if (typeof textarea.setSelectionRange === 'function') {
      textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
    }
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    if (textarea.id === 'model-notes') {
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    }
    sync(textarea);
  }

  function setPreviewMode(editor, on) {
    editor.classList.toggle('is-previewing', on);
    const toggle = editor.querySelector('[data-md="preview"]');
    if (toggle) {
      toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
      toggle.textContent = on ? 'Edit' : 'Preview';
    }
    if (on) {
      const textarea = editor.querySelector('textarea');
      if (textarea) sync(textarea);
    }
  }

  function install() {
    if (typeof document === 'undefined') return;

    document.addEventListener('mousedown', (event) => {
      if (event.target.closest && event.target.closest('.notes-toolbar [data-md]')) {
        event.preventDefault();
      }
    });

    document.addEventListener('click', (event) => {
      const button = event.target.closest && event.target.closest('.notes-toolbar [data-md]');
      if (button) {
        const editor = button.closest('.notes-editor');
        const textarea = editor && editor.querySelector('textarea');
        const kind = button.getAttribute('data-md');
        if (editor && editor.querySelector('#notes-richtext')) {
          applyRichCommand(kind);
          return;
        }
        if (kind === 'preview' && editor) {
          const next = !editor.classList.contains('is-previewing');
          setPreviewMode(editor, next);
          if (!next && textarea) textarea.focus();
          return;
        }
        if (editor && editor.classList.contains('is-previewing')) return;
        applyFormat(textarea, kind);
        return;
      }

      const link = event.target.closest && event.target.closest('.notes-preview a');
      if (!link) return;
      const href = link.getAttribute('href');
      if (href && typeof window.electron?.openExternal === 'function') {
        event.preventDefault();
        window.electron.openExternal(href);
      }
    });

    document.addEventListener('input', (event) => {
      const target = event.target;
      if (target && target.id === 'notes-richtext') commit();
      else if (target && target.matches && target.matches('.notes-editor textarea')) sync(target);
    });

    document.getElementById('model-notes-preview')?.addEventListener('click', (event) => {
      if (event.target.closest && event.target.closest('a')) return;
      document.getElementById('open-notes-modal-button')?.click();
    });

    document.addEventListener('keydown', (event) => {
      const target = event.target;
      const inRich = target && target.closest && target.closest('#notes-richtext');
      const inSource = target && target.matches && target.matches('.notes-editor textarea');
      if (!inRich && !inSource) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'b') {
        event.preventDefault();
        if (inRich) applyRichCommand('bold');
        else applyFormat(target, 'bold');
      } else if (key === 'i') {
        event.preventDefault();
        if (inRich) applyRichCommand('italic');
        else applyFormat(target, 'italic');
      }
    });

    const modal = document.getElementById('notes-modal-dialog');
    modal?.addEventListener('toggle', () => {
      if (!modal.open) return;
      sync(document.getElementById('notes-modal-textarea'));
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', install);
    } else {
      install();
    }
  }

  return {
    render,
    escapeHtml,
    sanitizeUrl,
    htmlToMarkdown,
    applyFormatToText,
    applyFormat,
    sync,
    commit
  };
});
