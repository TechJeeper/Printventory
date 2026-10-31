/**
 * Print queue Kanban board.
 */
(function () {
  'use strict';

  const COLS = [
    { key: 'want', label: 'Want' },
    { key: 'queued', label: 'Queued' },
    { key: 'printing', label: 'Printing' },
    { key: 'printed', label: 'Printed' },
    { key: 'failed', label: 'Failed' }
  ];

  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, { type: type || 'info' });
  }

  async function openBoard() {
    const dlg = document.getElementById('print-queue-dialog');
    if (!dlg) return;
    await render();
    dlg.showModal();
  }

  async function render() {
    const boardEl = document.getElementById('print-queue-board');
    if (!boardEl || !window.electron?.getPrintQueue) return;
    const data = await window.electron.getPrintQueue();
    const board = data.board || {};
    const filaments = data.filaments || {};
    boardEl.innerHTML = '';
    for (const col of COLS) {
      const column = document.createElement('div');
      column.className = 'print-queue-column';
      column.dataset.status = col.key;
      const head = document.createElement('div');
      head.className = 'print-queue-column-head';
      const f = filaments[col.key] || {};
      head.innerHTML = `<strong>${col.label}</strong><span>${(board[col.key] || []).length}</span>`;
      if (f.filament_types) {
        const meta = document.createElement('div');
        meta.className = 'print-queue-filament-meta';
        meta.textContent = `${f.filament_types} filament type(s)`;
        head.appendChild(meta);
      }
      column.appendChild(head);
      const body = document.createElement('div');
      body.className = 'print-queue-column-body';
      body.dataset.status = col.key;
      body.addEventListener('dragover', (e) => { e.preventDefault(); body.classList.add('drag-over'); });
      body.addEventListener('dragleave', () => body.classList.remove('drag-over'));
      body.addEventListener('drop', async (e) => {
        e.preventDefault();
        body.classList.remove('drag-over');
        const modelId = Number(e.dataTransfer.getData('text/model-id'));
        if (!modelId) return;
        try {
          const updated = await window.electron.movePrintQueueStatus(modelId, col.key);
          await render();
          // Keep details panel / grid badge in sync
          const status = updated?.print_status || col.key;
          const statusSelect = document.getElementById('model-print-status');
          const detailsId = Number(document.getElementById('model-details')?.dataset?.modelId || window.currentModelId);
          if (statusSelect && detailsId === modelId) {
            statusSelect.value = status;
            statusSelect.dispatchEvent(new Event('change', { bubbles: true }));
          }
          if (typeof window.PrintHistory?.refreshBadgeForModelId === 'function') {
            window.PrintHistory.refreshBadgeForModelId(modelId, status);
          } else if (typeof window.performCombinedSearch === 'function') {
            // Soft refresh badges without full search when possible
            document.querySelectorAll(`.file-item[data-id="${modelId}"] .print-status`).forEach((badge) => {
              badge.className = `print-status print-status-${status}`;
              badge.textContent = status === 'want' ? 'Want' : status.charAt(0).toUpperCase() + status.slice(1);
            });
          }
          toast(`Moved to ${col.label}`, 'success');
        } catch (err) {
          toast(err.message || 'Could not update status', 'error');
          await render();
        }
      });
      for (const m of board[col.key] || []) {
        body.appendChild(card(m, col.key));
      }
      column.appendChild(body);
      boardEl.appendChild(column);
    }
  }

  function card(m, status) {
    const el = document.createElement('div');
    el.className = 'print-queue-card';
    el.draggable = true;
    el.dataset.modelId = String(m.id);
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/model-id', String(m.id));
    });
    const title = document.createElement('div');
    title.className = 'print-queue-card-title';
    title.textContent = m.fileName || m.filePath || `#${m.id}`;
    el.appendChild(title);
    if (status === 'want' || status === 'queued') {
      const start = document.createElement('button');
      start.type = 'button';
      start.className = 'print-queue-start';
      start.textContent = 'Start print';
      start.addEventListener('click', async (e) => {
        e.stopPropagation();
        await window.electron.startPrintFromQueue(m.id, {});
        toast('Print started', 'success');
        await render();
      });
      el.appendChild(start);
    }
    return el;
  }

  async function exportCsv() {
    const data = await window.electron.getPrintQueue();
    const rows = [['status', 'id', 'fileName', 'filePath']];
    for (const col of COLS) {
      for (const m of (data.board && data.board[col.key]) || []) {
        rows.push([col.key, m.id, m.fileName || '', m.filePath || '']);
      }
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'print-queue.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function wire() {
    document.getElementById('print-queue-button')?.addEventListener('click', openBoard);
    document.getElementById('print-queue-refresh')?.addEventListener('click', render);
    document.getElementById('print-queue-export')?.addEventListener('click', exportCsv);
    if (window.electron?.onOpenPrintQueue) window.electron.onOpenPrintQueue(openBoard);
  }

  window.PrintQueueUI = { openBoard, render };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
