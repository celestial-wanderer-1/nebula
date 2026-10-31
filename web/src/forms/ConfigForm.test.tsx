import {
  create,
  type DescMessage,
  type MessageShape,
} from "@bufbuild/protobuf";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { CircularFilamentSchema } from "../gen/nebula/core/v1/component_pb";
import { FieldViolationSchema } from "../gen/nebula/core/v1/errors_pb";
import { mockSchema } from "../mocks/fixtures";
import { renderConnected } from "../test/render";
import { ConfigForm } from "./ConfigForm";
import { newMessage } from "./defaults";

const demo = mockSchema.getMessage("acme.demo.v1.DemoSolverConfig")!;

function Harness<Desc extends DescMessage>({
  schema,
  initial,
  onValue,
  ...rest
}: {
  schema: Desc;
  initial: MessageShape<Desc>;
  onValue?: (value: MessageShape<Desc>) => void;
  projectId?: string;
  readOnly?: boolean;
  violations?: ReturnType<typeof create<typeof FieldViolationSchema>>[];
}) {
  const [value, setValue] = useState(initial);
  return (
    <ConfigForm
      schema={schema}
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue?.(next);
      }}
      {...rest}
    />
  );
}

function renderDemo(props: Partial<Parameters<typeof Harness>[0]> = {}) {
  const onValue = vi.fn();
  renderConnected(
    <Harness
      schema={demo}
      initial={newMessage(demo)}
      onValue={onValue}
      projectId="p-baseline"
      {...props}
    />,
  );
  const latest = () =>
    onValue.mock.lastCall?.[0] as Record<string, unknown> | undefined;
  return { onValue, latest };
}

describe("ConfigForm over a plugin message", () => {
  it("labels numbers with units, bounds and the design-variable marker", () => {
    renderDemo();
    const current = screen.getByLabelText(/Coil current/);
    expect(current.closest(".field")).toHaveTextContent("Coil current [A]DV");
    expect(
      screen.getByLabelText(/Edge temperature/).closest(".field"),
    ).toHaveTextContent("[eV]");
    expect(screen.getByText("Range: -10000000 to 10000000")).toBeVisible();
  });

  it("groups fields and applies defaults", () => {
    renderDemo();
    const group = screen.getByRole("button", {
      name: "Convergence",
    }).parentElement!;
    expect(within(group).getByLabelText("Tolerance")).toHaveValue("1e-8");
    expect(within(group).getByLabelText("Max iterations")).toHaveValue("200");
  });

  it("warns on out-of-bounds values but keeps them (advisory)", async () => {
    const { latest } = renderDemo();
    const input = screen.getByLabelText(/Edge temperature/);
    fireEvent.change(input, { target: { value: "-5" } });
    expect(screen.getByText("Below the minimum of 0")).toBeVisible();
    expect(latest()?.edgeTemperature).toBe(-5);
  });

  it("keeps unparsable text without emitting a value", () => {
    const { onValue } = renderDemo();
    const tolerance = screen.getByLabelText("Tolerance");
    fireEvent.change(tolerance, { target: { value: "1e-" } });
    expect(tolerance).toHaveValue("1e-");
    expect(screen.getByText("Enter a number")).toBeVisible();
    expect(onValue).not.toHaveBeenCalled();
    fireEvent.change(tolerance, { target: { value: "1e-6" } });
    expect(onValue.mock.lastCall?.[0]).toMatchObject({ tolerance: 1e-6 });
  });

  it("edits bools, strings and enums", async () => {
    const { latest } = renderDemo();
    await userEvent.click(screen.getByRole("switch", { name: "Use symmetry" }));
    expect(latest()?.useSymmetry).toBe(true);
    expect(
      screen.getByText("Solve one field period and replicate."),
    ).toBeVisible();

    fireEvent.change(screen.getByLabelText("Label"), {
      target: { value: "run A" },
    });
    expect(latest()?.label).toBe("run A");

    const method = screen.getByLabelText("Method");
    expect(method).toHaveDisplayValue("Fast multipole");
    expect(within(method).queryByText("Unspecified")).toBeNull();
    await userEvent.selectOptions(method, "Direct sum");
    expect(latest()?.method).toBe(1);
  });

  it("switches oneof variants and shows the chosen variant's fields", async () => {
    const { latest } = renderDemo();
    const boundary = screen.getByLabelText("Boundary");
    expect(screen.queryByLabelText(/Minor radius/)).toBeNull();

    await userEvent.selectOptions(boundary, "Fixed");
    expect(screen.getByLabelText(/Minor radius/)).toBeVisible();
    expect(latest()?.boundary).toMatchObject({ case: "fixed" });

    await userEvent.selectOptions(boundary, "Free");
    expect(screen.queryByLabelText(/Minor radius/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Coil iterations"), {
      target: { value: "3" },
    });
    expect(latest()?.boundary).toMatchObject({
      case: "free",
      value: { coilIterations: 3 },
    });
  });

  it("edits nested messages in collapsible groups", async () => {
    const { latest } = renderDemo();
    const grid = screen.getByRole("button", { name: "Grid" });
    fireEvent.change(screen.getByLabelText("Nr"), { target: { value: "64" } });
    expect(latest()?.grid).toMatchObject({ nr: 64 });
    await userEvent.click(grid);
    expect(screen.queryByLabelText("Nr")).toBeNull();
  });

  it("adds and removes items of a repeated scalar", async () => {
    const { latest } = renderDemo();
    await userEvent.click(
      screen.getByRole("button", { name: "Add radial knots" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Add radial knots" }),
    );
    fireEvent.change(screen.getByLabelText("Radial knots 2"), {
      target: { value: "1.5" },
    });
    expect(latest()?.radialKnots).toEqual([0, 1.5]);
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Radial knots 1" }),
    );
    expect(latest()?.radialKnots).toEqual([1.5]);
  });

  it("adds, reorders and removes repeated messages", async () => {
    const { latest } = renderDemo();
    const add = screen.getByRole("button", { name: "Add probes" });
    await userEvent.click(add);
    await userEvent.click(add);
    const first = screen.getByRole("listitem", { name: "Probes 1" });
    fireEvent.change(within(first).getByLabelText("Name"), {
      target: { value: "p1" },
    });
    expect(within(first).getByLabelText("R [m]")).toBeVisible();

    await userEvent.click(
      screen.getByRole("button", { name: "Move Probes 1 down" }),
    );
    expect(latest()?.probes).toMatchObject([{ name: "" }, { name: "p1" }]);
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Probes 1" }),
    );
    expect(latest()?.probes).toMatchObject([{ name: "p1" }]);
  });

  it("edits string-keyed maps", async () => {
    const { latest } = renderDemo();
    await userEvent.click(screen.getByRole("button", { name: "Add entry" }));
    fireEvent.change(screen.getByLabelText("Extra key1"), {
      target: { value: "2.5" },
    });
    expect(latest()?.extra).toEqual({ key1: 2.5 });

    const key = screen.getByLabelText("Extra key 1");
    fireEvent.change(key, { target: { value: "beta" } });
    fireEvent.blur(key);
    expect(latest()?.extra).toEqual({ beta: 2.5 });
  });

  it("picks entity references by the annotated kind (D107)", async () => {
    const { latest } = renderDemo();
    const picker = screen.getByRole("group", { name: "Geometry" });
    const select = within(picker).getByLabelText("Geometry");
    await waitFor(() =>
      expect(within(select).getByText("Baseline assembly")).toBeInTheDocument(),
    );
    await userEvent.selectOptions(select, "Baseline assembly");
    expect(latest()?.geometry).toMatchObject({
      id: "geo-main",
      state: { case: "pinned", value: { versionHash: "sha256:geo-v2" } },
    });
  });

  it("renders dataset references as their fields", () => {
    renderDemo();
    expect(screen.getByRole("button", { name: "Initial guess" })).toBeVisible();
    expect(screen.getByLabelText("Content hash")).toBeVisible();
  });

  it("hides hidden fields and shows newer-core fields read-only", () => {
    renderDemo();
    expect(screen.queryByLabelText(/Internal key/)).toBeNull();
    const future = screen.getByRole("textbox", { name: "Future field" });
    expect(future).toHaveAttribute("aria-readonly", "true");
    expect(future).toHaveTextContent("0");
    expect(
      screen.getByText(
        "Uses an option from a newer Nebula core; shown read-only.",
      ),
    ).toBeVisible();
  });

  it("renders server violations at their field path", () => {
    renderDemo({
      violations: [
        create(FieldViolationSchema, {
          path: "grid.nr",
          message: "Grid too coarse",
        }),
      ],
    });
    const nr = screen.getByLabelText("Nr");
    expect(nr).toHaveAttribute("aria-invalid", "true");
    expect(nr.closest(".field")).toHaveTextContent("Grid too coarse");
  });

  it("disables editing when read-only", () => {
    renderDemo({ readOnly: true });
    expect(screen.getByLabelText("Tolerance")).toHaveAttribute("readonly");
    expect(screen.getByRole("switch", { name: "Use symmetry" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add probes" })).toBeDisabled();
  });
});

describe("ConfigForm over a core message (D111)", () => {
  it("uses the same annotations as plugin messages", () => {
    renderConnected(
      <Harness
        schema={CircularFilamentSchema}
        initial={newMessage(CircularFilamentSchema)}
      />,
    );
    expect(
      screen.getByLabelText(/Major radius/).closest(".field"),
    ).toHaveTextContent("Major radius [m]DV");
    expect(screen.getByLabelText(/Height \(z\)/)).toBeVisible();
    const group = screen.getByRole("button", {
      name: "Discretization",
    }).parentElement!;
    expect(within(group).getByLabelText("Segments")).toHaveValue("128");
  });
});
