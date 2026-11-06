'use client';

import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

type RobotState = 'idle' | 'thinking' | 'happy';
type Gesture = 'idle' | 'greeting' | 'playful' | 'curious' | 'celebrating';

export function RobotAssistant({
  state,
  onClick,
  disabled,
  label: customLabel,
  expanded,
  fullSize = false,
  draggable = false,
  visuallyHidden = false,
}: {
  state: RobotState;
  onClick: () => void;
  disabled: boolean;
  label?: string;
  expanded?: boolean;
  fullSize?: boolean;
  draggable?: boolean;
  visuallyHidden?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number; startX: number; startY: number } | null>(null);
  const suppressClickRef = useRef(false);
  const stateRef = useRef(state);
  const [gesture, setGesture] = useState<Gesture>('idle');
  const gestureRef = useRef(gesture);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [inView, setInView] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    gestureRef.current = gesture;
  }, [gesture]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (state !== 'idle') return;
    const actions: Gesture[] = ['greeting', 'playful', 'curious', 'celebrating'];
    let actionIndex = 0;
    let settleTimer: number | undefined;
    const interval = window.setInterval(() => {
      const action = actions[actionIndex++ % actions.length];
      setGesture(action);
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        setGesture((current) => current === action ? 'idle' : current);
      }, 2600);
    }, 5000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(settleTimer);
    };
  }, [state]);

  useEffect(() => {
    if (gesture !== 'greeting') return;
    const timer = window.setTimeout(() => setGesture('idle'), 2600);
    return () => window.clearTimeout(timer);
  }, [gesture]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin: '80px' });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!draggable) return;
    const button = buttonRef.current;
    if (!button) return;
    const placeOrClamp = () => {
      const { width, height } = button.getBoundingClientRect();
      setPosition((current) => ({
        x: Math.max(0, Math.min(current?.x ?? window.innerWidth - width - 16, window.innerWidth - width)),
        y: Math.max(0, Math.min(current?.y ?? window.innerHeight - height - 16, window.innerHeight - height)),
      }));
    };
    const observer = new ResizeObserver(placeOrClamp);
    observer.observe(button);
    window.addEventListener('resize', placeOrClamp);
    placeOrClamp();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', placeOrClamp);
    };
  }, [draggable]);

  useEffect(() => {
    if (!inView) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch (reason) {
      console.error('Could not initialize the AI robot WebGL viewer.', reason);
      window.requestAnimationFrame(() => setFailed(true));
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 50);
    camera.position.set(0, 0.12, fullSize ? 2.8 : 2.15);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0xe5f2ff, 0x27334c, 2.1));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(-2, 3, 4);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x83aaff, 1.3);
    fillLight.position.set(2, 0, 3);
    scene.add(fillLight);

    const robot = new THREE.Group();
    const modelPosition = new THREE.Group();
    robot.add(modelPosition);
    scene.add(robot);
    let head: THREE.Object3D | undefined;
    let leftArm: THREE.Object3D | undefined;
    let rightArm: THREE.Object3D | undefined;
    let leftWheel: THREE.Object3D | undefined;
    let rightWheel: THREE.Object3D | undefined;
    const baseRotation = new Map<string, THREE.Euler>();
    let animationFrame = 0;
    let disposed = false;

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const loader = new GLTFLoader();
    loader.load('/orbit-ai/scene.gltf', (gltf) => {
      if (disposed) return;
      const model = gltf.scene;
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const scale = 1.5 / Math.max(size.x, size.y, size.z);
      model.scale.setScalar(scale);
      model.position.copy(center).multiplyScalar(-scale);
      modelPosition.add(model);
      head = model.getObjectByName('Head');
      leftArm = model.getObjectByName('LeftArm');
      rightArm = model.getObjectByName('RightArm');
      leftWheel = model.getObjectByName('LeftWheel');
      rightWheel = model.getObjectByName('RightWheel');
      for (const [name, object] of [
        ['head', head],
        ['leftArm', leftArm],
        ['rightArm', rightArm],
        ['leftWheel', leftWheel],
        ['rightWheel', rightWheel],
      ] as const) {
        if (object) baseRotation.set(name, object.rotation.clone());
      }
    }, undefined, (reason) => {
      if (disposed) return;
      console.error('Could not load the AI robot GLTF model.', reason);
      setFailed(true);
    });

    const clock = new THREE.Clock();
    const animate = () => {
      if (disposed) return;
      animationFrame = window.requestAnimationFrame(animate);
      const time = clock.getElapsedTime();
      const motion: RobotState | Gesture = stateRef.current === 'idle' ? gestureRef.current : stateRef.current;
      const idleSway = Math.sin(time * 1.35);

      robot.position.y = Math.sin(time * 2.1) * 0.025;
      robot.rotation.y = Math.sin(time * 0.65) * 0.055;
      if (head) {
        const base = baseRotation.get('head');
        head.rotation.set(
          (base?.x ?? 0) + (motion === 'thinking' ? Math.sin(time * 2) * 0.13 : motion === 'curious' ? Math.sin(time * 1.8) * 0.12 : 0),
          base?.y ?? 0,
          (base?.z ?? 0) + Math.sin(time * (motion === 'thinking' ? 2.7 : motion === 'curious' ? 1.8 : 1.1)) * (motion === 'thinking' ? 0.12 : motion === 'curious' ? 0.18 : 0.035),
        );
      }

      const greeting = motion === 'greeting';
      const happy = motion === 'happy' || motion === 'celebrating';
      const playful = motion === 'playful';
      const thinking = motion === 'thinking';
      const left = baseRotation.get('leftArm');
      const right = baseRotation.get('rightArm');
      if (leftArm && left) {
        leftArm.rotation.set(
          left.x,
          left.y + (greeting ? Math.sin(time * 8) * 0.65 : happy ? -0.55 : playful ? Math.sin(time * 4) * 0.4 : idleSway * 0.035),
          left.z + (greeting ? -0.45 : happy ? -0.34 : 0),
        );
      }
      if (rightArm && right) {
        rightArm.rotation.set(
          right.x,
          right.y + (greeting ? 0.55 : happy ? -0.55 : playful ? Math.sin(time * 4 + 1) * 0.4 : idleSway * 0.035),
          right.z + (greeting ? 0.4 : happy ? 0.34 : 0),
        );
      }
      const wheelSpeed = playful ? 8 : thinking ? 0.6 : 0.18;
      for (const [name, wheel] of [['leftWheel', leftWheel], ['rightWheel', rightWheel]] as const) {
        if (!wheel) continue;
        const base = baseRotation.get(name);
        wheel.rotation.set((base?.x ?? 0) + time * wheelSpeed, base?.y ?? 0, base?.z ?? 0);
      }
      if (happy) robot.position.y += Math.abs(Math.sin(time * 9)) * 0.12;
      if (playful) robot.position.x = Math.sin(time * 7) * 0.055;
      else robot.position.x = 0;

      renderer.render(scene, camera);
    };
    animationFrame = window.requestAnimationFrame(animate);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      renderer.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
    };
  }, [fullSize, inView]);

  const mood = state === 'idle' ? gesture : state;
  const label = customLabel ?? (state === 'thinking' ? 'AI assistant is thinking'
    : state === 'happy' ? 'Follow-up message ready'
      : 'Open AI assistant');
  const buttonStyle = draggable ? {
    left: position?.x ?? 0,
    top: position?.y ?? 0,
    visibility: position ? 'visible' as const : 'hidden' as const,
  } : undefined;

  function moveTo(x: number, y: number) {
    const button = buttonRef.current;
    if (!button) return;
    const { width, height } = button.getBoundingClientRect();
    setPosition({
      x: Math.max(0, Math.min(x, window.innerWidth - width)),
      y: Math.max(0, Math.min(y, window.innerHeight - height)),
    });
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`crm-robot-button crm-robot-${mood}${draggable ? ' crm-robot-draggable' : ''}${visuallyHidden ? ' crm-robot-launcher-hidden' : ''}`}
      style={buttonStyle}
      onClick={() => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        onClick();
      }}
      onPointerDown={(event) => {
        if (!draggable || event.button !== 0) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        dragRef.current = {
          pointerId: event.pointerId,
          offsetX: event.clientX - bounds.left,
          offsetY: event.clientY - bounds.top,
          startX: event.clientX,
          startY: event.clientY,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!draggable || !drag || drag.pointerId !== event.pointerId) return;
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) {
          suppressClickRef.current = true;
          moveTo(event.clientX - drag.offsetX, event.clientY - drag.offsetY);
        }
      }}
      onPointerUp={(event) => {
        if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
      }}
      onPointerCancel={() => { dragRef.current = null; }}
      onKeyDown={(event) => {
        if (!draggable || !position || !event.key.startsWith('Arrow')) return;
        const distance = event.shiftKey ? 40 : 16;
        const offsets = {
          ArrowUp: [0, -distance],
          ArrowDown: [0, distance],
          ArrowLeft: [-distance, 0],
          ArrowRight: [distance, 0],
        } as const;
        const offset = offsets[event.key as keyof typeof offsets];
        if (!offset) return;
        event.preventDefault();
        moveTo(position.x + offset[0], position.y + offset[1]);
      }}
      onPointerEnter={() => { if (state === 'idle') setGesture('greeting'); }}
      onFocus={() => { if (state === 'idle') setGesture('greeting'); }}
      aria-label={label}
      aria-expanded={expanded}
      aria-keyshortcuts={draggable ? 'ArrowUp ArrowDown ArrowLeft ArrowRight' : undefined}
      aria-hidden={visuallyHidden || undefined}
      tabIndex={visuallyHidden ? -1 : undefined}
      title={label}
      disabled={disabled}
    >
      <canvas ref={canvasRef} aria-hidden="true" />
      {failed && <span className="crm-robot-fallback"><Sparkles size={22} /></span>}
      {state === 'thinking' && <span className="crm-robot-status">Thinking</span>}
      {state === 'happy' && <span className="crm-robot-status">Ready!</span>}
      <span className="sr-only">{label}</span>
    </button>
  );
}
