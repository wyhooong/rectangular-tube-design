/* ========================================================
   矩形钢管截面缩尺自动化设计系统 — 前端交互 (公网静态版)
   所有计算调用 Engine (engine.js)，无需后端
   ======================================================== */

(() => {
'use strict';

const HIST_KEY   = 'rect_tube_hist_v3';
const PARAMS_KEY = 'rect_tube_params_v3';
let lastResult   = null;
let lastBatchResults = null;
let debounceId   = null;

// ======================== DOM helpers ========================
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const byId = id => document.getElementById(id);

// ======================== Tab 切换 ========================
$$('.nav-link').forEach(link => {
    link.addEventListener('click', e => {
        e.preventDefault();
        $$('.nav-link').forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        $$('.tab-pane').forEach(p => p.classList.remove('active'));
        byId('tab-' + link.dataset.tab)?.classList.add('active');
        if (link.dataset.tab === 'history') renderHistory();
        // 关闭移动端菜单
        $('.nav-links')?.classList.remove('open');
    });
});

// 移动端菜单
byId('mobileToggle')?.addEventListener('click', () => {
    $('.nav-links')?.classList.toggle('open');
});

// ======================== 收集参数 ========================
const INPUT_IDS = [
    'length','width','thickness',
    'lengthRatio','modulusRatio','accelerationRatio',
    'prototypeStrength','modelStrength','prototypeModulus','modelModulus','minThickness',
    'w_axialStiffness','w_axialCapacity','w_bendingStiffnessX',
    'w_bendingCapacityX','w_bendingStiffnessY','w_bendingCapacityY'
];

function collectPayload() {
    const d = {};
    INPUT_IDS.forEach(id => { d[id] = parseFloat(byId(id)?.value) || 0; });
    return d;
}

function collectDP(p) {
    return {
        lengthRatio:       p.lengthRatio,
        modulusRatio:      p.modulusRatio,
        accelerationRatio: p.accelerationRatio,
        prototypeStrength: p.prototypeStrength,
        modelStrength:     p.modelStrength,
        prototypeModulus:  p.prototypeModulus,
        modelModulus:      p.modelModulus,
        minThickness:      p.minThickness,
    };
}

function collectWeights(p) {
    return {
        axialStiffness:    p.w_axialStiffness,
        axialCapacity:     p.w_axialCapacity,
        bendingStiffnessX: p.w_bendingStiffnessX,
        bendingCapacityX:  p.w_bendingCapacityX,
        bendingStiffnessY: p.w_bendingStiffnessY,
        bendingCapacityY:  p.w_bendingCapacityY,
    };
}

// ======================== 自动计算 ========================
INPUT_IDS.forEach(id => {
    const el = byId(id);
    if (!el) return;
    el.addEventListener('input', () => {
        saveParams();
        drawSketch();
        if (!byId('autoCalc')?.checked) return;
        clearTimeout(debounceId);
        debounceId = setTimeout(() => doCalculate(false), 280);
    });
});

// ======================== 按钮绑定 ========================
byId('btnCalc')?.addEventListener('click', () => doCalculate(true));
byId('btnSample')?.addEventListener('click', loadSample);
byId('btnReset')?.addEventListener('click', resetInputs);
byId('btnDownloadReport')?.addEventListener('click', downloadReport);
byId('btnDownloadCsv')?.addEventListener('click', downloadCsv);
byId('btnClearHistory')?.addEventListener('click', clearHistory);
byId('btnBatch')?.addEventListener('click', doBatchCalc);
byId('btnBatchSample')?.addEventListener('click', fillBatchSample);
byId('btnBatchExport')?.addEventListener('click', exportBatchCsv);

// ======================== 核心计算（本地） ========================
function doCalculate(showAlert = true) {
    const p = collectPayload();

    if (p.length <= 0 || p.width <= 0 || p.thickness <= 0) {
        if (showAlert) alert('截面尺寸必须为正数'); return;
    }
    if (p.thickness >= Math.min(p.length, p.width) / 2) {
        if (showAlert) alert('厚度必须小于长/宽的一半'); return;
    }

    const t0 = performance.now();
    const result = Engine.optimize(
        p.length, p.width, p.thickness,
        collectDP(p), collectWeights(p)
    );
    result.elapsed = ((performance.now() - t0) / 1000).toFixed(3);

    lastResult = result;
    renderResult(result);
    drawErrorChart(result.errors);
    pushHistory(result, p);
    saveParams();
}

// ======================== 渲染结果 ========================
function renderResult(r) {
    const ec = v => v <= 5 ? 'err-good' : v <= 15 ? 'err-medium' : 'err-bad';
    const fv = v => {
        if (Math.abs(v) >= 1e6) return (v/1e6).toFixed(2) + 'M';
        if (Math.abs(v) >= 1e3) return (v/1e3).toFixed(2) + 'K';
        if (Math.abs(v) < 0.01 && v !== 0) return v.toExponential(2);
        return v.toFixed(2);
    };
    const sug = e => {
        if (e <= 5)  return '✅ 模型相似性优秀，可直接加工。';
        if (e <= 12) return '⚠️ 模型可用，建议微调厚度与权重。';
        if (e <= 20) return '🔧 建议调整相似系数或材料参数后重新优化。';
        return '❌ 误差偏大，建议重新设定缩尺策略。';
    };

    const metrics = [
        ['轴向刚度',     'axialStiffness'],
        ['轴向承载力',   'axialCapacity'],
        ['X轴抗弯刚度',  'bendingStiffnessX'],
        ['X轴抗弯承载力','bendingCapacityX'],
        ['Y轴抗弯刚度',  'bendingStiffnessY'],
        ['Y轴抗弯承载力','bendingCapacityY'],
    ];

    const rows = metrics.map(([label, key]) => `
        <tr>
            <td>${label}</td>
            <td>${fv(r.targetValues[key])}</td>
            <td>${fv(r.actualValues[key])}</td>
            <td class="${ec(r.errors[key])}">${r.errors[key].toFixed(2)}</td>
        </tr>`).join('');

    byId('resultArea').innerHTML = `
        <div class="result-item">
            <h4>📐 优化后截面尺寸</h4>
            <div class="result-value">
                ${r.optimized.a.toFixed(2)} × ${r.optimized.b.toFixed(2)} × ${r.optimized.t.toFixed(2)} mm
            </div>
        </div>
        <div class="result-item">
            <h4>📏 实际缩尺系数</h4>
            <div class="result-value">
                长度 ${r.scalingFactors.lengthFactor.toFixed(4)} &nbsp;|&nbsp;
                宽度 ${r.scalingFactors.widthFactor.toFixed(4)} &nbsp;|&nbsp;
                厚度 ${r.scalingFactors.thicknessFactor.toFixed(4)}
            </div>
        </div>
        <div class="result-item" style="border-left-color:${r.totalError<=5?'#38a169':r.totalError<=15?'#d69e2e':'#e53e3e'}">
            <h4>📊 总体加权误差</h4>
            <div class="result-value ${ec(r.totalError)}">${r.totalError.toFixed(2)} %</div>
            <div style="font-size:.82rem;color:#718096;margin-top:4px;">${sug(r.totalError)}</div>
        </div>
        <div style="font-size:.8rem;color:#a0aec0;margin-bottom:8px;">⏱ 计算耗时 ${r.elapsed} 秒（浏览器本地）</div>
        <table class="comparison-table">
            <thead><tr><th>性能指标</th><th>目标值</th><th>实际值</th><th>误差(%)</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
        ${r.totalError > 15 ? '<div class="warning-box">⚠️ 总体误差较大 (>15%)，建议调整参数或权重。</div>' : ''}
    `;
}

// ======================== 误差柱状图 ========================
function drawErrorChart(errors) {
    const canvas = byId('errorChart');
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = 560, H = 220;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const keys = [
        { k: 'axialStiffness',    n: '轴刚' },
        { k: 'axialCapacity',     n: '轴承' },
        { k: 'bendingStiffnessX', n: 'X刚' },
        { k: 'bendingCapacityX',  n: 'X承' },
        { k: 'bendingStiffnessY', n: 'Y刚' },
        { k: 'bendingCapacityY',  n: 'Y承' },
    ];
    const vals = keys.map(i => errors[i.k] || 0);
    const maxV = Math.max(5, ...vals) * 1.2;

    const L = 48, B = 185, T = 14, R = 540;

    // axes
    ctx.strokeStyle = '#cbd5e0'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(L, T); ctx.lineTo(L, B); ctx.lineTo(R, B); ctx.stroke();

    // grid
    ctx.fillStyle = '#a0aec0'; ctx.font = '11px -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
        const y = B - (B - T) * i / 4;
        ctx.strokeStyle = '#edf2f7';
        ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke();
        ctx.fillText((maxV * i / 4).toFixed(1), L - 6, y + 4);
    }

    const bw = 50, gap = 28, sx = 68;
    ctx.textAlign = 'center';
    keys.forEach((item, idx) => {
        const x = sx + idx * (bw + gap);
        const v = vals[idx];
        const h = (v / maxV) * (B - T);
        const y = B - h;

        // bar gradient
        const grd = ctx.createLinearGradient(x, y, x, B);
        if (v <= 5) { grd.addColorStop(0, '#68d391'); grd.addColorStop(1, '#38a169'); }
        else if (v <= 15) { grd.addColorStop(0, '#f6e05e'); grd.addColorStop(1, '#d69e2e'); }
        else { grd.addColorStop(0, '#fc8181'); grd.addColorStop(1, '#e53e3e'); }
        ctx.fillStyle = grd;

        // rounded top
        const r = 4;
        ctx.beginPath();
        ctx.moveTo(x, B);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.lineTo(x + bw - r, y);
        ctx.arcTo(x + bw, y, x + bw, y + r, r);
        ctx.lineTo(x + bw, B);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#2d3748';
        ctx.font = 'bold 11px -apple-system, Segoe UI, sans-serif';
        ctx.fillText(v.toFixed(1) + '%', x + bw / 2, y - 6);
        ctx.font = '11px -apple-system, Segoe UI, sans-serif';
        ctx.fillText(item.n, x + bw / 2, B + 16);
    });
}

// ======================== 截面示意图 ========================
function drawSketch() {
    const canvas = byId('sketchCanvas');
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = 280, H = 200;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const a = parseFloat(byId('length')?.value) || 100;
    const b = parseFloat(byId('width')?.value) || 50;
    const t = parseFloat(byId('thickness')?.value) || 5;

    const scale = Math.min((W - 70) / a, (H - 60) / b);
    const sw = a * scale, sh = b * scale;
    const ox = (W - sw) / 2, oy = (H - sh) / 2;
    const st = Math.max(t * scale, 2);

    // outer
    ctx.fillStyle = '#bee3f8';
    ctx.strokeStyle = '#2b6cb0'; ctx.lineWidth = 1.5;
    ctx.fillRect(ox, oy, sw, sh);
    ctx.strokeRect(ox, oy, sw, sh);

    // inner
    if (st < sw / 2 && st < sh / 2) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(ox + st, oy + st, sw - 2 * st, sh - 2 * st);
        ctx.strokeStyle = '#63b3ed';
        ctx.strokeRect(ox + st, oy + st, sw - 2 * st, sh - 2 * st);
    }

    // labels
    ctx.fillStyle = '#2d3748'; ctx.font = '11px -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`a = ${a} mm`, ox + sw / 2, oy - 8);
    ctx.save();
    ctx.translate(ox - 12, oy + sh / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`b = ${b} mm`, 0, 0);
    ctx.restore();
    if (st > 6) {
        ctx.fillStyle = '#e53e3e'; ctx.font = '10px -apple-system, sans-serif';
        ctx.fillText(`t=${t}`, ox + st / 2 + 18, oy + sh / 2 + 4);
    }
}

// ======================== 方案历史 ========================
function getHistory() {
    try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch { return []; }
}
function setHistory(arr) { localStorage.setItem(HIST_KEY, JSON.stringify(arr)); }

function pushHistory(r, payload) {
    const arr = getHistory();
    arr.unshift({
        time: new Date().toLocaleString(),
        original: r.original,
        optimized: r.optimized,
        totalError: r.totalError,
        payload,
    });
    setHistory(arr.slice(0, 30));
}

function renderHistory() {
    const area = byId('historyArea');
    if (!area) return;
    const arr = getHistory();
    if (!arr.length) { area.innerHTML = '<p class="placeholder-text">暂无历史记录</p>'; return; }

    area.innerHTML = arr.map((h, i) => {
        const ec = h.totalError <= 5 ? 'err-good' : h.totalError <= 15 ? 'err-medium' : 'err-bad';
        return `<div class="history-item" data-idx="${i}">
            <span class="hi-time">#${i + 1} &nbsp;${h.time}</span>
            <span class="hi-err ${ec}">${h.totalError.toFixed(2)}%</span><br>
            原型: ${h.original.a} × ${h.original.b} × ${h.original.t} mm →
            模型: ${h.optimized.a.toFixed(0)} × ${h.optimized.b.toFixed(0)} × ${h.optimized.t.toFixed(2)} mm
        </div>`;
    }).join('');

    area.querySelectorAll('.history-item').forEach(el => {
        el.addEventListener('click', () => {
            const h = getHistory()[parseInt(el.dataset.idx)];
            if (!h?.payload) return;
            Object.keys(h.payload).forEach(k => { const el = byId(k); if (el) el.value = h.payload[k]; });
            $$('.nav-link').forEach(l => l.classList.remove('active'));
            $$('.nav-link')[0].classList.add('active');
            $$('.tab-pane').forEach(p => p.classList.remove('active'));
            byId('tab-single')?.classList.add('active');
            doCalculate(false);
        });
    });
}

function clearHistory() {
    if (!confirm('确定清空所有方案历史？')) return;
    localStorage.removeItem(HIST_KEY);
    renderHistory();
}

// ======================== 批量计算 ========================
function doBatchCalc() {
    const raw = byId('batchInput')?.value.trim();
    let cases;
    try { cases = JSON.parse(raw); } catch {
        alert('JSON 格式错误，请检查输入'); return;
    }
    if (!Array.isArray(cases) || !cases.length) {
        alert('请输入一个非空 JSON 数组'); return;
    }
    if (cases.length > 50) {
        alert('单次最多 50 组'); return;
    }

    const items = Engine.batchOptimize(cases);
    lastBatchResults = items;
    renderBatchResult(items);
}

function renderBatchResult(items) {
    const ec = v => v <= 5 ? 'err-good' : v <= 15 ? 'err-medium' : 'err-bad';
    const rows = items.map(it => {
        if (!it.ok) return `<tr><td>#${it.index + 1}</td><td colspan="3" style="color:#e53e3e">${it.msg}</td></tr>`;
        const d = it.data;
        return `<tr>
            <td>#${it.index + 1}</td>
            <td>${d.original.a} × ${d.original.b} × ${d.original.t}</td>
            <td>${d.optimized.a.toFixed(0)} × ${d.optimized.b.toFixed(0)} × ${d.optimized.t.toFixed(2)}</td>
            <td class="${ec(d.totalError)}">${d.totalError.toFixed(2)}%</td>
        </tr>`;
    }).join('');

    byId('batchResultArea').innerHTML = `
        <table class="comparison-table">
            <thead><tr><th>序号</th><th>原型 (mm)</th><th>模型 (mm)</th><th>误差</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
}

function fillBatchSample() {
    byId('batchInput').value = JSON.stringify([
        { length:1000, width:500, thickness:10, lengthRatio:0.02, modulusRatio:0.2, prototypeStrength:380, modelStrength:195, prototypeModulus:206000, modelModulus:110000, minThickness:0.5 },
        { length:800,  width:400, thickness:8,  lengthRatio:0.02, modulusRatio:0.2, prototypeStrength:380, modelStrength:195, prototypeModulus:206000, modelModulus:110000, minThickness:0.5 },
        { length:1200, width:600, thickness:14, lengthRatio:0.025, modulusRatio:0.22, prototypeStrength:420, modelStrength:230, prototypeModulus:206000, modelModulus:110000, minThickness:0.6 }
    ], null, 2);
}

function exportBatchCsv() {
    if (!lastBatchResults?.length) { alert('请先执行批量计算'); return; }
    const header = ['序号','原型a','原型b','原型t','模型a','模型b','模型t','误差(%)'];
    const rows = [header];
    lastBatchResults.forEach(it => {
        if (!it.ok) { rows.push([it.index+1,'错误','','','','','',it.msg]); return; }
        const d = it.data;
        rows.push([it.index+1, d.original.a, d.original.b, d.original.t,
                    d.optimized.a, d.optimized.b, d.optimized.t.toFixed(2), d.totalError.toFixed(2)]);
    });
    const csv = '\uFEFF' + rows.map(r => r.join(',')).join('\n');
    dl(csv, `批量计算结果_${ts()}.csv`, 'text/csv');
}

// ======================== 导出 ========================
function downloadReport() {
    const r = lastResult;
    if (!r) { alert('请先完成一次计算'); return; }
    const p = collectPayload();
    const lines = [
        '═══════════════════════════════════════════════════',
        '          矩形钢管截面缩尺自动化设计报告',
        '═══════════════════════════════════════════════════',
        `生成时间: ${new Date().toLocaleString()}`,
        '',
        '─── 一、原型参数 ───',
        `截面尺寸 (mm):  ${r.original.a} × ${r.original.b} × ${r.original.t}`,
        `材料强度 (MPa): ${p.prototypeStrength}`,
        `弹性模量 (MPa): ${p.prototypeModulus}`,
        '',
        '─── 二、设计参数 ───',
        `长度相似系数:     ${p.lengthRatio}`,
        `弹性模量相似系数: ${p.modulusRatio}`,
        `加速度相似系数:   ${p.accelerationRatio}`,
        `模型材料强度:     ${p.modelStrength} MPa`,
        `模型弹性模量:     ${p.modelModulus} MPa`,
        `最小厚度:         ${p.minThickness} mm`,
        '',
        '─── 三、优化结果 ───',
        `模型截面 (mm):  ${r.optimized.a.toFixed(2)} × ${r.optimized.b.toFixed(2)} × ${r.optimized.t.toFixed(2)}`,
        `总体误差:       ${r.totalError.toFixed(2)} %`,
        `长度缩尺系数:   ${r.scalingFactors.lengthFactor.toFixed(4)}`,
        `宽度缩尺系数:   ${r.scalingFactors.widthFactor.toFixed(4)}`,
        `厚度缩尺系数:   ${r.scalingFactors.thicknessFactor.toFixed(4)}`,
        '',
        '─── 四、误差明细 ───',
        `轴向刚度:       ${r.errors.axialStiffness.toFixed(2)} %`,
        `轴向承载力:     ${r.errors.axialCapacity.toFixed(2)} %`,
        `X轴抗弯刚度:    ${r.errors.bendingStiffnessX.toFixed(2)} %`,
        `X轴抗弯承载力:  ${r.errors.bendingCapacityX.toFixed(2)} %`,
        `Y轴抗弯刚度:    ${r.errors.bendingStiffnessY.toFixed(2)} %`,
        `Y轴抗弯承载力:  ${r.errors.bendingCapacityY.toFixed(2)} %`,
        '',
        '═══════════════════════════════════════════════════',
    ];
    dl(lines.join('\n'), `矩形钢管缩尺设计报告_${ts()}.txt`);
}

function downloadCsv() {
    const r = lastResult;
    if (!r) { alert('请先完成一次计算'); return; }
    const rows = [
        ['指标','目标值','实际值','误差(%)'],
        ['轴向刚度',     r.targetValues.axialStiffness,    r.actualValues.axialStiffness,    r.errors.axialStiffness.toFixed(2)],
        ['轴向承载力',   r.targetValues.axialCapacity,     r.actualValues.axialCapacity,     r.errors.axialCapacity.toFixed(2)],
        ['X轴抗弯刚度',  r.targetValues.bendingStiffnessX, r.actualValues.bendingStiffnessX, r.errors.bendingStiffnessX.toFixed(2)],
        ['X轴抗弯承载力',r.targetValues.bendingCapacityX,  r.actualValues.bendingCapacityX,  r.errors.bendingCapacityX.toFixed(2)],
        ['Y轴抗弯刚度',  r.targetValues.bendingStiffnessY, r.actualValues.bendingStiffnessY, r.errors.bendingStiffnessY.toFixed(2)],
        ['Y轴抗弯承载力',r.targetValues.bendingCapacityY,  r.actualValues.bendingCapacityY,  r.errors.bendingCapacityY.toFixed(2)],
    ];
    const csv = '\uFEFF' + rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    dl(csv, `矩形钢管性能对比_${ts()}.csv`, 'text/csv');
}

// ======================== 辅助 ========================
function dl(content, filename, mime = 'text/plain') {
    const blob = new Blob([content], { type: mime + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
}

function ts() { return new Date().toISOString().slice(0, 19).replace(/[:-]/g, ''); }

function loadSample() {
    // 示例：1:50缩尺，原型Q345钢，模型铝合金
    const v = {
        length:1000, width:500, thickness:10,
        lengthRatio:0.02, modulusRatio:0.34, accelerationRatio:1,
        prototypeStrength:345, modelStrength:200,
        prototypeModulus:206000, modelModulus:70000, minThickness:0.5,
        w_axialStiffness:1, w_axialCapacity:1, w_bendingStiffnessX:1,
        w_bendingCapacityX:1, w_bendingStiffnessY:1, w_bendingCapacityY:1,
    };
    Object.keys(v).forEach(k => { const el = byId(k); if (el) el.value = v[k]; });
    drawSketch();
    doCalculate(false);
}

function resetInputs() {
    const d = {
        length:1000, width:500, thickness:10,
        lengthRatio:1, modulusRatio:1, accelerationRatio:1,
        prototypeStrength:345, modelStrength:345,
        prototypeModulus:206000, modelModulus:206000, minThickness:0.5,
        w_axialStiffness:1, w_axialCapacity:1, w_bendingStiffnessX:1,
        w_bendingCapacityX:1, w_bendingStiffnessY:1, w_bendingCapacityY:1,
    };
    Object.keys(d).forEach(k => { const el = byId(k); if (el) el.value = d[k]; });
    byId('resultArea').innerHTML = '<p class="placeholder-text">请输入参数并点击「优化计算」</p>';
    drawSketch();
    saveParams();
}

function saveParams() {
    const d = {};
    INPUT_IDS.forEach(id => { d[id] = byId(id)?.value; });
    d.autoCalc = byId('autoCalc')?.checked;
    localStorage.setItem(PARAMS_KEY, JSON.stringify(d));
}

function restoreParams() {
    try {
        const d = JSON.parse(localStorage.getItem(PARAMS_KEY) || '{}');
        Object.keys(d).forEach(k => {
            if (k === 'autoCalc') { const el = byId('autoCalc'); if (el) el.checked = !!d[k]; return; }
            const el = byId(k);
            if (el && d[k] != null) el.value = d[k];
        });
    } catch {}
}

// ======================== 初始化 ========================
restoreParams();
drawSketch();
setTimeout(() => doCalculate(false), 200);

})();
