"use client";

/**
 * A quiet field of drifting particles behind the agent flow, drawn with
 * Three.js. It is decoration: it never blocks input, it respects
 * prefers-reduced-motion, and it stops rendering when the tab is hidden.
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";

const PARTICLES = 140;
const DRIFT = 0.0006;
const SPREAD = { x: 9, y: 3.2, z: 3 };

export function AmbientCanvas({ active, className }: { active: boolean; className?: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.z = 8;

    const positions = new Float32Array(PARTICLES * 3);
    const speeds = new Float32Array(PARTICLES);
    for (let i = 0; i < PARTICLES; i++) {
      positions[i * 3] = (Math.random() - 0.5) * SPREAD.x;
      positions[i * 3 + 1] = (Math.random() - 0.5) * SPREAD.y;
      positions[i * 3 + 2] = (Math.random() - 0.5) * SPREAD.z;
      speeds[i] = 0.5 + Math.random();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0x7c6cf0, size: 0.045, transparent: true, opacity: 0.55, depthWrite: false });
    const points = new THREE.Points(geometry, material);
    scene.add(points);

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);

    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (document.hidden) return;
      const dt = Math.min(50, now - last);
      last = now;
      const speed = active ? 1 : 0.35;
      const pos = geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < PARTICLES; i++) {
        let y = pos.getY(i) + DRIFT * dt * speeds[i]! * speed;
        if (y > SPREAD.y / 2) y = -SPREAD.y / 2;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
      points.rotation.y += 0.00004 * dt * speed;
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [active]);

  return <div ref={host} aria-hidden className={className} />;
}

export default AmbientCanvas;
