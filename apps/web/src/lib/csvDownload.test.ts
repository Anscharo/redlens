// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { downloadFile, downloadCSV } from "./csvDownload";

// jsdom implements neither URL.createObjectURL nor revokeObjectURL — stub both,
// and use fake timers so the deferred revoke (setTimeout 0) actually runs.
describe("downloadFile / downloadCSV", () => {
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  let create: ReturnType<typeof vi.fn>;
  let revoke: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;
  let clicked: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    create = vi.fn(() => "blob:mock");
    revoke = vi.fn();
    URL.createObjectURL = create as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revoke as unknown as typeof URL.revokeObjectURL;
    clicked = [];
    // Override click so jsdom doesn't attempt (and warn about) navigation.
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
  });

  afterEach(() => {
    clickSpy.mockRestore();
    vi.useRealTimers();
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
  });

  it("creates a blob URL, clicks a download anchor, and revokes it on the next tick", () => {
    downloadFile("notes.md", "# hi", "text/markdown;charset=utf-8");
    expect(create).toHaveBeenCalledTimes(1);
    expect(clicked).toEqual(["notes.md"]);
    // The anchor is removed synchronously; the object URL is revoked deferred.
    expect(document.querySelector("a[download]")).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:mock");
  });

  it("prepends a UTF-8 BOM for CSV and not for plain text", () => {
    downloadFile("plain.txt", "abc", "text/plain", false);
    downloadCSV("data.csv", "a,b");
    expect(clicked).toEqual(["plain.txt", "data.csv"]);
    const plainBlob = create.mock.calls[0][0] as Blob;
    const csvBlob = create.mock.calls[1][0] as Blob;
    expect(csvBlob.type).toBe("text/csv;charset=utf-8");
    // The BOM adds three UTF-8 bytes to the CSV blob but not the plain one.
    expect(csvBlob.size).toBe(plainBlob.size + 3);
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledTimes(2);
  });
});
