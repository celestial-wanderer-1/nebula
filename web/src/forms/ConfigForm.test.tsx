import {
  create,
  type DescMessage,
  type MessageShape,
} from "@bufbuild/protobuf";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { anyUnpack, type Any } from "@bufbuild/protobuf/wkt";
import { CircularFilamentSchema } from "../gen/nebula/core/v1/component_pb";
import { IdRef } from "../gen/nebula/core/v1/options_pb";
import { MeshVolumeRegionSchema } from "../gen/nebula/core/v1/region_pb";
import {
  CircuitCurrentSchema,
  ScenarioSchema,
} from "../gen/nebula/core/v1/scenario_pb";
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
  idChoices?: Parameters<typeof ConfigForm>[0]["idChoices"];
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

  it("picks dataset references from input datasets (D144)", async () => {
    const { latest } = renderDemo();
    const picker = screen.getByRole("group", { name: "Initial guess" });
    await userEvent.selectOptions(
      within(picker).getByLabelText("Source"),
      "Input dataset",
    );
    const input = within(picker).getByLabelText("Input dataset");
    await waitFor(() =>
      expect(
        within(input).getByText(/Reconstructed equilibrium, shot 4521/),
      ).toBeInTheDocument(),
    );
    await userEvent.selectOptions(input, "in-shot4521");
    expect(latest()?.initialGuess).toMatchObject({
      owner: "in-shot4521",
      contentHash: "sha256:in-shot4521",
    });
  });

  it("picks dataset references from committed run outputs", async () => {
    const { latest } = renderDemo();
    const picker = screen.getByRole("group", { name: "Initial guess" });
    await userEvent.selectOptions(
      within(picker).getByLabelText("Source"),
      "Run output",
    );
    const run = within(picker).getByLabelText("Run");
    await waitFor(() =>
      expect(within(run).getByText("Field to stability #11")).toBeVisible(),
    );
    // Only completed runs have committed every output.
    expect(within(run).queryByText("Field to stability #12")).toBeNull();
    await userEvent.selectOptions(run, "r-11");
    const output = within(picker).getByLabelText("Output dataset");
    await waitFor(() =>
      expect(within(output).getAllByRole("option").length).toBeGreaterThan(1),
    );
    await userEvent.selectOptions(
      output,
      within(output).getByText(/^equilibrium · \/equilibrium/),
    );
    expect(latest()?.initialGuess).toMatchObject({
      owner: "r-11",
      contentHash: "sha256:r-11-t1-equilibrium",
    });
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

describe("ConfigForm ID and Any fields", () => {
  it("picks IDs from the editing context and flags unknown ones (D114)", async () => {
    const onValue = vi.fn();
    renderConnected(
      <Harness
        schema={CircuitCurrentSchema}
        initial={create(CircuitCurrentSchema, { circuitId: "ckt-gone" })}
        onValue={onValue}
        idChoices={{
          [IdRef.CIRCUIT]: [{ id: "ckt-pf", label: "PF (ckt-pf)" }],
        }}
      />,
    );
    const select = screen.getByLabelText("Circuit");
    expect(select.closest(".field")).toHaveTextContent(
      "No circuit “ckt-gone” here",
    );
    await userEvent.selectOptions(select, "ckt-pf");
    expect(onValue).toHaveBeenLastCalledWith(
      expect.objectContaining({ circuitId: "ckt-pf" }),
    );
  });

  it("toggles repeated IDs", async () => {
    const onValue = vi.fn();
    renderConnected(
      <Harness
        schema={MeshVolumeRegionSchema}
        initial={create(MeshVolumeRegionSchema)}
        onValue={onValue}
        idChoices={{
          [IdRef.COMPONENT]: [
            { id: "a", label: "Coil A" },
            { id: "b", label: "Coil B" },
          ],
        }}
      />,
    );
    await userEvent.click(screen.getByRole("checkbox", { name: "Coil B" }));
    expect(onValue).toHaveBeenLastCalledWith(
      expect.objectContaining({ componentIds: ["b"] }),
    );
  });

  it("offers core and plugin messages of an Any field's role", async () => {
    const onValue = vi.fn();
    renderConnected(
      <Harness
        schema={ScenarioSchema}
        initial={create(ScenarioSchema)}
        onValue={onValue}
        projectId="p-baseline"
      />,
    );
    const add = screen.getByLabelText("Add plasma targets");
    expect(
      within(add)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual([
      "Choose a type…",
      "Plasma targets",
      "Demo plasma target (acme.demo.v1)",
    ]);
    await userEvent.selectOptions(add, "acme.demo.v1.DemoPlasmaTarget");
    const item = screen.getByRole("listitem", { name: "Plasma targets 1" });
    await userEvent.type(within(item).getByLabelText("Ripple limit"), "0.01");
    const targets = (onValue.mock.lastCall?.[0] as { plasmaTargets: Any[] })
      .plasmaTargets;
    expect(targets).toHaveLength(1);
    expect(targets[0]?.typeUrl).toBe(
      "type.googleapis.com/acme.demo.v1.DemoPlasmaTarget",
    );
    const demo = mockSchema.getMessage("acme.demo.v1.DemoPlasmaTarget")!;
    expect(anyUnpack(targets[0]!, demo)).toMatchObject({ rippleLimit: 0.01 });
  });

  it("shows an Any value of an unknown type read-only", () => {
    renderConnected(
      <Harness
        schema={ScenarioSchema}
        initial={create(ScenarioSchema, {
          plasmaTargets: [
            {
              typeUrl: "type.googleapis.com/other.v1.Target",
              value: new Uint8Array([8, 1]),
            },
          ],
        })}
        projectId="p-baseline"
      />,
    );
    expect(
      screen.getByText(
        "Type other.v1.Target is not known to this build; shown read-only.",
      ),
    ).toBeVisible();
  });
});
