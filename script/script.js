const btn = document.getElementById("generateBtn");
const input = document.getElementById("topicInput");
const outputDiv = document.getElementById("output");
const spinner = document.getElementById("spinner");
const modelSelect = document.getElementById("modelSelect");
const lengthSelect = document.getElementById("lengthSelect");
const toastContainer = document.getElementById("toastContainer");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");
const historyList = document.getElementById("historyList");
const themeToggle = document.getElementById("themeToggle");
const suggestionsEl = document.getElementById("suggestions");
const clearBtn = document.getElementById("clearBtn");
const shareBtn = document.getElementById("shareBtn");
const tabMarkdown = document.getElementById("tabMarkdown");
const tabOutline = document.getElementById("tabOutline");
const markdownView = document.getElementById("markdownView");
const outlineView = document.getElementById("outlineView");
let lastMarkdown = "";

async function generate() {
    const topic = input.value.trim();

    if (!topic) {
        if (markdownView) markdownView.innerHTML = "<p>Please enter a topic.</p>";
        return;
    }


    btn.disabled = true;
    spinner.classList.remove("hidden");
    outputDiv.classList.remove("empty");
    if (markdownView) markdownView.innerHTML = "<p>Generating roadmap... ⏳</p>";

    try {
        const response = await fetch("/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ topic, model: modelSelect?.value || 'auto', length: lengthSelect?.value || 'medium' })
        });

        const data = await response.json();
        if (!response.ok) {
            const msg = data.error || "Request failed";
            const details = data.details ? (typeof data.details === 'string' ? data.details : JSON.stringify(data.details, null, 2)) : '';
            const contentPreview = data.content_preview ? (typeof data.content_preview === 'string' ? data.content_preview : JSON.stringify(data.content_preview, null, 2)) : '';
            const url = data.url ? `<div>URL: <code>${data.url}</code></div>` : '';
            if (markdownView) markdownView.innerHTML = `<p>❌ ${msg}</p>${url}${details ? `<pre>${details}</pre>` : ''}${contentPreview ? `<pre>${contentPreview}</pre>` : ''}`;
            showToast(msg);
            return;
        }
        if (window.marked) {
            if (markdownView) markdownView.innerHTML = window.marked.parse(data.roadmap);
            try { renderTimelineFromMarkdown(data.roadmap); } catch (e) {}
        } else {
            if (markdownView) markdownView.innerHTML = `<pre>${data.roadmap}</pre>`;
        }
        lastMarkdown = typeof data.roadmap === 'string' ? data.roadmap : '';
        try { renderOutlineFromMarkdown(lastMarkdown); } catch (_) {}
    } catch (err) {
        console.error(err);
        if (markdownView) markdownView.innerHTML = "<p>❌ Error generating roadmap.</p>";
        showToast('Error generating roadmap');
    } finally {
        btn.disabled = false;
        spinner.classList.add("hidden");
    }
}

function saveToHistory(topic) {
    const key = 'sf_history';
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    const next = [topic, ...arr.filter(t => t !== topic)].slice(0, 10);
    localStorage.setItem(key, JSON.stringify(next));
    renderHistory(next);
}

function renderHistory(arr) {
    if (!historyList) return;
    historyList.innerHTML = '';
    arr.forEach(topic => {
        const el = document.createElement('button');
        el.className = 'chip';
        el.textContent = topic;
        el.addEventListener('click', () => {
            input.value = topic;
            generate();
        });
        historyList.appendChild(el);
    });
}

function loadHistory() {
    try {
        const arr = JSON.parse(localStorage.getItem('sf_history') || '[]');
        renderHistory(arr);
    } catch (_) {}
}

function setTheme(dark) {
    const root = document.documentElement;
    if (dark) {
        root.classList.remove('light');
        themeToggle && (themeToggle.checked = true);
    } else {
        root.classList.add('light');
        themeToggle && (themeToggle.checked = false);
    }
    localStorage.setItem('sf_theme', dark ? 'dark' : 'light');
}

function initTheme() {
    const pref = localStorage.getItem('sf_theme');
    const dark = pref ? pref === 'dark' : true;
    setTheme(dark);
}

async function copyMarkdown() {
    const text = lastMarkdown || markdownView?.textContent || '';
    if (!text.trim()) return;
    await navigator.clipboard.writeText(text);
}

function downloadMarkdown() {
    const text = lastMarkdown || markdownView?.textContent || '';
    if (!text.trim()) return;
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (input.value.trim() || 'roadmap') + '.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Hook generate to history persistence
const _origGenerate = generate;
generate = async function() {
    await _origGenerate();
    const topic = input.value.trim();
    if (topic) saveToHistory(topic);
    if (topic) renderDemandChart(topic);
}

btn.addEventListener("click", generate);
input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        generate();
    }
});

// Tabs
function activateTab(which) {
    if (!markdownView || !outlineView) return;
    if (which === 'outline') {
        outlineView.classList.remove('hidden');
        markdownView.classList.add('hidden');
        tabOutline && tabOutline.classList.add('active');
        tabMarkdown && tabMarkdown.classList.remove('active');
    } else {
        markdownView.classList.remove('hidden');
        outlineView.classList.add('hidden');
        tabMarkdown && tabMarkdown.classList.add('active');
        tabOutline && tabOutline.classList.remove('active');
    }
}
tabMarkdown && tabMarkdown.addEventListener('click', () => activateTab('markdown'));
tabOutline && tabOutline.addEventListener('click', () => activateTab('outline'));

function showToast(message) {
    if (!toastContainer) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = message;
    toastContainer.appendChild(t);
    setTimeout(() => { t.remove(); }, 3000);
}

clearHistoryBtn && clearHistoryBtn.addEventListener('click', () => {
    localStorage.removeItem('sf_history');
    renderHistory([]);
    showToast('History cleared');
});

// Clear button
clearBtn && clearBtn.addEventListener('click', () => {
    input.value = '';
    lastMarkdown = '';
    if (markdownView) markdownView.innerHTML = '<div class="placeholder">Your roadmap will appear here.</div>';
    if (outlineView) outlineView.innerHTML = '<div class="placeholder">Switch to Markdown and generate to see outline.</div>';
    outputDiv.classList.add('empty');
});

// Share button (deep link with topic)
shareBtn && shareBtn.addEventListener('click', async () => {
    const topic = input.value.trim();
    const url = new URL(window.location.href);
    if (topic) url.searchParams.set('topic', topic); else url.searchParams.delete('topic');
    const view = outlineView && !outlineView.classList.contains('hidden') ? 'outline' : 'markdown';
    url.searchParams.set('view', view);
    const href = url.toString();
    try { await navigator.clipboard.writeText(href); showToast('Link copied'); } catch (_) { showToast('Copy failed'); }
});

// Add default presets
const defaultPresets = ['Python programming', 'Data Science', 'React developer', 'AWS cloud'];
const presetsEl = document.getElementById('presets');
if (presetsEl) {
    presetsEl.innerHTML = '';
    defaultPresets.forEach(p => {
        const el = document.createElement('button');
        el.className = 'chip';
        el.textContent = p;
        el.addEventListener('click', () => { input.value = p; generate(); });
        presetsEl.appendChild(el);
    });
}

// Suggestions autocomplete under input
function filterSuggestions(q) {
    const base = defaultPresets;
    if (!q) return base;
    const s = q.toLowerCase();
    return base.filter(x => x.toLowerCase().includes(s)).slice(0, 6);
}
function renderSuggestions(list) {
    if (!suggestionsEl) return;
    suggestionsEl.innerHTML = '';
    if (!list.length) { suggestionsEl.classList.add('hidden'); return; }
    list.forEach(txt => {
        const b = document.createElement('button');
        b.className = 'suggestion';
        b.textContent = txt;
        b.addEventListener('click', () => { input.value = txt; suggestionsEl.classList.add('hidden'); generate(); });
        suggestionsEl.appendChild(b);
    });
    suggestionsEl.classList.remove('hidden');
}
input && input.addEventListener('input', () => {
    const q = input.value.trim();
    renderSuggestions(filterSuggestions(q));
});
document.addEventListener('click', (e) => {
    if (!suggestionsEl) return;
    if (e.target !== input && !suggestionsEl.contains(e.target)) suggestionsEl.classList.add('hidden');
});

copyBtn && copyBtn.addEventListener('click', copyMarkdown);
downloadBtn && downloadBtn.addEventListener('click', downloadMarkdown);

themeToggle && themeToggle.addEventListener('change', (e) => {
    setTheme(e.target.checked);
});

// Initialize
loadHistory();
initTheme();

// Deep link: ?topic=...&view=outline|markdown
try {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('topic');
    const v = params.get('view');
    if (t) { input.value = t; }
    if (v === 'outline') { activateTab('outline'); } else { activateTab('markdown'); }
    if (t) { generate(); }
} catch (_) {}

// Timeline visualization removed to simplify UI. Keep function stub for backward compatibility.
function renderTimelineFromMarkdown(_md) {
    // intentionally no-op
}

function renderOutlineFromMarkdown(md) {
    if (!outlineView) return;
    if (!md || !md.trim()) { outlineView.innerHTML = '<div class="placeholder">No outline available.</div>'; return; }
    const lines = md.split(/\r?\n/);
    const items = [];
    for (const ln of lines) {
        const m = ln.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
        if (m) { items.push({ level: m[1].length, text: m[2].trim() }); }
    }
    if (!items.length) { outlineView.innerHTML = '<div class="placeholder">No headings found.</div>'; return; }
    const root = document.createElement('ul');
    let stack = [{ level: 0, el: root }];
    items.forEach(({ level, text }) => {
        const li = document.createElement('li');
        li.textContent = text;
        while (stack.length && level <= stack[stack.length - 1].level) stack.pop();
        const parent = stack[stack.length - 1].el;
        parent.appendChild(li);
        const ul = document.createElement('ul');
        li.appendChild(ul);
        stack.push({ level, el: ul });
    });
    outlineView.innerHTML = '';
    outlineView.appendChild(root);
}

// Demand comparison chart (mock scoring for demo)
let demandChart;
let salaryChart;
function buildChartConfig(type, labels, data) {
    const baseColors = [
        'rgba(79,70,229,0.9)',
        'rgba(6,182,212,0.85)',
        'rgba(16,185,129,0.85)',
        'rgba(245,158,11,0.85)',
        'rgba(236,72,153,0.85)'
    ];
    if (type === 'line') {
        return {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Relative demand',
                    data,
                    borderColor: baseColors[0],
                    backgroundColor: 'rgba(79,70,229,0.12)',
                    tension: 0.3,
                    pointRadius: 5,
                    fill: true,
                }]
            },
            options: chartCommonOptions()
        };
    } else if (type === 'combo') {
        return {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        type: 'bar',
                        label: 'Demand (bar)',
                        data,
                        backgroundColor: baseColors,
                        borderRadius: 6,
                    },
                    {
                        type: 'line',
                        label: 'Demand trend',
                        data,
                        borderColor: 'rgba(0,0,0,0.65)',
                        backgroundColor: 'rgba(0,0,0,0.05)',
                        tension: 0.35,
                        pointRadius: 4,
                    }
                ]
            },
            options: chartCommonOptions()
        };
    }
    // default: bar
    return {
        type: 'bar',
        data: {
            labels,
                datasets: [{
                label: 'Relative demand',
                data,
                backgroundColor: baseColors,
                borderRadius: 6,
            }]
        },
        options: chartCommonOptions()
    };
}

function chartCommonOptions() {
    return {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
            y: { beginAtZero: true, suggestedMax: 120, grid: { color: 'rgba(255,255,255,0.04)' } },
            x: { grid: { display: false } }
        },
        interaction: { mode: 'index', intersect: false }
    };
}

function renderDemandChart(topic, type = 'bar') {
    const ctx = document.getElementById('demandChart');
    if (!ctx || !window.Chart) return;
    const peers = pickPeers(topic);
    const labels = [topic, ...peers];
    const data = labels.map(label => pseudoDemandScore(label));
    const config = buildChartConfig(type, labels, data);
    if (demandChart) { demandChart.destroy(); }
    demandChart = new Chart(ctx, config);
}

// Salary insights (India) — fetch mock data and render a combined chart
async function fetchSalaryData(topic, experience = 'mid') {
    try {
        const res = await fetch('/api/salary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tech: topic, experience })
        });
        if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            throw new Error(j.error || `Status ${res.status}`);
        }
        return await res.json();
    } catch (e) {
        console.error('Salary fetch error', e);
        return null;
    }
}

function buildSalaryChartConfig(data) {
    // For a quick comparison bar chart, include peers and the selected tech
    const peers = pickPeers(data.tech || data.tech || 'Topic');
    const labels = [data.tech, ...peers];
    // generate varied mock medians for peers based on data.median
    const base = data.median;
    const values = labels.map((lbl, i) => {
        // deterministic variation per label
        let h = 0; for (let j = 0; j < lbl.length; j++) h = (h * 31 + lbl.charCodeAt(j)) >>> 0;
        const delta = (h % 400000) - 150000; // vary +/- ~150k
        return Math.max(0.5, (base + delta) / 100000); // convert to lakhs, min 0.5L
    });

    const colors = [
        'rgba(79,70,229,0.9)',
        'rgba(6,182,212,0.85)',
        'rgba(16,185,129,0.85)',
        'rgba(245,158,11,0.85)',
        'rgba(236,72,153,0.85)'
    ];

    return {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Median salary (lakhs INR)',
                data: values,
                backgroundColor: labels.map((_, i) => colors[i % colors.length]),
                borderRadius: 8,
            }]
        },
        options: Object.assign({}, chartCommonOptions(), {
            scales: { y: { beginAtZero: true, ticks: { callback: v => v + 'L' } } },
            plugins: { legend: { display: false } }
        })
    };
}

async function renderSalaryChart(topic, experience = 'mid') {
    const el = document.getElementById('salarySummary');
    if (!topic) {
        el && (el.textContent = 'Enter a topic to view mock salary insights.');
        return;
    }
    el && (el.textContent = 'Loading salary data...');
    const data = await fetchSalaryData(topic, experience);
    if (!data) {
        el && (el.textContent = 'Failed to load salary data.');
        return;
    }
    const ctx = document.getElementById('salaryChart');
    if (!ctx || !window.Chart) {
        el && (el.textContent = 'Chart library not available.');
        return;
    }
    const cfg = buildSalaryChartConfig(data);
    if (salaryChart) salaryChart.destroy();
    salaryChart = new Chart(ctx, cfg);

    // Update summary
    const medianLakhs = (data.median / 100000).toFixed(2);
    const formatted = data.median.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    el && (el.innerHTML = `${data.tech} (${data.experience}) — median: ₹${formatted} (~${medianLakhs}L), demand index: ${data.demand_index}`);
}

// Hook salary experience selector
const salaryExpSelect = document.getElementById('salaryExpSelect');
if (salaryExpSelect) {
    salaryExpSelect.addEventListener('change', () => {
        const topic = input.value.trim();
        renderSalaryChart(topic, salaryExpSelect.value);
    });
}

function pickPeers(topic) {
    const map = {
        'python': ['Data Science', 'Django', 'Flask', 'Machine Learning'],
        'react': ['Next.js', 'Vue', 'Angular', 'Svelte'],
        'aws': ['Azure', 'GCP', 'DevOps', 'Kubernetes'],
        'data': ['SQL', 'Power BI', 'Tableau', 'Excel'],
    };
    const key = Object.keys(map).find(k => topic.toLowerCase().includes(k));
    return key ? map[key] : ['React', 'Python', 'AWS', 'SQL'];
}

function pseudoDemandScore(label) {
    // Simple stable hash to 50..100
    let h = 0;
    for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
    return 50 + (h % 51);
}

// Hook chart type selector
const chartTypeSelect = document.getElementById('chartTypeSelect');
if (chartTypeSelect) {
    chartTypeSelect.addEventListener('change', () => {
        const topic = input.value.trim() || 'Topic';
        renderDemandChart(topic, chartTypeSelect.value);
    });
}

// When topic is generated, also refresh salary chart
async function maybeRenderSalary(topic) {
    const exp = salaryExpSelect ? salaryExpSelect.value : 'mid';
    await renderSalaryChart(topic, exp);
}

// augment the generate flow to update salary chart after generation
const _origGenerate2 = generate;
generate = async function() {
    await _origGenerate2();
    const topic = input.value.trim();
    if (topic) {
        await maybeRenderSalary(topic);
    }
}
