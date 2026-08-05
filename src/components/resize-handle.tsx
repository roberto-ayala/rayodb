import type React from "react";
import { useState } from "react";

interface ResizeHandleProps {
  direction: "horizontal" | "vertical";
  onResize: (delta: number) => void;
}

export function ResizeHandle({ direction, onResize }: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const isHorizontal = direction === "horizontal";

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    let lastPos = isHorizontal ? e.clientX : e.clientY;
    let animationFrameId: number | null = null;
    setDragging(true);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (animationFrameId !== null) {
        return;
      }

      animationFrameId = requestAnimationFrame(() => {
        const currentPos = isHorizontal ? moveEvent.clientX : moveEvent.clientY;
        const delta = currentPos - lastPos;
        lastPos = currentPos;
        onResize(delta);
        animationFrameId = null;
      });
    };

    const handleMouseUp = () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = isHorizontal ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`group relative z-10 flex-shrink-0 bg-border ${
        isHorizontal ? "w-px cursor-col-resize" : "h-px cursor-row-resize"
      }`}
    >
      {/* Grab area, overflowing the 1px line without taking up layout space */}
      <div
        className={`absolute ${isHorizontal ? "-inset-x-1 inset-y-0" : "-inset-y-1 inset-x-0"}`}
      />
      <div
        className={`pointer-events-none absolute bg-primary/50 transition-opacity duration-150 ${
          isHorizontal ? "-inset-x-px inset-y-0" : "-inset-y-px inset-x-0"
        } ${dragging ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
      />
      <div
        className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary transition-opacity ${
          isHorizontal ? "h-12 w-1" : "h-1 w-12"
        } ${dragging ? "opacity-50" : "opacity-0 group-hover:opacity-50"}`}
      />
    </div>
  );
}
