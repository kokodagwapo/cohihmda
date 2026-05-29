import React, { useRef, useEffect } from "react";
import { useHmdaSprinkle } from '@hmda/context/HmdaSprinkleContext';

/**
 * When HMDA runs inside Sprinkle chrome, skip the opaque gradient + canvas so the
 * flickering grid / dots remain visible (matches sx.tvma.fi).
 */
export default function ConstellationCanvas(props) {
  const sprinkle = useHmdaSprinkle();
  useEffect(() => {
    if (sprinkle && props.onReady) props.onReady();
  }, [sprinkle, props.onReady]);
  if (sprinkle) return null;
  return <ConstellationCanvasImpl {...props} />;
}

const NODE_PALETTE = [
  { hex: "#0033A0", weight: 30 },
  { hex: "#00A651", weight: 20 },
  { hex: "#1a5fb4", weight: 10 },
  { hex: "#2e7d32", weight: 10 },
  { hex: "#0055cc", weight: 10 },
  { hex: "#338833", weight: 10 },
  { hex: "#4a90d9", weight: 10 },
];

function pickColor() {
  const r = Math.random() * 100;
  let acc = 0;
  for (const p of NODE_PALETTE) {
    acc += p.weight;
    if (r < acc) return p.hex;
  }
  return NODE_PALETTE[0].hex;
}

function isGreen(hex) {
  return hex.toUpperCase().includes("A6") || hex.toUpperCase().includes("2E7D") || hex.toUpperCase().includes("338");
}

function initNodes(count) {
  const nodes = [];
  for (let i = 0; i < count; i++) {
    nodes.push({
      x: Math.random() * 100,
      y: Math.random() * 100,
      vx: (Math.random() - 0.5) * 0.001,
      vy: (Math.random() - 0.5) * 0.001,
      baseRadius: 1 + Math.random() * 2.5,
      pulsePhase: Math.random() * Math.PI * 2,
      pulseSpeed: 0.0001 + Math.random() * 0.00015,
      color: pickColor(),
    });
  }
  return nodes;
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function ConstellationCanvasImpl({ dark = false, clearCenter = false, executiveLight = false, onReady }) {
  const canvasRef = useRef(null);
  const nodesRef = useRef(null);
  const mouseRef = useRef({ x: -1000, y: -1000 });
  const rafRef = useRef(null);
  const lastFrameRef = useRef(0);
  const darkRef = useRef(dark);
  const clearCenterRef = useRef(clearCenter);
  const executiveLightRef = useRef(executiveLight);
  const readyFiredRef = useRef(false);
  const onReadyRef = useRef(onReady);

  // Keep refs in sync without restarting the animation loop
  useEffect(() => { darkRef.current = dark; }, [dark]);
  useEffect(() => { clearCenterRef.current = clearCenter; }, [clearCenter]);
  useEffect(() => { executiveLightRef.current = executiveLight; }, [executiveLight]);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);

  useEffect(() => {
    if (!nodesRef.current) {
      // 32 nodes: cheap O(N²) lines; first painted frame is dots-only before full animation
      nodesRef.current = initNodes(32);
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const ctx = canvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
    });
    let dpr = 1;
    let w = 0, h = 0;
    let frameIdx = 0;
    let pxCoords = null;

    function resize() {
      // 1.25× max: sharp enough on retina, much less fill-rate than 2× for full-viewport canvas
      dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      const rect = canvas.getBoundingClientRect();
      w = Math.floor(rect.width) || canvas.clientWidth;
      h = Math.floor(rect.height) || canvas.clientHeight;
      if (w === 0 || h === 0) return;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function px(percent, dim) {
      return (percent / 100) * (dim === "x" ? w : h);
    }

    function drawNodesOnly(isDark) {
      const nodes = nodesRef.current;
      const execLight = !isDark && executiveLightRef.current;
      if (!pxCoords || pxCoords.length !== nodes.length * 2) {
        pxCoords = new Float32Array(nodes.length * 2);
      }
      for (let i = 0; i < nodes.length; i++) {
        pxCoords[i * 2] = px(nodes[i].x, "x");
        pxCoords[i * 2 + 1] = px(nodes[i].y, "y");
      }
      ctx.globalAlpha = isDark ? 0.9 : execLight ? 0.38 : 0.7;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const rad = n.baseRadius + Math.sin(n.pulsePhase) * 0.1;
        ctx.fillStyle = n.color;
        ctx.beginPath();
        ctx.arc(pxCoords[i * 2], pxCoords[i * 2 + 1], rad, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function animateReduced() {
      if (w === 0 || h === 0) {
        resize();
        rafRef.current = requestAnimationFrame(animateReduced);
        return;
      }
      ctx.clearRect(0, 0, w, h);
      drawNodesOnly(darkRef.current);
      if (!readyFiredRef.current && onReadyRef.current) {
        readyFiredRef.current = true;
        onReadyRef.current();
      }
    }

    function animate(ts) {
      if (w === 0 || h === 0) {
        resize();
        rafRef.current = requestAnimationFrame(animate);
        return;
      }

      const nodes = nodesRef.current;
      const isDark = darkRef.current;

      if (frameIdx === 0) {
        ctx.clearRect(0, 0, w, h);
        drawNodesOnly(isDark);
        if (!readyFiredRef.current && onReadyRef.current) {
          readyFiredRef.current = true;
          onReadyRef.current();
        }
        frameIdx += 1;
        rafRef.current = requestAnimationFrame(animate);
        return;
      }

      if (ts - lastFrameRef.current < 33) {
        rafRef.current = requestAnimationFrame(animate);
        return;
      }
      lastFrameRef.current = ts;

      const mouse = mouseRef.current;
      const centerRadius = clearCenterRef.current ? 32 : 22;
      const cx = 50, cy = 50;

      ctx.clearRect(0, 0, w, h);

      // ── Physics ─────────────────────────────────────────────────────────────
      for (const n of nodes) {
        let fx = 0, fy = 0;

        // Mouse repulsion
        const dx = mouse.x - n.x;
        const dy = mouse.y - n.y;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < 576 && dist2 > 0) { // 24² = 576
          const dist = Math.sqrt(dist2);
          const f = ((24 - dist) / 24) * 1.2;
          fx -= (dx / dist) * f;
          fy -= (dy / dist) * f;
        }

        // Center clearing zone
        const cdx = cx - n.x;
        const cdy = cy - n.y;
        const cdist2 = cdx * cdx + cdy * cdy;
        if (cdist2 < centerRadius * centerRadius && cdist2 > 0) {
          const cdist = Math.sqrt(cdist2);
          const cf = ((centerRadius - cdist) / centerRadius) * 0.5;
          fx += (cdx / cdist) * cf;
          fy += (cdy / cdist) * cf;
        }

        n.vx = Math.max(-0.025, Math.min(0.025, n.vx + fx * 0.015));
        n.vy = Math.max(-0.025, Math.min(0.025, n.vy + fy * 0.015));
        n.x += n.vx;
        n.y += n.vy;

        if (n.x < -2) { n.x = -2; n.vx = Math.abs(n.vx); }
        if (n.x > 102) { n.x = 102; n.vx = -Math.abs(n.vx); }
        if (n.y < -2) { n.y = -2; n.vy = Math.abs(n.vy); }
        if (n.y > 102) { n.y = 102; n.vy = -Math.abs(n.vy); }
      }

      // ── Pre-compute pixel coords (avoid redundant math in inner O(N²) loop) ─
      if (!pxCoords || pxCoords.length !== nodes.length * 2) {
        pxCoords = new Float32Array(nodes.length * 2);
      }
      for (let i = 0; i < nodes.length; i++) {
        pxCoords[i * 2]     = px(nodes[i].x, "x");
        pxCoords[i * 2 + 1] = px(nodes[i].y, "y");
      }

      // ── Lines (O(N²); tighter distance = fewer strokes) ───────────────────
      const maxDistPx = 130;
      const maxDistSq = maxDistPx * maxDistPx;
      const execLight = !isDark && executiveLightRef.current;
      const lineMult = isDark ? 0.30 : execLight ? 0.045 : 0.12;

      ctx.lineWidth = isDark ? 0.5 : execLight ? 0.35 : 0.4;

      // Batch lines by color type to minimize strokeStyle changes
      const linesBlueDark = [], linesGreenDark = [], linesBlueLite = [], linesGreenLite = [];

      for (let i = 0; i < nodes.length; i++) {
        const ax = pxCoords[i * 2], ay = pxCoords[i * 2 + 1];
        for (let j = i + 1; j < nodes.length; j++) {
          const bx = pxCoords[j * 2], by = pxCoords[j * 2 + 1];
          const ddx = bx - ax, ddy = by - ay;
          const distSq = ddx * ddx + ddy * ddy;
          if (distSq < maxDistSq) {
            const dist = Math.sqrt(distSq);
            const opacity = (1 - dist / maxDistPx) * lineMult;
            const useGreen = isGreen(nodes[i].color) || isGreen(nodes[j].color);
            if (isDark) {
              (useGreen ? linesGreenDark : linesBlueDark).push(ax, ay, bx, by, opacity);
            } else {
              (useGreen ? linesGreenLite : linesBlueLite).push(ax, ay, bx, by, opacity);
            }
          }
        }
      }

      function drawBatch(batch, r, g, b) {
        for (let k = 0; k < batch.length; k += 5) {
          ctx.strokeStyle = `rgba(${r},${g},${b},${batch[k + 4].toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(batch[k], batch[k + 1]);
          ctx.lineTo(batch[k + 2], batch[k + 3]);
          ctx.stroke();
        }
      }
      if (isDark) {
        drawBatch(linesBlueDark, 140, 180, 255);
        drawBatch(linesGreenDark, 100, 220, 140);
      } else if (execLight) {
        drawBatch(linesBlueLite, 148, 163, 184);
        drawBatch(linesGreenLite, 148, 163, 184);
      } else {
        drawBatch(linesBlueLite, 0, 51, 160);
        drawBatch(linesGreenLite, 0, 166, 81);
      }

      // ── Nodes ─────────────────────────────────────────────────────────────────
      ctx.globalAlpha = isDark ? 0.9 : execLight ? 0.38 : 0.7;

      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        n.pulsePhase += n.pulseSpeed;
        const r = n.baseRadius + Math.sin(n.pulsePhase) * 0.1;
        const pxVal = pxCoords[i * 2];
        const pyVal = pxCoords[i * 2 + 1];

        // Glow only in dark mode and only for 1-in-3 nodes (perf)
        if (isDark && i % 3 === 0) {
          const grad = ctx.createRadialGradient(pxVal, pyVal, 0, pxVal, pyVal, r * 3);
          const [rr, gg, bb] = hexToRgb(n.color);
          grad.addColorStop(0, `rgba(${rr},${gg},${bb},0.18)`);
          grad.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(pxVal, pyVal, r * 3, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = n.color;
        ctx.beginPath();
        ctx.arc(pxVal, pyVal, r, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;

      frameIdx += 1;
      rafRef.current = requestAnimationFrame(animate);
    }

    function beginLoop() {
      resize();
      if (reduceMotion) {
        rafRef.current = requestAnimationFrame(animateReduced);
        return;
      }
      rafRef.current = requestAnimationFrame(animate);
    }

    resize();
    window.addEventListener("resize", resize);

    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top  && e.clientY <= rect.bottom) {
        mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 100;
        mouseRef.current.y = ((e.clientY - rect.top)  / rect.height) * 100;
      } else {
        mouseRef.current.x = -1000;
        mouseRef.current.y = -1000;
      }
    };

    const handleMouseLeave = () => {
      mouseRef.current.x = -1000;
      mouseRef.current.y = -1000;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.body.addEventListener("mouseleave", handleMouseLeave);

    // Defer animation until main thread is idle so JSON parse / React commit win the race
    let idleId = null;
    let fallbackTimer = null;
    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(() => {
        idleId = null;
        beginLoop();
      }, { timeout: 500 });
    } else {
      fallbackTimer = window.setTimeout(beginLoop, 48);
    }

    return () => {
      if (idleId != null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      clearTimeout(fallbackTimer);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      document.removeEventListener("mousemove", handleMouseMove);
      document.body.removeEventListener("mouseleave", handleMouseLeave);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only start once; dark/clearCenter/onReady read via refs inside the loop

  return (
    <>
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 0,
          background: dark
            ? "linear-gradient(160deg, #070b14 0%, #0a1628 40%, #0b1a12 100%)"
            : executiveLight
              ? "linear-gradient(175deg, rgb(243, 244, 245) 0%, rgb(236, 238, 237) 45%, rgb(232, 233, 234) 100%)"
              : "linear-gradient(160deg, #f8faff 0%, #f0f4fa 40%, #eef6f0 100%)",
          transition: "background 0.5s ease",
        }}
      />
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          zIndex: 0,
          pointerEvents: "none",
          display: "block",
        }}
      />
    </>
  );
}
