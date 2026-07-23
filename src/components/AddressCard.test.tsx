// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AddressCard } from "./AddressCard";
import { makeAddressInfo } from "../test/fixtures";

const ADDR = "0xae7ab96520de3a18e5e111b5eaab095312d7fe84";

afterEach(cleanup);

describe("AddressCard", () => {
  it("renders the address as an explorer link opened in a new tab", () => {
    const info = makeAddressInfo({ explorerUrl: "https://etherscan.io/address/" + ADDR });
    render(<AddressCard address={ADDR} info={info} />);
    const link = screen.getByRole("link", { name: ADDR });
    expect(link).toHaveAttribute("href", "https://etherscan.io/address/" + ADDR);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("clicking the explorer link does not prevent it from firing (fires the analytics callback)", () => {
    const info = makeAddressInfo();
    render(<AddressCard address={ADDR} info={info} />);
    const link = screen.getByRole("link", { name: ADDR });
    fireEvent.click(link);
    expect(link).toBeInTheDocument();
  });

  it("omits the label paragraph when label is null", () => {
    const info = makeAddressInfo({ label: null });
    const { container } = render(<AddressCard address={ADDR} info={info} />);
    expect(container.querySelector(".text-tan.font-semibold")).toBeNull();
  });

  it("renders the label when present", () => {
    const info = makeAddressInfo({ label: "PauseProxy" });
    render(<AddressCard address={ADDR} info={info} />);
    expect(screen.getByText("PauseProxy")).toBeInTheDocument();
  });

  it("renders aliases joined with a middle dot", () => {
    const info = makeAddressInfo({ aliases: ["Alias One", "Alias Two"] });
    render(<AddressCard address={ADDR} info={info} />);
    expect(screen.getByText("also known as Alias One · Alias Two")).toBeInTheDocument();
  });

  it("omits the aliases line when there are none", () => {
    const info = makeAddressInfo({ aliases: [] });
    render(<AddressCard address={ADDR} info={info} />);
    expect(screen.queryByText(/also known as/)).toBeNull();
  });

  it("renders role pills", () => {
    const info = makeAddressInfo({ roles: ["prime", "executor"] });
    render(<AddressCard address={ADDR} info={info} />);
    expect(screen.getByText("prime")).toBeInTheDocument();
    expect(screen.getByText("executor")).toBeInTheDocument();
  });

  it("renders a proxy badge with the shortened implementation address when isProxy+implementation set", () => {
    const impl = "0x1111111111111111111111111111111111111111";
    const info = makeAddressInfo({ isProxy: true, implementation: impl, roles: [] });
    render(<AddressCard address={ADDR} info={info} />);
    expect(screen.getByText(/proxy →/)).toBeInTheDocument();
    expect(screen.getByTitle(`implementation ${impl}`)).toBeInTheDocument();
  });

  it("omits the proxy badge when isProxy is true but implementation is missing", () => {
    const info = makeAddressInfo({ isProxy: true, implementation: undefined, roles: [] });
    render(<AddressCard address={ADDR} info={info} />);
    expect(screen.queryByText(/proxy →/)).toBeNull();
  });

  it("omits the whole badge row when there are no roles and no proxy", () => {
    const info = makeAddressInfo({ isProxy: false, roles: [] });
    const { container } = render(<AddressCard address={ADDR} info={info} />);
    expect(container.querySelector(".badge")).toBeNull();
  });

  it("omits the on-chain section when chainValues is not provided", () => {
    const info = makeAddressInfo();
    render(<AddressCard address={ADDR} info={info} />);
    expect(screen.queryByText("on-chain · view functions")).toBeNull();
  });

  it("renders visible chain values and skips null/zero-address/empty/DOMAIN_SEPARATOR/PERMIT_TYPEHASH", () => {
    const info = makeAddressInfo();
    render(
      <AddressCard
        address={ADDR}
        info={info}
        chainValues={{
          owner: "0x2222222222222222222222222222222222222222",
          wards: null,
          zero: "0x0000000000000000000000000000000000000000",
          blank: "",
          DOMAIN_SEPARATOR: "0xabc",
          PERMIT_TYPEHASH: "0xdef",
          live: true,
          decimals: 18,
        }}
      />,
    );
    expect(screen.getByText("on-chain · view functions")).toBeInTheDocument();
    expect(screen.getByText("owner")).toBeInTheDocument();
    expect(screen.getByText("live")).toBeInTheDocument();
    expect(screen.getByText("decimals")).toBeInTheDocument();
    expect(screen.queryByText("wards")).toBeNull();
    expect(screen.queryByText("zero")).toBeNull();
    expect(screen.queryByText("blank")).toBeNull();
    expect(screen.queryByText("DOMAIN_SEPARATOR")).toBeNull();
    expect(screen.queryByText("PERMIT_TYPEHASH")).toBeNull();
  });

  it("renders an address-shaped chain value as an explorer link, and formats boolean/array/object values", () => {
    const ownerAddr = "0x3333333333333333333333333333333333333333";
    const info = makeAddressInfo();
    render(
      <AddressCard
        address={ADDR}
        info={info}
        chainValues={{
          owner: ownerAddr,
          live: true,
          dead: false,
          list: ["a", "b"],
          meta: { x: 1 },
        }}
      />,
    );
    const link = screen.getByRole("link", { name: ownerAddr });
    expect(link).toHaveAttribute("href", "https://etherscan.io/address/" + ownerAddr);
    expect(screen.getByText("true")).toBeInTheDocument();
    expect(screen.getByText("false")).toBeInTheDocument();
    expect(screen.getByText("a, b")).toBeInTheDocument();
    expect(screen.getByText('{"x":1}')).toBeInTheDocument();
  });
});
