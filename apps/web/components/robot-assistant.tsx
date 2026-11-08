'use client';

import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Orbit robot animation states.
 *
 * `idle` = breathing, sway, auto-blink, and an auto-cycle of one-shot gestures.
 * One-shot actions play once and ease back to the initial pose. Set `state`
 * to `idle` before triggering the same action again.
 */
export type RobotState =
  | 'idle'
  | 'blinking'
  | 'waving'
  | 'thinking'
  | 'happy'
  | 'jumping'
  | 'dancing'
  | 'confused'
  | 'sleeping'
  | 'celebrating'
  | 'backHand'
  | 'listening';

const AUTO_ACTIONS = [
  'waving', 'happy', 'jumping', 'dancing', 'confused', 'celebrating', 'backHand',
] as const;
type Gesture = 'idle' | (typeof AUTO_ACTIONS)[number];

/**
 * Action list for a picker UI. `ms` is how long to keep the state before
 * returning the robot to `idle` (one-shots finish on their own).
 */
export const ROBOT_ACTIONS: { state: RobotState; label: string; emoji: string; ms: number }[] = [
  { state: 'waving', label: 'Wave', emoji: '👋', ms: 2500 },
  { state: 'happy', label: 'Happy', emoji: '😄', ms: 2500 },
  { state: 'jumping', label: 'Jump', emoji: '🤸', ms: 1900 },
  { state: 'dancing', label: 'Dance', emoji: '💃', ms: 4000 },
  { state: 'confused', label: 'Confused', emoji: '😕', ms: 2500 },
  { state: 'celebrating', label: 'Celebrate', emoji: '🎉', ms: 3000 },
  { state: 'backHand', label: 'Hands back', emoji: '🤫', ms: 3600 },
  { state: 'thinking', label: 'Think', emoji: '🤔', ms: 3500 },
  { state: 'listening', label: 'Listen', emoji: '👂', ms: 4000 },
  { state: 'sleeping', label: 'Sleep', emoji: '😴', ms: 4000 },
];

/** How far the robot turns while listening. Negative = screen left, positive = right. */
const LISTEN_TURN = -0.35;

/** One-shot durations in seconds. */
const ONE_SHOT_DURATION: Record<string, number> = {
  waving: 2.3,
  happy: 2.3,
  jumping: 1.65,
  dancing: 3.8,
  confused: 2.3,
  celebrating: 2.8,
  backHand: 3.4,
};

/* ------------------------------------------------------------------ */
/* TUNING                                                              */
/* All limb motion is defined in ROBOT space (x right, y up, z toward  */
/* the camera), so the FBX/Sketchfab node rotations no longer matter.  */
/* ------------------------------------------------------------------ */
const DEBUG_LOG_NODES = false;
/** Set to -1 if "forward" arm swings go backward on your model. */
const FORWARD_SIGN = 1;
const SMOOTHING = 14; // higher = snappier, lower = softer blending
/** Master strength for wheel/leg stretching and hand/finger flex (0 = off). */
const WHEEL_STRETCH = 1;
const HAND_FLEX = 1;

const clamp01 = (v: number) => THREE.MathUtils.clamp(v, 0, 1);
const smooth01 = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};
/** Ease in, hold, ease out. 0 -> 1 -> 0 across the action. */
const env = (t: number, dur: number, inT = 0.35, outT = 0.45) =>
  smooth01(t / inT) * (1 - smooth01((t - (dur - outT)) / outT));

/* ------------------------------------------------------------------ */
/* Pose model: every action returns a target pose, then it is damped.  */
/*   hx nod down(+)  hy turn  hz tilt                                  */
/*   lf/rf arm swing forward(+) / backward(-)                          */
/*   lo/ro arm raised outward(+) / inward(-), radians from hanging     */
/*   lh/rh hand flap, lfi/rfi finger curl                              */
/*   wsp wheels spread outward, wsplay wheels kick out like legs,      */
/*   wlL/wlR wheel lift                                                */
/* ------------------------------------------------------------------ */
type Pose = {
  px: number; py: number; pz: number;
  brx: number; bry: number; brz: number;
  sx: number; sy: number;
  hx: number; hy: number; hz: number;
  lf: number; lo: number; rf: number; ro: number;
  lh: number; rh: number; lfi: number; rfi: number;
  wsp: number; wsplay: number; wlL: number; wlR: number;
  wheel: number;
  ant: number;
  spin: number; // extra body yaw, applied raw so 2π returns cleanly
};

const POSE_KEYS = [
  'px', 'py', 'pz', 'brx', 'bry', 'brz', 'sx', 'sy', 'hx', 'hy', 'hz',
  'lf', 'lo', 'rf', 'ro', 'lh', 'rh', 'lfi', 'rfi',
  'wsp', 'wsplay', 'wlL', 'wlR', 'wheel', 'ant',
] as const;

const neutralPose = (): Pose => ({
  px: 0, py: 0, pz: 0, brx: 0, bry: 0, brz: 0, sx: 1, sy: 1,
  hx: 0, hy: 0, hz: 0, lf: 0, lo: 0, rf: 0, ro: 0,
  lh: 0, rh: 0, lfi: 0, rfi: 0,
  wsp: 0, wsplay: 0, wlL: 0, wlR: 0, wheel: 0, ant: 0, spin: 0,
});

const both = (p: Pose, fwd: number, out: number) => {
  p.lf = fwd; p.rf = fwd; p.lo = out; p.ro = out;
};

function computePose(action: string, t: number, time: number): Pose {
  const p = neutralPose();

  // Base life: breathing + soft sway + tiny arm/hand/antenna drift (always on).
  const breath = action === 'sleeping' ? Math.sin(time * 0.85) * 0.009 : Math.sin(time * 1.65) * 0.006;
  p.sy = 1 + breath;
  p.sx = 1 - breath * 0.35;
  p.py = Math.sin(time * 1.8) * 0.009;
  p.bry = Math.sin(time * 0.55) * 0.025;
  p.hz = Math.sin(time * 0.8) * 0.012;
  both(p, Math.sin(time * 1.1) * 0.03, 0.05 + Math.sin(time * 1.25) * 0.03);
  p.lh = Math.sin(time * 1.7) * 0.05;
  p.rh = Math.sin(time * 1.7 + 1) * 0.05;
  p.lfi = Math.sin(time * 2) * 0.06;
  p.rfi = Math.sin(time * 2 + 1.5) * 0.06;
  p.ant = Math.sin(time * 1.4) * 0.05;

  switch (action) {
    case 'waving': {
      const e = env(t, 2.3, 0.3, 0.4);
      p.lo = 0.05 + 2.0 * e + Math.sin(t * 11) * 0.3 * e;
      p.lf = 0.15 * e;
      p.lh = Math.sin(t * 11 + 0.8) * 0.5 * e; // wrist wiggle
      p.lfi = Math.sin(t * 11) * 0.3 * e;
      p.hz += -0.08 * e + Math.sin(t * 5.5) * 0.03 * e;
      p.hy = 0.15 * e;
      p.brz = -0.03 * e;
      p.bry += 0.1 * e;
      p.ant += Math.sin(t * 8) * 0.1 * e;
      break;
    }

    case 'happy': {
      const e = env(t, 2.3, 0.25, 0.45);
      const b = Math.abs(Math.sin(t * 7)) * e;
      p.py += b * 0.075;
      both(p, 0.15 * e, 1.0 * e + b * 0.35);
      p.lh = Math.sin(t * 9) * 0.4 * e;
      p.rh = -Math.sin(t * 9) * 0.4 * e;
      p.wsp = 0.02 * b;
      p.wsplay = 0.18 * b;
      p.hx = -0.1 * e;
      p.hz += Math.sin(t * 7) * 0.05 * e;
      p.ant += Math.sin(t * 9) * 0.2 * e;
      p.sy *= 1 + b * 0.015;
      break;
    }

    case 'jumping': {
      if (t < 0.3) {
        // anticipation crouch, arms pulled back
        const k = smooth01(t / 0.3);
        p.py += -0.03 * k;
        p.sy *= 1 - 0.08 * k;
        p.sx *= 1 + 0.05 * k;
        both(p, -0.5 * k, 0.15 * k);
        p.hx = 0.1 * k;
        p.wsp = -0.01 * k;
      } else if (t < 1.1) {
        // airtime: star-jump, arms flung up, wheels kicked out like legs
        const u = (t - 0.3) / 0.8;
        const s = Math.sin(Math.PI * u);
        const hold = smooth01(u / 0.22) * (1 - smooth01((u - 0.72) / 0.28)); // holds the pose
        p.py += 0.28 * s;
        p.sy *= 1 + 0.05 * s;
        p.sx *= 1 - 0.025 * s;
        both(p, 0.15 * hold, 2.3 * hold);
        p.lh = Math.sin(t * 16) * 0.35 * hold + 0.25 * hold; // hands open and flutter
        p.rh = -Math.sin(t * 16) * 0.35 * hold + 0.25 * hold;
        p.lfi = 0.4 * hold + Math.sin(t * 18) * 0.15 * hold;
        p.rfi = 0.4 * hold + Math.sin(t * 18 + 1) * 0.15 * hold;
        p.wsp = 0.05 * hold;
        p.wsplay = 0.8 * hold;
        p.wlL = 0.04 * hold;
        p.wlR = 0.04 * hold;
        p.wheel = Math.sin(t * 8) * 0.25 * hold;
        p.hx = -0.22 * hold;
        p.hz += Math.sin(t * 9) * 0.04 * hold;
        p.brx = -0.05 * hold; // slight chest-up arch
        p.ant += Math.sin(t * 14) * 0.2 * s;
      } else {
        // landing: limbs rejoin, squash and recover
        const u = (t - 1.1) / 0.55;
        const s = u < 0.45 ? Math.sin((Math.PI * u) / 0.45) : 0;
        p.py += -0.025 * s;
        p.sy *= 1 - 0.09 * s;
        p.sx *= 1 + 0.06 * s;
        both(p, 0, 0.4 * s);
        p.lh = 0.2 * s;
        p.rh = -0.2 * s;
        p.wsplay = 0.12 * s;
        p.ant += Math.sin(t * 18) * 0.15 * (1 - smooth01(u));
      }
      break;
    }

    case 'dancing': {
      const e = env(t, 3.8, 0.4, 0.5);
      const w = t * Math.PI * 2 * 1.7;
      const s = Math.sin(w);
      const c = Math.cos(w);
      p.px = s * 0.05 * e;
      p.py += Math.abs(s) * 0.04 * e;
      p.brz = s * 0.08 * e;
      p.bry += c * 0.15 * e;
      p.hz += -s * 0.1 * e;
      p.hy = c * 0.12 * e;
      p.hx = Math.abs(c) * 0.06 * e;
      p.lo = (0.9 + 0.7 * s) * e;
      p.lf = 0.35 * c * e;
      p.ro = (0.9 - 0.7 * s) * e;
      p.rf = -0.35 * c * e;
      p.lh = Math.sin(w * 2) * 0.5 * e;
      p.rh = -Math.sin(w * 2) * 0.5 * e;
      p.wheel = s * 0.3 * e;
      p.wlL = Math.max(0, s) * 0.04 * e; // alternate "foot taps"
      p.wlR = Math.max(0, -s) * 0.04 * e;
      p.wsplay = (0.1 + 0.18 * Math.abs(c)) * e;
      p.ant += Math.sin(w * 2) * 0.2 * e;
      break;
    }

    case 'confused': {
      const e = env(t, 2.3, 0.35, 0.45);
      const settle = smooth01((t - 1.0) / 0.4);
      p.hy = Math.sin(t * 6) * 0.22 * e * (1 - settle);
      p.hz += 0.2 * e * settle;
      p.hx = -0.05 * e;
      p.lf = 1.9 * e + Math.sin(t * 8) * 0.07 * e * settle;
      p.lo = -0.1 * e;
      p.lfi = Math.sin(t * 8) * 0.35 * e * settle; // scratching fingers
      p.ro = 0.35 * e;
      p.brz = -0.02 * e;
      p.pz = -0.02 * e;
      p.ant += Math.sin(t * 7) * 0.12 * e;
      break;
    }

    case 'celebrating': {
      const e = env(t, 2.8, 0.3, 0.5);
      const b = Math.abs(Math.sin(t * 8.5)) * e;
      p.py += b * 0.12;
      both(p, 0, 2.5 * e + Math.sin(t * 9) * 0.15 * e);
      p.lh = Math.sin(t * 14) * 0.5 * e;
      p.rh = -Math.sin(t * 14) * 0.5 * e;
      p.lfi = 0.4 * e + Math.sin(t * 16) * 0.2 * e;
      p.rfi = 0.4 * e + Math.sin(t * 16 + 1) * 0.2 * e;
      p.wsp = 0.04 * e + b * 0.02;
      p.wsplay = 0.45 * e + b * 0.2;
      p.wlL = 0.02 * e;
      p.wlR = 0.02 * e;
      p.brz = Math.sin(t * 8.5) * 0.035 * e;
      p.hx = -0.1 * e;
      p.wheel = Math.sin(t * 8) * 0.2 * e;
      p.ant += Math.sin(t * 9) * 0.22 * e;
      p.spin = Math.PI * 2 * smooth01((t - 0.5) / 1.3);
      break;
    }

    case 'thinking': {
      const e = smooth01(t / 0.5);
      p.hz += 0.11 * e + Math.sin(time * 1.25) * 0.035 * e;
      p.hx = 0.04 * e + Math.sin(time * 1.8) * 0.05 * e;
      p.hy = -0.12 * e;
      p.rf = 1.7 * e;
      p.ro = -0.35 * e;
      p.rh = 0.3 * e;
      p.rfi = 0.5 * e + Math.sin(time * 3) * 0.1 * e; // fingers tapping the chin
      p.wheel = Math.sin(time * 1.1) * 0.025 * e;
      p.ant += Math.sin(time * 3) * 0.12 * e;
      break;
    }

    case 'sleeping': {
      const e = smooth01(t / 1.2);
      p.hx = 0.35 * e + Math.sin(time * 0.85) * 0.02 * e;
      p.hz += 0.04 * e;
      p.py += -0.02 * e - Math.abs(Math.sin(time * 0.85)) * 0.008 * e;
      both(p, 0, 0.02);
      p.ant += -0.15 * e;
      break;
    }

    case 'listening': {
      // Turns slightly left, right hand cupped at the ear, attentively listening.
      const e = smooth01(t / 0.6);
      p.bry += LISTEN_TURN * e; // body turns
      p.hy = LISTEN_TURN * 0.7 * e; // head follows the turn
      p.hx = -0.1 * e; // looks slightly up, like the photo
      p.hz += 0.12 * e + Math.sin(time * 1.3) * 0.025 * e; // tilts toward the ear
      p.brz = 0.025 * e;
      p.rf = 0.25 * e; // right arm up beside the head
      p.ro = 2.4 * e + Math.sin(time * 1.6) * 0.04 * e;
      p.rh = 0.7 * e + Math.sin(time * 1.6 + 1) * 0.08 * e; // hand cups toward the ear
      p.rfi = 0.35 * e + Math.sin(time * 1.6) * 0.06 * e;
      p.lo = 0.05 + 0.04 * e; // other arm relaxed
      p.ant += Math.sin(time * 2) * 0.12 * e; // antenna perks up
      break;
    }

    case 'backHand': {
      const e = env(t, 3.4, 0.5, 0.5);
      p.rf = -0.85 * e + Math.sin(t * 9) * 0.1 * e;
      p.ro = 0.05 - 0.3 * e;
      p.rh = Math.sin(t * 9 + 1) * 0.3 * e;
      p.rfi = Math.sin(t * 12) * 0.3 * e;
      p.lo += 0.05 * e;
      p.hx = -0.08 * e;
      p.hz += 0.14 * e + Math.sin(t * 3) * 0.03 * e;
      p.bry += Math.sin(t * 2.2) * 0.12 * e;
      p.brz = Math.sin(t * 3) * 0.03 * e;
      p.ant += Math.sin(t * 4) * 0.08 * e;
      break;
    }

    default:
      break; // idle
  }

  return p;
}

/* ------------------------------------------------------------------ */
/* Rig helpers: rotate / move a node in ROBOT space, regardless of its */
/* local axis orientation, optionally about a pivot point.             */
/* ------------------------------------------------------------------ */
type Vec3 = [number, number, number];

type Rig = {
  obj: THREE.Object3D;
  baseQ: THREE.Quaternion;
  basePos: THREE.Vector3;
  pq: THREE.Quaternion;
  pqInv: THREE.Quaternion;
  pInv3: THREE.Matrix3;
  w0: THREE.Vector3; // rest world position
  side: number; // +1 if on the screen-right side of the robot, -1 if left
};

const _euler = new THREE.Euler();
const _qRot = new THREE.Quaternion();
const _qIn = new THREE.Quaternion();
const _qOut = new THREE.Quaternion();
const _total = new THREE.Quaternion();
const _w = new THREE.Vector3();
const _move = new THREE.Vector3();

function makeRig(obj: THREE.Object3D | undefined, sideFrom?: THREE.Object3D): Rig | undefined {
  if (!obj) return undefined;
  const pq = new THREE.Quaternion();
  obj.parent?.getWorldQuaternion(pq);
  const pInv3 = new THREE.Matrix3();
  if (obj.parent) pInv3.setFromMatrix4(obj.parent.matrixWorld).invert();
  const box = new THREE.Box3().setFromObject(sideFrom ?? obj);
  const side = Math.sign(box.getCenter(new THREE.Vector3()).x) || 1;
  return {
    obj,
    baseQ: obj.quaternion.clone(),
    basePos: obj.position.clone(),
    pq,
    pqInv: pq.clone().invert(),
    pInv3,
    w0: obj.getWorldPosition(new THREE.Vector3()),
    side,
  };
}

type Stage = { r: Vec3; p: THREE.Vector3 };

/**
 * rot   = spin about the node's own origin (robot axes)
 * inner = rotation about a pivot, applied first
 * outer = rotation about a pivot, applied second
 * move  = translation in robot space
 */
function applyRig(
  rig: Rig | undefined,
  o: { rot?: Vec3; inner?: Stage; outer?: Stage; move?: Vec3 },
) {
  if (!rig) return;
  _qRot.identity();
  _qIn.identity();
  _qOut.identity();
  if (o.rot) _qRot.setFromEuler(_euler.set(o.rot[0], o.rot[1], o.rot[2], 'XYZ'));
  if (o.inner) _qIn.setFromEuler(_euler.set(o.inner.r[0], o.inner.r[1], o.inner.r[2], 'XYZ'));
  if (o.outer) _qOut.setFromEuler(_euler.set(o.outer.r[0], o.outer.r[1], o.outer.r[2], 'XYZ'));

  _total.copy(_qOut).multiply(_qIn).multiply(_qRot);
  rig.obj.quaternion.copy(rig.pqInv).multiply(_total).multiply(rig.pq).multiply(rig.baseQ);

  _w.copy(rig.w0);
  if (o.inner) _w.sub(o.inner.p).applyQuaternion(_qIn).add(o.inner.p);
  if (o.outer) _w.sub(o.outer.p).applyQuaternion(_qOut).add(o.outer.p);
  _move.copy(_w).sub(rig.w0);
  if (o.move) _move.add(new THREE.Vector3(o.move[0], o.move[1], o.move[2]));
  rig.obj.position.copy(rig.basePos).add(_move.applyMatrix3(rig.pInv3));
}

const applyRot = (rig: Rig | undefined, rx: number, ry: number, rz: number) =>
  applyRig(rig, { rot: [rx, ry, rz] });

/** End of `from` that faces `to` (e.g. the wrist, where forearm meets hand). */
function boundaryPoint(from: THREE.Object3D, to: THREE.Object3D) {
  const bf = new THREE.Box3().setFromObject(from);
  const bt = new THREE.Box3().setFromObject(to);
  const f = bf.getCenter(new THREE.Vector3());
  const d = bt.getCenter(new THREE.Vector3()).sub(f).normalize();
  const s = bf.getSize(new THREE.Vector3());
  const half = (Math.abs(d.x) * s.x + Math.abs(d.y) * s.y + Math.abs(d.z) * s.z) / 2;
  return f.addScaledVector(d, half);
}

type Hand = { hand?: Rig; fingers?: Rig; wrist?: THREE.Vector3; knuckle?: THREE.Vector3; side: number };

function makeHand(model: THREE.Object3D, prefix: 'Left' | 'Right', side: number): Hand {
  const foreArm = model.getObjectByName(`${prefix}Arm_ForeArmMat_0`);
  const handObj = model.getObjectByName(`${prefix}Arm_HandMad_0`);
  const fingerObj = model.getObjectByName(`${prefix}Arm_FingersMAt_0`);
  if (!foreArm || !handObj || !fingerObj) return { side };
  return {
    hand: makeRig(handObj),
    fingers: makeRig(fingerObj),
    wrist: boundaryPoint(foreArm, handObj),
    knuckle: boundaryPoint(handObj, fingerObj),
    side,
  };
}

function applyHand(h: Hand | undefined, flap: number, curl: number) {
  if (!h || !h.hand || !h.fingers || !h.wrist || !h.knuckle) return;
  const wristStage: Stage = { r: [0, 0, h.side * flap], p: h.wrist };
  applyRig(h.hand, { outer: wristStage });
  applyRig(h.fingers, { inner: { r: [-curl, 0, 0], p: h.knuckle }, outer: wristStage });
}

type Eye = {
  obj: THREE.Object3D;
  baseScale: THREE.Vector3;
  basePos: THREE.Vector3;
  baseQ: THREE.Quaternion;
  axis: 'x' | 'y' | 'z'; // local axis that points up in the world
  center: number; // geometry center along that axis
};

function makeEye(obj: THREE.Object3D | undefined): Eye | undefined {
  if (!obj || !(obj as THREE.Mesh).isMesh) return undefined;
  const mesh = obj as THREE.Mesh;
  mesh.geometry.computeBoundingBox();
  const bb = mesh.geometry.boundingBox;
  if (!bb) return undefined;
  const q = new THREE.Quaternion();
  obj.getWorldQuaternion(q);
  const up = new THREE.Vector3(0, 1, 0);
  const axes = {
    x: new THREE.Vector3(1, 0, 0).applyQuaternion(q).dot(up),
    y: new THREE.Vector3(0, 1, 0).applyQuaternion(q).dot(up),
    z: new THREE.Vector3(0, 0, 1).applyQuaternion(q).dot(up),
  };
  const axis = (Object.keys(axes) as Array<'x' | 'y' | 'z'>).sort(
    (a, b) => Math.abs(axes[b]) - Math.abs(axes[a]),
  )[0];
  const center = bb.getCenter(new THREE.Vector3())[axis];
  return {
    obj,
    baseScale: obj.scale.clone(),
    basePos: obj.position.clone(),
    baseQ: obj.quaternion.clone(),
    axis,
    center,
  };
}

function applyBlink(eye: Eye, blink: number) {
  const s = Math.max(0.06, 1 - blink * 0.94);
  const scale = eye.baseScale.clone();
  scale[eye.axis] *= s;
  eye.obj.scale.copy(scale);
  // Keep the eyes centered while they squash.
  const dir = new THREE.Vector3(
    eye.axis === 'x' ? 1 : 0,
    eye.axis === 'y' ? 1 : 0,
    eye.axis === 'z' ? 1 : 0,
  ).applyQuaternion(eye.baseQ);
  const shift = (s - 1) * eye.baseScale[eye.axis] * eye.center;
  eye.obj.position.copy(eye.basePos).addScaledVector(dir, -shift);
}

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
  const dragRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const hitTestRef = useRef<((x: number, y: number) => boolean) | null>(null);
  const onClickRef = useRef(onClick);
  const disabledRef = useRef(disabled);
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
    onClickRef.current = onClick;
    disabledRef.current = disabled;
  }, [onClick, disabled]);

  // Only the robot's own shape is interactive. Everywhere else the button is
  // click-through, so the page behind it keeps working.
  useEffect(() => {
    const button = buttonRef.current;
    if (!button) return;
    button.style.pointerEvents = 'none';

    const onMove = (event: PointerEvent) => {
      if (dragRef.current) return; // keep control while dragging
      const hit = hitTestRef.current?.(event.clientX, event.clientY) ?? false;
      button.style.pointerEvents = hit ? 'auto' : 'none';
    };
    // Touch has no hover, so catch taps on the robot here.
    const onClickCapture = (event: MouseEvent) => {
      if (button.contains(event.target as Node) || disabledRef.current) return;
      if (hitTestRef.current?.(event.clientX, event.clientY)) {
        event.stopPropagation();
        event.preventDefault();
        onClickRef.current();
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('click', onClickCapture, true);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('click', onClickCapture, true);
    };
  }, []);

  // Auto-cycle gestures while idle.
  useEffect(() => {
    if (state !== 'idle') return;
    let actionIndex = 0;
    const interval = window.setInterval(() => {
      setGesture(AUTO_ACTIONS[actionIndex]);
      actionIndex = (actionIndex + 1) % AUTO_ACTIONS.length;
    }, 5000);
    return () => window.clearInterval(interval);
  }, [state]);

  // Return to idle when a gesture finishes.
  useEffect(() => {
    if (gesture === 'idle') return;
    const duration = (ONE_SHOT_DURATION[gesture] ?? 2.3) * 1000 + 100;
    const timer = window.setTimeout(() => {
      setGesture((current) => (current === gesture ? 'idle' : current));
    }, duration);
    return () => window.clearTimeout(timer);
  }, [gesture]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin: '80px' },
    );
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

    let headRig: Rig | undefined;
    let leftArmRig: Rig | undefined;
    let rightArmRig: Rig | undefined;
    let leftWheelRig: Rig | undefined;
    let rightWheelRig: Rig | undefined;
    let antennaRig: Rig | undefined;
    let leftWheelPivot: THREE.Vector3 | undefined;
    let rightWheelPivot: THREE.Vector3 | undefined;
    let leftHand: Hand | undefined;
    let rightHand: Hand | undefined;
    let eye: Eye | undefined;

    let animationFrame = 0;
    let disposed = false;
    let previousAction = '';
    let actionStartedAt = 0;
    let time = 0;
    const current = neutralPose(); // damped, on-screen pose

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    const loader = new GLTFLoader();
    loader.load(
      '/orbit-ai/scene.gltf',
      (gltf) => {
        if (disposed) return;
        const model = gltf.scene;
        const bounds = new THREE.Box3().setFromObject(model);
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        const scale = 1.5 / Math.max(size.x, size.y, size.z);
        model.scale.setScalar(scale);
        model.position.copy(center).multiplyScalar(-scale);
        modelPosition.add(model);
        robot.updateMatrixWorld(true);

        if (DEBUG_LOG_NODES) {
          const names: string[] = [];
          model.traverse((o) => names.push(o.name));
          console.log('GLTF nodes:', names.join(', '));
        }

        // Node names from the Sketchfab "Robotfbx" model.
        headRig = makeRig(model.getObjectByName('Head'));
        leftArmRig = makeRig(model.getObjectByName('LeftArm'));
        rightArmRig = makeRig(model.getObjectByName('RightArm'));
        leftWheelRig = makeRig(model.getObjectByName('LeftWheel'));
        rightWheelRig = makeRig(model.getObjectByName('RightWheel'));
        antennaRig = makeRig(model.getObjectByName('Antenna'));
        eye = makeEye(model.getObjectByName('Head_Eyes_0'));

        // If both arms land on the same side, fall back to left = +1, right = -1.
        if (leftArmRig && rightArmRig && leftArmRig.side === rightArmRig.side) {
          leftArmRig.side = 1;
          rightArmRig.side = -1;
        }
        if (leftWheelRig && rightWheelRig && leftWheelRig.side === rightWheelRig.side) {
          leftWheelRig.side = leftArmRig?.side ?? 1;
          rightWheelRig.side = -(leftArmRig?.side ?? 1);
        }

        // Wheels kick out like legs: pivot near the top of each wheel assembly.
        const hipPivot = (rig?: Rig) => {
          if (!rig) return undefined;
          const box = new THREE.Box3().setFromObject(rig.obj);
          const c = box.getCenter(new THREE.Vector3());
          return new THREE.Vector3(c.x, box.max.y - 0.12 * (box.max.y - box.min.y), c.z);
        };
        leftWheelPivot = hipPivot(leftWheelRig);
        rightWheelPivot = hipPivot(rightWheelRig);

        // Hands: wrist flap + finger curl (mesh parts of each arm).
        leftHand = makeHand(model, 'Left', leftArmRig?.side ?? 1);
        rightHand = makeHand(model, 'Right', rightArmRig?.side ?? -1);
      },
      undefined,
      (reason) => {
        if (disposed) return;
        console.error('Could not load the AI robot GLTF model.', reason);
        setFailed(true);
      },
    );

    // Precise hit test: is this screen point on the robot's actual surface?
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    hitTestRef.current = (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        return false;
      }
      ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      return raycaster.intersectObject(robot, true).length > 0;
    };

    const clock = new THREE.Clock();
    const animate = () => {
      if (disposed) return;
      animationFrame = window.requestAnimationFrame(animate);

      const dt = Math.min(clock.getDelta(), 0.05);
      time += dt;

      const requestedAction: string =
        stateRef.current === 'idle' ? gestureRef.current : stateRef.current;
      const action = requestedAction === 'blinking' ? 'idle' : requestedAction;

      if (action !== previousAction) {
        previousAction = action;
        actionStartedAt = time;
      }
      const actionTime = time - actionStartedAt;
      const oneShotDuration = ONE_SHOT_DURATION[action];
      const activeAction =
        oneShotDuration !== undefined && actionTime > oneShotDuration ? 'idle' : action;

      // Target pose, then damp the on-screen pose toward it. This gives smooth
      // transitions and a clean return to the initial pose after every action.
      const target = computePose(activeAction, actionTime, time);
      const k = 1 - Math.exp(-SMOOTHING * dt);
      for (const key of POSE_KEYS) {
        current[key] += (target[key] - current[key]) * k;
      }

      // Body
      robot.position.set(current.px, current.py, current.pz);
      robot.rotation.set(current.brx, current.bry + target.spin, current.brz);
      robot.scale.set(current.sx, current.sy, current.sx);

      // Head: nod about X, turn about Y, tilt about Z (robot space)
      applyRot(headRig, current.hx, current.hy, current.hz);

      // Arms: swing about X, raise outward about Z (mirrored per side)
      if (leftArmRig) {
        applyRot(leftArmRig, -FORWARD_SIGN * current.lf, 0, leftArmRig.side * current.lo);
      }
      if (rightArmRig) {
        applyRot(rightArmRig, -FORWARD_SIGN * current.rf, 0, rightArmRig.side * current.ro);
      }

      // Wheels: roll about the axle, spread outward, kick out like legs, lift
      const stretch = WHEEL_STRETCH;
      const wheelStage = (rig: Rig | undefined, pivot: THREE.Vector3 | undefined, lift: number) => {
        if (!rig) return;
        applyRig(rig, {
          rot: [current.wheel, 0, 0],
          outer: pivot ? { r: [0, 0, rig.side * current.wsplay * stretch], p: pivot } : undefined,
          move: [rig.side * current.wsp * stretch, lift * stretch, 0],
        });
      };
      wheelStage(leftWheelRig, leftWheelPivot, current.wlL + Math.max(0, current.wsplay) * 0.03);
      wheelStage(rightWheelRig, rightWheelPivot, current.wlR + Math.max(0, current.wsplay) * 0.03);

      // Hands and fingers
      applyHand(leftHand, current.lh * HAND_FLEX, current.lfi * HAND_FLEX);
      applyHand(rightHand, current.rh * HAND_FLEX, current.rfi * HAND_FLEX);

      // Antenna sways about Z
      applyRot(antennaRig, 0, 0, current.ant);

      // Eyes: soft blinks, occasional double blink, closed when sleeping.
      const blinkPhase = time % 4.6;
      let blink = 0;
      if (activeAction === 'sleeping') {
        blink = 1;
      } else if (stateRef.current === 'blinking') {
        blink = Math.max(0, Math.sin(time * 18)) ** 10;
      } else if (blinkPhase < 0.18) {
        blink = Math.sin((blinkPhase / 0.18) * Math.PI);
      } else if (blinkPhase > 0.28 && blinkPhase < 0.42 && Math.floor(time / 4.6) % 3 === 1) {
        blink = Math.sin(((blinkPhase - 0.28) / 0.14) * Math.PI);
      }
      if (eye) applyBlink(eye, blink);

      renderer.render(scene, camera);
    };

    animationFrame = window.requestAnimationFrame(animate);

    return () => {
      disposed = true;
      hitTestRef.current = null;
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
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
      : state === 'sleeping' ? 'AI assistant is sleeping'
        : 'Open AI assistant');
  // No background box: the robot itself is the only visible and clickable area.
  const transparentStyle = {
    background: 'transparent',
    border: 'none',
    boxShadow: 'none',
    backdropFilter: 'none',
  } as const;
  const buttonStyle = draggable
    ? {
        ...transparentStyle,
        left: position?.x ?? 0,
        top: position?.y ?? 0,
        visibility: position ? ('visible' as const) : ('hidden' as const),
      }
    : transparentStyle;

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
      onPointerEnter={() => { if (state === 'idle') setGesture('waving'); }}
      onFocus={() => { if (state === 'idle') setGesture('waving'); }}
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