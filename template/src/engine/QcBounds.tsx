import React, { useLayoutEffect, useRef, useState } from "react";
import { Artifact, continueRender, delayRender, useCurrentFrame } from "remotion";
import { useTimeline } from "./context";

type Rect = [number, number, number, number];

function overlayBounds(root: HTMLElement): Rect[] {
  const frame = root.getBoundingClientRect();
  if (!frame.width || !frame.height) return [];
  const boxes: Rect[] = [];
  for (const el of root.querySelectorAll("[data-qc-overlay]")) {
    const parent = el.parentElement;
    const style = getComputedStyle(el);
    if (style.opacity === "0" || (parent && getComputedStyle(parent).opacity === "0")) continue;
    const r = el.getBoundingClientRect();
    let ink = r;
    if (style.overflow === "visible" && (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight)) {
      const range = document.createRange();
      range.selectNodeContents(el);
      ink = range.getBoundingClientRect();
    }
    const clip = parent && getComputedStyle(parent).overflow === "hidden" ? parent.getBoundingClientRect() : frame;
    const box: Rect = [
      (Math.max(Math.min(r.left, ink.left), clip.left, frame.left) - frame.left) / frame.width,
      (Math.max(Math.min(r.top, ink.top), clip.top, frame.top) - frame.top) / frame.height,
      (Math.min(Math.max(r.right, ink.right), clip.right, frame.right) - frame.left) / frame.width,
      (Math.min(Math.max(r.bottom, ink.bottom), clip.bottom, frame.bottom) - frame.top) / frame.height,
    ];
    if (box[0] < box[2] && box[1] < box[3]) boxes.push(box);
  }
  return boxes;
}

const QcSample: React.FC<{ filename: string }> = ({ filename }) => {
  const marker = useRef<HTMLSpanElement>(null);
  const [sample, setSample] = useState<{ handle?: number; boxes: Rect[] } | null>(null);
  useLayoutEffect(() => {
    const root = marker.current?.closest<HTMLElement>("[data-probe=frame]");
    if (!root) return;
    if (document.fonts.status === "loaded") {
      setSample({ boxes: overlayBounds(root) });
      return;
    }
    const handle = delayRender("QC overlay bounds");
    let active = true;
    void document.fonts.ready.then(() => {
      if (active) setSample({ handle, boxes: overlayBounds(root) });
    });
    return () => {
      active = false;
      continueRender(handle);
    };
  }, []);
  useLayoutEffect(() => {
    if (sample?.handle !== undefined) continueRender(sample.handle);
  }, [sample]);
  return <><span ref={marker} hidden />{sample && <Artifact filename={filename} content={JSON.stringify(sample.boxes)} />}</>;
};

export const QcBounds: React.FC = () => {
  const frame = useCurrentFrame();
  const sample = useTimeline().qcBounds;
  if (!sample || frame < sample.start || (frame - sample.start) % sample.step !== 0) return null;
  return <QcSample key={frame} filename={`${sample.id}/${frame}.json`} />;
};
