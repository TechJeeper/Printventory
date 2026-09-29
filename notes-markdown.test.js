#!/usr/bin/env node
'use strict';

const assert = require('assert');
const md = require('./notes-markdown');

function test(name, fn) {
  try {
    fn();
    console.log('ok ' + name);
  } catch (err) {
    console.error('FAIL ' + name + ':', err.message);
    process.exitCode = 1;
  }
}

test('plain notes keep line breaks', () => {
  assert.strictEqual(md.render('Test notes here'), '<p>Test notes here</p>');
  assert.strictEqual(md.render('line one\nline two'), '<p>line one<br>line two</p>');
});

test('bold italic strike and code', () => {
  assert.strictEqual(md.render('**bold** and *em*'), '<p><strong>bold</strong> and <em>em</em></p>');
  assert.strictEqual(md.render('~~gone~~'), '<p><s>gone</s></p>');
  assert.strictEqual(md.render('use `file_name`'), '<p>use <code>file_name</code></p>');
});

test('filenames with underscores stay literal', () => {
  assert.strictEqual(md.render('model_v2_final'), '<p>model_v2_final</p>');
});

test('lists headings quotes and rules', () => {
  const html = md.render('## Title\n\n- one\n- two\n\n1. first\n\n> quoted\n\n---');
  assert.ok(html.includes('<h2>Title</h2>'));
  assert.ok(html.includes('<ul><li>one</li><li>two</li></ul>'));
  assert.ok(html.includes('<ol><li>first</li></ol>'));
  assert.ok(html.includes('<blockquote><p>quoted</p></blockquote>'));
  assert.ok(html.includes('<hr>'));
});

test('fenced code is not formatted', () => {
  const html = md.render('```\n**not bold**\n<script>\n```');
  assert.strictEqual(html, '<pre><code>**not bold**\n&lt;script&gt;</code></pre>');
});

test('html is escaped', () => {
  const html = md.render('<script>alert(1)</script><img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('links allow http and block javascript', () => {
  const ok = md.render('[site](https://example.com/a?q=1&x=2)');
  assert.ok(ok.includes('href="https://example.com/a?q=1&amp;x=2"'));
  assert.ok(ok.includes('rel="noopener noreferrer"'));
  const bad = md.render('[x](javascript:alert(1))');
  assert.ok(!bad.includes('<a '));
  assert.ok(bad.includes('javascript:alert(1)'));
});

test('applyFormat wraps the selection', () => {
  const bold = md.applyFormatToText('hello', 0, 5, 'bold');
  assert.strictEqual(bold.value, '**hello**');
  assert.strictEqual(bold.selectionStart, 2);
  assert.strictEqual(bold.selectionEnd, 7);

  const list = md.applyFormatToText('a\nb', 0, 3, 'list');
  assert.strictEqual(list.value, '- a\n- b');

  const link = md.applyFormatToText('docs', 0, 4, 'link');
  assert.strictEqual(link.value, '[docs](https://)');
});

function mockElement(tag, children = [], attrs = {}) {
  const el = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    childNodes: [],
    children: [],
    style: attrs.style || {},
    getAttribute(name) {
      if (name === 'href') return attrs.href || null;
      if (name === 'style') return attrs.styleAttr || null;
      return null;
    },
    querySelector(sel) {
      return this.children.find(c => sel.split(',').map(s => s.trim().toUpperCase()).includes(c.tagName)) || null;
    }
  };
  children.forEach(c => {
    const childNode = typeof c === 'string' ? { nodeType: 3, textContent: c } : c;
    el.childNodes.push(childNode);
    if (childNode.nodeType === 1) el.children.push(childNode);
  });
  return el;
}

test('htmlToMarkdown converts tags and inline styles to markdown', () => {
  // <b>bold</b> and <i>italic</i>
  const root1 = mockElement('div', [
    mockElement('b', ['bold']),
    ' and ',
    mockElement('i', ['italic'])
  ]);
  assert.strictEqual(md.htmlToMarkdown(root1), '**bold** and *italic*');

  // <span style="font-weight: bold">styled bold</span>
  const root2 = mockElement('div', [
    mockElement('span', ['styled bold'], { style: { fontWeight: 'bold' } })
  ]);
  assert.strictEqual(md.htmlToMarkdown(root2), '**styled bold**');

  // <span style="font-style: italic">styled italic</span>
  const root3 = mockElement('div', [
    mockElement('span', ['styled italic'], { style: { fontStyle: 'italic' } })
  ]);
  assert.strictEqual(md.htmlToMarkdown(root3), '*styled italic*');

  // <span style="text-decoration: line-through">styled strike</span>
  const root4 = mockElement('div', [
    mockElement('span', ['styled strike'], { style: { textDecoration: 'line-through' } })
  ]);
  assert.strictEqual(md.htmlToMarkdown(root4), '~~styled strike~~');

  // <p>Paragraph 1</p><p>Paragraph 2</p>
  const root5 = mockElement('div', [
    mockElement('p', ['Paragraph 1']),
    mockElement('p', ['Paragraph 2'])
  ]);
  assert.strictEqual(md.htmlToMarkdown(root5), 'Paragraph 1\n\nParagraph 2');

  // Headings and lists
  const root6 = mockElement('div', [
    mockElement('h2', ['Heading']),
    mockElement('ul', [
      mockElement('li', ['Item 1']),
      mockElement('li', ['Item 2'])
    ])
  ]);
  assert.strictEqual(md.htmlToMarkdown(root6), '## Heading\n\n- Item 1\n- Item 2');
});

