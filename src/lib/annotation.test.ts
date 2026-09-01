import { describe, it, expect } from "vitest";
import { annotatedDocNo, annotationTarget, ANNOTATION_TAIL_SEGMENTS } from "./annotation";

describe("annotatedDocNo", () => {
  it("strips the .0.3.N suffix", () => {
    expect(annotatedDocNo("A.2.8.0.3.2")).toBe("A.2.8");
    expect(annotatedDocNo("A.0.1.2.1.1.0.3.1")).toBe("A.0.1.2.1.1");
    expect(annotatedDocNo("A.3.3.2.7.1.1.1.3.0.3.1")).toBe("A.3.3.2.7.1.1.1.3");
  });

  it("strips exactly ANNOTATION_TAIL_SEGMENTS segments", () => {
    const doc = "A.2.8.0.3.2";
    const target = annotatedDocNo(doc)!;
    expect(doc.split(".").length - target.split(".").length).toBe(ANNOTATION_TAIL_SEGMENTS);
  });

  it("returns null for doc_nos that aren't annotations", () => {
    expect(annotatedDocNo("A.2.8")).toBeNull();
    expect(annotatedDocNo("A.1.5.3.0.4.1")).toBeNull(); // Action Tenet
    expect(annotatedDocNo("A.1.1.3.1.0.6.1")).toBeNull(); // Active Data
    expect(annotatedDocNo("NR-12")).toBeNull();
  });

  it("only matches the suffix, never a .0.3. run mid-number", () => {
    expect(annotatedDocNo("A.1.0.3.1.2")).toBeNull();
  });
});

describe("annotationTarget", () => {
  it("requires the Annotation type as well as the numbering", () => {
    expect(annotationTarget({ type: "Annotation", doc_no: "A.2.8.0.3.2" })).toBe("A.2.8");
    expect(annotationTarget({ type: "Core", doc_no: "A.2.8.0.3.2" })).toBeNull();
    expect(annotationTarget({ type: "Annotation", doc_no: "A.2.8" })).toBeNull();
  });
});
