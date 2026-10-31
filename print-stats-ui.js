/**
 * Print statistics tab inside #stats-dialog.
 */
(function () {
  'use strict';

  let printsChart = null;

  async function loadPrintStats() {
    const panel = document.getElementById('stats-print-panel');
    if (!panel || !window.electron?.getPrintStats) return;
    const stats = await window.electron.getPrintStats({});
    setText('stats-prints-want-never', stats.wantNeverPrintedCount ?? 0);
    setText('stats-prints-spend', stats.librarySpend != null ? `$${Number(stats.librarySpend).toFixed(2)}` : '—');

    const sv = stats.successVsFailed || {};
    setText('stats-prints-ok', sv.printed ?? 0);
    setText('stats-prints-failed', sv.failed ?? 0);
    setText('stats-prints-cancelled', sv.cancelled ?? 0);

    const most = document.getElementById('stats-most-printed');
    if (most) {
      most.innerHTML = '';
      for (const m of (stats.mostPrintedModels || []).slice(0, 8)) {
        const li = document.createElement('li');
        li.textContent = `${m.fileName || m.filePath || m.modelId}: ${m.printCount ?? m.print_count ?? 0}`;
        most.appendChild(li);
      }
      if (!most.children.length) most.innerHTML = '<li>None yet</li>';
    }

    const printers = document.getElementById('stats-prints-per-printer');
    if (printers) {
      printers.innerHTML = '';
      for (const p of stats.printsPerPrinter || []) {
        const li = document.createElement('li');
        li.textContent = `${p.nickname || 'Unknown'}: ${p.count}`;
        printers.appendChild(li);
      }
      if (!printers.children.length) printers.innerHTML = '<li>None yet</li>';
    }

    const filament = document.getElementById('stats-filament-usage');
    if (filament) {
      filament.innerHTML = '';
      for (const f of stats.filamentUsageByMaterial || []) {
        const li = document.createElement('li');
        li.textContent = `${f.material}${f.vendor ? ' / ' + f.vendor : ''}: ${f.grams != null ? f.grams + ' g' : (f.quantity ?? f.eventLinks ?? 0)}`;
        filament.appendChild(li);
      }
      if (!filament.children.length) filament.innerHTML = '<li>None yet</li>';
    }

    const canvas = document.getElementById('prints-per-month-chart');
    if (canvas && typeof Chart !== 'undefined') {
      const labels = (stats.printsPerMonth || []).map((r) => r.month);
      const values = (stats.printsPerMonth || []).map((r) => r.count);
      if (printsChart) printsChart.destroy();
      printsChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels,
          datasets: [{ label: 'Prints', data: values, backgroundColor: 'rgba(0, 212, 255, 0.55)' }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: '#a8a8b8' }, grid: { color: 'rgba(255,255,255,0.06)' } },
            y: { ticks: { color: '#a8a8b8' }, grid: { color: 'rgba(255,255,255,0.06)' }, beginAtZero: true }
          }
        }
      });
    }
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(val);
  }

  function wireTabs() {
    document.querySelectorAll('.stats-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.stats-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        const which = tab.dataset.statsTab;
        document.getElementById('stats-library-panel')?.toggleAttribute('hidden', which !== 'library');
        document.getElementById('stats-print-panel')?.toggleAttribute('hidden', which !== 'prints');
        if (which === 'prints') loadPrintStats();
      });
    });
  }

  const orig = window.populateStatsDialog || window.loadStatsDialog;
  window.loadPrintStatsTab = loadPrintStats;

  // Hook after library stats load if present
  document.addEventListener('DOMContentLoaded', () => {
    wireTabs();
    const observer = new MutationObserver(() => {
      const dlg = document.getElementById('stats-dialog');
      if (dlg?.open && document.querySelector('.stats-tab.active')?.dataset.statsTab === 'prints') {
        loadPrintStats();
      }
    });
    const dlg = document.getElementById('stats-dialog');
    if (dlg) observer.observe(dlg, { attributes: true, attributeFilter: ['open'] });
  });
})();
