"use client";

/**
 * A field of drifting particles behind the agent flow, drawn with Three.js.
 * It takes the colour of whichever agent is at work and speeds up while the
 * council is busy; a handoff sends a short burst through the field. It is
 * decoration: it never blocks input, respects prefers-reduced-motion and stops
 * rendering when the tab is hidden.
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import gsap from "gsap";

const PARTICLES = 160;
const DRIFT = 0.0006;
const SPREAD = { x: 9, y: 3.2, z: 3 };
const SIZE = { rest: 0.045, burst: 0.12 };
const SPEED = { idle: 0.35, busy: 1 };
const DEFAULT_ACCENT = "#7c6cf0";

interface Scene {
  material: THREE.PointsMaterial;
  /** Tweened by GSAP; read every frame. */
  motion: { speed: number; size: number };
}

export interface AmbientCanvasProps {
  active: boolean;
  /** Hex colour of the agent at work; the particles drift toward it. */
  accent?: string | undefined;
  className?: string;
}

export function AmbientCanvas({ active, accent = DEFAULT_ACCENT, className }: AmbientCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<Scene | null>(null);

  // The scene is built once; props only tween what is already there.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);

    const world = new THREE.Scene();
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
    const material = new THREE.PointsMaterial({
      color: new THREE.Color(DEFAULT_ACCENT),
      size: SIZE.rest,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });
    const points = new THREE.Points(geometry, material);
    world.add(points);
    const motion = { speed: SPEED.idle, size: SIZE.rest };
    scene.current = { material, motion };

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
      const pos = geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < PARTICLES; i++) {
        let y = pos.getY(i) + DRIFT * dt * speeds[i]! * motion.speed;
        if (y > SPREAD.y / 2) y = -SPREAD.y / 2;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
      material.size = motion.size;
      points.rotation.y += 0.00004 * dt * motion.speed;
      renderer.render(world, camera);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      gsap.killTweensOf(motion);
      gsap.killTweensOf(material.color);
      scene.current = null;
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  // Busy or idle: the drift speed eases between the two.
  useEffect(() => {
    const current = scene.current;
    if (!current) return;
    gsap.to(current.motion, { speed: active ? SPEED.busy : SPEED.idle, duration: 1.2, ease: "power2.out" });
  }, [active]);

  // A new agent takes over: the field drifts to its colour and pulses once.
  useEffect(() => {
    const current = scene.current;
    if (!current) return;
    const target = new THREE.Color(accent);
    gsap.to(current.material.color, { r: target.r, g: target.g, b: target.b, duration: 1, ease: "power2.inOut" });
    gsap.fromTo(current.motion, { size: SIZE.burst }, { size: SIZE.rest, duration: 1.4, ease: "expo.out" });
  }, [accent]);

  return <div ref={host} aria-hidden className={className} />;
}

export default AmbientCanvas;
