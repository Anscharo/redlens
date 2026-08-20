// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  preview: null as unknown,
  location: "/atlas",
  navigate: vi.fn(),
  ids: new Set<string>(),
  selectedOnly: false,
  setSelectedOnly: vi.fn(),
  setActiveCollectionId: vi.fn(),
  activeCollectionName: null as string | null,
  setActiveCollectionName: vi.fn(),
  clear: vi.fn(),
  user: null as unknown,
  takeResumeSave: vi.fn(() => false),
  track: vi.fn(),
  usersEnabled: vi.fn(() => true),
}));

vi.mock("@/lib/dataSource", () => ({ useDataSource: () => ({ preview: mocks.preview }) }));
vi.mock("wouter", () => ({ useLocation: () => [mocks.location, mocks.navigate] }));
vi.mock("@/lib/selection", () => ({
  useSelection: () => ({
    ids: mocks.ids,
    selectedOnly: mocks.selectedOnly,
    setSelectedOnly: mocks.setSelectedOnly,
    setActiveCollectionId: mocks.setActiveCollectionId,
    activeCollectionName: mocks.activeCollectionName,
    setActiveCollectionName: mocks.setActiveCollectionName,
    clear: mocks.clear,
  }),
}));
vi.mock("../chat/auth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/lib/authReturn", () => ({ takeResumeSave: mocks.takeResumeSave }));
vi.mock("@/lib/analytics", () => ({ track: mocks.track }));
vi.mock("@/lib/usersEnabled", () => ({ usersEnabled: mocks.usersEnabled }));
vi.mock("./SaveCollectionModal", () => ({
  SaveCollectionModal: ({ ids, onClose }: { ids: string[]; onClose: () => void }) => (
    <div data-testid="save-modal" data-ids={ids.join(",")}>
      <button onClick={onClose}>close-modal</button>
    </div>
  ),
}));

import { SelectionTreeToggle } from "./SelectionTreeToggle";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.preview = null;
  mocks.location = "/atlas";
  mocks.ids = new Set<string>();
  mocks.selectedOnly = false;
  mocks.activeCollectionName = null;
  mocks.user = null;
  mocks.takeResumeSave.mockReturnValue(false);
  mocks.usersEnabled.mockReturnValue(true);
});

describe("SelectionTreeToggle visibility", () => {
  it("renders nothing in preview mode", () => {
    mocks.preview = { id: "pr-1" };
    const { container } = render(<SelectionTreeToggle />);
    expect(container).toBeEmptyDOMElement();
  });

  it("hides the bar off the reader route when nothing is selected", () => {
    mocks.location = "/";
    mocks.ids = new Set();
    const { container } = render(<SelectionTreeToggle />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the bar off the reader route once something is selected", () => {
    mocks.location = "/";
    mocks.ids = new Set(["a"]);
    render(<SelectionTreeToggle />);
    expect(screen.getByText("All")).toBeInTheDocument();
  });

  it("always shows the bar on the reader route, even with an empty selection", () => {
    mocks.location = "/atlas";
    mocks.ids = new Set();
    render(<SelectionTreeToggle />);
    expect(screen.getByText("All")).toBeInTheDocument();
  });
});

describe("SelectionTreeToggle interactions", () => {
  it("clicking All tracks + sets selectedOnly false", () => {
    mocks.ids = new Set(["a"]);
    render(<SelectionTreeToggle />);
    fireEvent.click(screen.getByText("All"));
    expect(mocks.track).toHaveBeenCalledWith("selection_view_toggle", { view: "all", count: 1 });
    expect(mocks.setSelectedOnly).toHaveBeenCalledWith(false);
  });

  it("shows the Selected pill with count and active collection name, and clicking it selects that view", () => {
    mocks.ids = new Set(["a", "b"]);
    mocks.activeCollectionName = "Trip";
    render(<SelectionTreeToggle />);
    expect(screen.getByText("Trip")).toBeInTheDocument();
    expect(screen.getByText("· 2")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Trip"));
    expect(mocks.track).toHaveBeenCalledWith("selection_view_toggle", { view: "selected_only", count: 2 });
    expect(mocks.setSelectedOnly).toHaveBeenCalledWith(true);
  });

  it("falls back to 'Selected' label when there's no active collection name", () => {
    mocks.ids = new Set(["a"]);
    render(<SelectionTreeToggle />);
    expect(screen.getByText("Selected")).toBeInTheDocument();
  });

  it("clear button clears selection, view mode, and active collection", () => {
    mocks.ids = new Set(["a"]);
    render(<SelectionTreeToggle />);
    fireEvent.click(screen.getByLabelText("Clear selection"));
    expect(mocks.clear).toHaveBeenCalled();
    expect(mocks.setSelectedOnly).toHaveBeenCalledWith(false);
    expect(mocks.setActiveCollectionId).toHaveBeenCalledWith(null);
    expect(mocks.setActiveCollectionName).toHaveBeenCalledWith(null);
  });

  it("hides selected-pill/clear when count is 0", () => {
    mocks.ids = new Set();
    render(<SelectionTreeToggle />);
    expect(screen.queryByLabelText("Clear selection")).toBeNull();
    expect(screen.queryByText("Selected")).toBeNull();
  });
});

describe("SelectionTreeToggle save + collections nav (users enabled)", () => {
  it("shows save + collections-nav buttons when count > 0 and usersEnabled", () => {
    mocks.ids = new Set(["a"]);
    render(<SelectionTreeToggle />);
    expect(screen.getByLabelText("Save as collection")).toBeInTheDocument();
    expect(screen.getByLabelText("Open collections")).toBeInTheDocument();
  });

  it("hides the save button when count is 0, but still shows collections nav", () => {
    mocks.ids = new Set();
    render(<SelectionTreeToggle />);
    expect(screen.queryByLabelText("Save as collection")).toBeNull();
    expect(screen.getByLabelText("Open collections")).toBeInTheDocument();
  });

  it("hides both when usersEnabled() is false", () => {
    mocks.usersEnabled.mockReturnValue(false);
    mocks.ids = new Set(["a"]);
    render(<SelectionTreeToggle />);
    expect(screen.queryByLabelText("Save as collection")).toBeNull();
    expect(screen.queryByLabelText("Open collections")).toBeNull();
  });

  it("clicking the collections-nav button tracks + navigates", () => {
    mocks.ids = new Set(["a"]);
    render(<SelectionTreeToggle />);
    fireEvent.click(screen.getByLabelText("Open collections"));
    expect(mocks.track).toHaveBeenCalledWith("collections_open_nav", {});
    expect(mocks.navigate).toHaveBeenCalledWith("/collections");
  });

  it("clicking Save as collection opens the modal with current ids, and it can be closed", () => {
    mocks.ids = new Set(["a", "b"]);
    render(<SelectionTreeToggle />);
    expect(screen.queryByTestId("save-modal")).toBeNull();
    fireEvent.click(screen.getByLabelText("Save as collection"));
    expect(mocks.track).toHaveBeenCalledWith("collection_save_open", { count: 2 });
    const modal = screen.getByTestId("save-modal");
    expect(modal.dataset.ids).toBe("a,b");
    fireEvent.click(screen.getByText("close-modal"));
    expect(screen.queryByTestId("save-modal")).toBeNull();
  });

  it("reopens the save modal automatically after an OAuth round-trip (resume-save flag + signed in)", () => {
    mocks.ids = new Set(["a"]);
    mocks.user = { id: "u1" };
    mocks.takeResumeSave.mockReturnValue(true);
    render(<SelectionTreeToggle />);
    expect(screen.getByTestId("save-modal")).toBeInTheDocument();
  });

  it("does not consume the resume-save flag while signed out", () => {
    mocks.ids = new Set(["a"]);
    mocks.user = null;
    render(<SelectionTreeToggle />);
    expect(mocks.takeResumeSave).not.toHaveBeenCalled();
  });
});
