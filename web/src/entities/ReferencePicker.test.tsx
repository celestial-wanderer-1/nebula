import { create } from "@bufbuild/protobuf";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  EntityKind,
  EntityRefSchema,
  type EntityRef,
} from "../gen/nebula/core/v1/entity_pb";
import { renderConnected } from "../test/render";
import { ReferencePicker } from "./ReferencePicker";
import { StalenessBadge } from "./StalenessBadge";

function Harness({
  initial,
  onRef,
}: {
  initial?: EntityRef;
  onRef: (ref: EntityRef) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ReferencePicker
      projectId="p-baseline"
      kind={EntityKind.GEOMETRY}
      value={value}
      onChange={(ref) => {
        setValue(ref);
        onRef(ref);
      }}
    />
  );
}

const entitySelect = () => screen.getByRole("combobox", { name: "Geometry" });

async function choose(name: string) {
  await waitFor(() =>
    expect(within(entitySelect()).getByText(name)).toBeInTheDocument(),
  );
  await userEvent.selectOptions(entitySelect(), name);
}

describe("ReferencePicker", () => {
  it("defaults to the head version for a versioned entity", async () => {
    const onRef = vi.fn();
    renderConnected(<Harness onRef={onRef} />);
    await choose("Baseline assembly");
    expect(onRef).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: "geo-main",
        state: expect.objectContaining({ case: "pinned" }),
      }),
    );
    expect(screen.getByRole("radio", { name: "Pinned version" })).toBeChecked();
    expect(
      screen.getByRole("combobox", { name: "Version" }),
    ).toHaveDisplayValue("geo-v2 (head)");
  });

  it("defaults to the draft for a never-versioned entity, with pinning unavailable", async () => {
    const onRef = vi.fn();
    renderConnected(<Harness onRef={onRef} />);
    await choose("Alternative assembly");
    expect(onRef.mock.lastCall?.[0].state.case).toBe("draft");
    expect(screen.getByRole("radio", { name: "Current draft" })).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Pinned version" }),
    ).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Track latest" })).toBeDisabled();
  });

  it("switches to latest and to an older pinned version", async () => {
    const onRef = vi.fn();
    renderConnected(<Harness onRef={onRef} />);
    await choose("Baseline assembly");

    await userEvent.click(screen.getByRole("radio", { name: "Track latest" }));
    expect(onRef.mock.lastCall?.[0].state.case).toBe("latest");

    await userEvent.click(
      screen.getByRole("radio", { name: "Pinned version" }),
    );
    const version = screen.getByRole("combobox", { name: "Version" });
    await waitFor(() =>
      expect(within(version).getByText("geo-v1")).toBeInTheDocument(),
    );
    await userEvent.selectOptions(version, "geo-v1");
    expect(onRef.mock.lastCall?.[0].state).toMatchObject({
      case: "pinned",
      value: { versionHash: "sha256:geo-v1" },
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Newer version available",
    );
  });
});

describe("StalenessBadge (D101)", () => {
  const pinned = (hash: string) =>
    create(EntityRefSchema, {
      state: { case: "pinned", value: { versionHash: hash } },
    });

  it("is shown only when a pinned reference trails the head", () => {
    const { rerender } = render(
      <StalenessBadge reference={pinned("v2")} headHash="v2" />,
    );
    expect(screen.queryByRole("status")).toBeNull();
    rerender(<StalenessBadge reference={pinned("v1")} headHash="v2" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Newer version available",
    );
  });

  it("offers a re-run when one is available", async () => {
    const onRerun = vi.fn();
    render(
      <StalenessBadge
        reference={pinned("v1")}
        headHash="v2"
        onRerun={onRerun}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Re-run" }));
    expect(onRerun).toHaveBeenCalled();
  });
});
