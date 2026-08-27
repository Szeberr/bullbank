"use client";

import React, { useRef, useState } from "react";
import { motion } from "motion/react";

/**
 * Magnetic hover — the child drifts toward the cursor and springs back on exit.
 *
 * Adapted from the reference implementation. Two changes: the debug affordances
 * (dashed border and blue tint that appear while active) are gone, since this
 * wraps a real call-to-action rather than a demo tile, and the pull is softer.
 * At the reference strength of 0.8 the button chases the cursor hard enough that
 * it becomes awkward to actually click.
 */
export function Magnetic({
  children,
  strength = 0.35,
  maxDistance = 42,
  className,
}: {
  children: React.ReactNode;
  strength?: number;
  maxDistance?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return;

    const { width, height, left, top } = ref.current.getBoundingClientRect();
    let x = (e.clientX - (left + width / 2)) * strength;
    let y = (e.clientY - (top + height / 2)) * strength;

    // Clamp the offset so the element never runs away from its own hit area.
    const distance = Math.hypot(x, y);
    if (distance > maxDistance) {
      const scale = maxDistance / distance;
      x *= scale;
      y *= scale;
    }

    setPosition({ x, y });
  };

  return (
    <div
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setPosition({ x: 0, y: 0 })}
      className={className}
    >
      <motion.div
        ref={ref}
        animate={{ x: position.x, y: position.y }}
        transition={{ type: "spring", stiffness: 150, damping: 25, mass: 0.1 }}
      >
        {children}
      </motion.div>
    </div>
  );
}
