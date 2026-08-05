import { I, INDENT_STEP } from "./constants";

export function IndentGuides({ indent }: { indent: number }) {
  const guides: number[] = [];
  // One guide per ancestor level, centered on that level's icon
  for (let x = I.cat + 4; x < indent; x += INDENT_STEP) {
    guides.push(x);
  }
  return (
    <>
      {guides.map((x) => (
        <span key={x} className="sidebar-indent-guide" style={{ left: `${x}px` }} />
      ))}
    </>
  );
}
