import React, { useLayoutEffect, useState } from "react";
import { Artifact, continueRender, delayRender } from "remotion";

type Rect = [number, number, number, number];

function overlayBounds(root: HTMLElement): Rect[] {
  const frame = root.getBoundingClientRect();
  if (!frame.width || !frame.height) return [];
  const boxes: Rect[] = [];
  for (const el of root.querySelectorAll("[data-caption], [data-qc-watermark]")) {
    const parent = el.parentElement;
    if (getComputedStyle(el).opacity === "0" || (parent && getComputedStyle(parent).opacity === "0")) continue;
    const r = el.getBoundingClientRect();
    let ink = r;
    if (el.hasAttribute("data-caption") && (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight)) {
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

export const QcBounds: React.FC<{ root: React.RefObject<HTMLDivElement | null>; filename: string }> = ({ root, filename }) => {
  const [sample, setSample] = useState<{ handle?: number; boxes: Rect[] } | null>(null);
  useLayoutEffect(() => {
    if (document.fonts.status === "loaded" && root.current) {
      setSample({ boxes: overlayBounds(root.current) });
      return;
    }
    const handle = delayRender("QC overlay bounds");
    let active = true;
    void document.fonts.ready.then(() => {
      if (active) setSample({ handle, boxes: root.current ? overlayBounds(root.current) : [] });
    });
    return () => {
      active = false;
      continueRender(handle);
    };
  }, [root]);
  useLayoutEffect(() => {
    if (sample?.handle !== undefined) continueRender(sample.handle);
  }, [sample]);
  return sample ? <Artifact filename={filename} content={JSON.stringify(sample.boxes)} /> : null;
};
