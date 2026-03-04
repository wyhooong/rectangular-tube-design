/* ========================================================
   计算引擎 — 纯浏览器端，无需后端
   ======================================================== */

const Engine = (() => {
'use strict';

/**
 * 矩形钢管截面几何特性
 */
function sectionProps(a, b, t) {
    const A  = 2 * t * (a + b - 2 * t);
    const Ix = (a * Math.pow(b, 3) - (a - 2*t) * Math.pow(b - 2*t, 3)) / 12;
    const Iy = (b * Math.pow(a, 3) - (b - 2*t) * Math.pow(a - 2*t, 3)) / 12;
    const Wx = 2 * Ix / b;
    const Wy = 2 * Iy / a;
    return { A, Ix, Iy, Wx, Wy, a, b, t };
}

/**
 * 计算目标相似值
 */
function targetValues(protoProps, dp) {
    const lr = dp.lengthRatio;
    const mr = dp.modulusRatio;
    const sr = dp.modelStrength / dp.prototypeStrength;

    const protoVals = {
        axialStiffness:     dp.prototypeModulus  * protoProps.A,
        axialCapacity:      dp.prototypeStrength * protoProps.A,
        bendingStiffnessX:  dp.prototypeModulus  * protoProps.Ix,
        bendingCapacityX:   dp.prototypeStrength * protoProps.Wx,
        bendingStiffnessY:  dp.prototypeModulus  * protoProps.Iy,
        bendingCapacityY:   dp.prototypeStrength * protoProps.Wy,
    };

    const ratios = {
        axialStiffness:     mr * lr * lr,
        axialCapacity:      sr * lr * lr,
        bendingStiffnessX:  mr * Math.pow(lr, 4),
        bendingCapacityX:   sr * Math.pow(lr, 3),
        bendingStiffnessY:  mr * Math.pow(lr, 4),
        bendingCapacityY:   sr * Math.pow(lr, 3),
    };

    const targets = {};
    for (const k in protoVals) targets[k] = protoVals[k] * ratios[k];
    return { protoVals, targets, ratios };
}

/**
 * 计算模型实际值
 */
function actualValues(modelProps, dp) {
    return {
        axialStiffness:     dp.modelModulus  * modelProps.A,
        axialCapacity:      dp.modelStrength * modelProps.A,
        bendingStiffnessX:  dp.modelModulus  * modelProps.Ix,
        bendingCapacityX:   dp.modelStrength * modelProps.Wx,
        bendingStiffnessY:  dp.modelModulus  * modelProps.Iy,
        bendingCapacityY:   dp.modelStrength * modelProps.Wy,
    };
}

/**
 * 计算误差
 */
function calcErrors(target, actual, weights) {
    const errors = {};
    let wErr = 0, wSum = 0;
    for (const k in target) {
        const e = Math.abs((actual[k] - target[k]) / target[k]) * 100;
        errors[k] = e;
        const w = weights[k] || 1;
        wErr += e * w;
        wSum += w;
    }
    return { errors, avgError: wSum > 0 ? wErr / wSum : 0 };
}

/**
 * 两阶段网格搜索优化
 */
function optimize(origA, origB, origT, dp, weights) {
    const lr = dp.lengthRatio;
    const initA = origA * lr;
    const initB = origB * lr;
    const minT  = dp.minThickness;

    let bestA = Math.round(initA);
    let bestB = Math.round(initB);
    let bestT = Math.max(origT * lr, minT);
    let bestErr = Infinity;

    const proto = sectionProps(origA, origB, origT);
    const { targets } = targetValues(proto, dp);

    // 统一的候选解评估函数（始终用整数 a, b 计算误差，保证一致性）
    function tryCandidate(a, b, t) {
        const ra = Math.round(a), rb = Math.round(b);
        if (t >= Math.min(ra, rb) / 4) return;
        if (ra <= 2 * t || rb <= 2 * t) return;
        const mp = sectionProps(ra, rb, t);
        const av = actualValues(mp, dp);
        const { avgError } = calcErrors(targets, av, weights);
        if (avgError < bestErr) {
            bestErr = avgError;
            bestA = ra;
            bestB = rb;
            bestT = t;
        }
    }

    // ★ 先评估直接缩放解（当相似比=1时，此解即为精确解）
    tryCandidate(initA, initB, bestT);

    function search(aR, bR, tR, steps) {
        for (let i = 0; i <= steps; i++) {
            const ta = aR[0] + (aR[1] - aR[0]) * i / steps;
            for (let j = 0; j <= steps; j++) {
                const tb = bR[0] + (bR[1] - bR[0]) * j / steps;
                for (let k = 0; k <= steps; k++) {
                    const tt = tR[0] + (tR[1] - tR[0]) * k / steps;
                    tryCandidate(ta, tb, tt);
                }
            }
        }
    }

    // 粗搜
    search(
        [initA * 0.3, initA * 3.0],
        [initB * 0.3, initB * 3.0],
        [minT, Math.max(origT * lr * 5, 10)],
        18
    );

    // 细搜
    search(
        [Math.max(2.5, bestA * 0.8), bestA * 1.2],
        [Math.max(2.5, bestB * 0.8), bestB * 1.2],
        [Math.max(minT, bestT * 0.7), Math.max(minT + 0.1, bestT * 1.3)],
        22
    );

    const optProps = sectionProps(bestA, bestB, bestT);
    const { protoVals, targets: finalTargets } = targetValues(proto, dp);
    const actVals = actualValues(optProps, dp);
    const { errors } = calcErrors(finalTargets, actVals, weights);

    return {
        original:       { a: origA, b: origB, t: origT },
        optimized:      { a: bestA, b: bestB, t: Math.round(bestT * 10000) / 10000 },
        scalingFactors: {
            lengthFactor:    bestA / origA,
            widthFactor:     bestB / origB,
            thicknessFactor: bestT / origT,
        },
        prototypeValues: protoVals,
        targetValues:    finalTargets,
        actualValues:    actVals,
        errors,
        totalError:      bestErr,
    };
}

/**
 * 批量计算
 */
function batchOptimize(cases) {
    return cases.map((c, idx) => {
        try {
            const dp = {
                lengthRatio:       c.lengthRatio,
                modulusRatio:      c.modulusRatio,
                accelerationRatio: c.accelerationRatio || 3.333,
                prototypeStrength: c.prototypeStrength,
                modelStrength:     c.modelStrength,
                prototypeModulus:  c.prototypeModulus,
                modelModulus:      c.modelModulus,
                minThickness:      c.minThickness || 0.5,
            };
            const weights = {
                axialStiffness:    c.w_axialStiffness    || 1,
                axialCapacity:     c.w_axialCapacity     || 1,
                bendingStiffnessX: c.w_bendingStiffnessX || 1,
                bendingCapacityX:  c.w_bendingCapacityX  || 1,
                bendingStiffnessY: c.w_bendingStiffnessY || 1,
                bendingCapacityY:  c.w_bendingCapacityY  || 1,
            };
            const r = optimize(c.length, c.width, c.thickness, dp, weights);
            return { ok: true, index: idx, data: r };
        } catch (e) {
            return { ok: false, index: idx, msg: String(e) };
        }
    });
}

// 暴露公共 API
return { optimize, batchOptimize };

})();
