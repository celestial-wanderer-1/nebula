import { create } from "@bufbuild/protobuf";
import { useId } from "react";
import { useEntities, useVersions } from "../api/entities";
import {
  EntityRefSchema,
  type EntityKind,
  type EntityRef,
} from "../gen/nebula/core/v1/entity_pb";
import { ENTITY_LABELS } from "./kinds";
import { defaultReference, shortHash } from "./references";
import { StalenessBadge } from "./StalenessBadge";

type RefState = EntityRef["state"]["case"];

/**
 * Picks an entity of one kind and a reference state: a pinned version,
 * `latest` or `draft` (A§4.2, D107). One picker serves every reference.
 */
export function ReferencePicker({
  projectId,
  kind,
  value,
  onChange,
  label,
  disabled,
}: {
  projectId: string;
  kind: EntityKind;
  value: EntityRef | undefined;
  onChange: (ref: EntityRef) => void;
  label?: string;
  disabled?: boolean;
}) {
  const ids = useId();
  const entities = useEntities(projectId, kind);
  const selectedId = value?.id ?? "";
  const versions = useVersions(projectId, kind, selectedId || undefined);
  const summary = entities.data?.find((entity) => entity.id === selectedId);
  const headHash = summary?.headHash ?? "";
  const state: RefState = value?.state.case;
  const kindLabel = ENTITY_LABELS[kind];

  const chooseEntity = (id: string) => {
    const head = entities.data?.find((entity) => entity.id === id)?.headHash;
    onChange(defaultReference(kind, id, head ?? ""));
  };

  const chooseState = (next: RefState, versionHash = headHash) => {
    onChange(
      create(EntityRefSchema, {
        kind,
        id: selectedId,
        state:
          next === "pinned"
            ? { case: "pinned", value: { versionHash } }
            : next === "latest"
              ? { case: "latest", value: {} }
              : { case: "draft", value: {} },
      }),
    );
  };

  return (
    <fieldset className="reference-picker" disabled={disabled}>
      <legend>{label ?? kindLabel}</legend>
      <label htmlFor={`${ids}-entity`}>{kindLabel}</label>
      <select
        id={`${ids}-entity`}
        value={selectedId}
        onChange={(event) => chooseEntity(event.target.value)}
      >
        <option value="" disabled>
          {entities.isPending
            ? "Loading…"
            : `Choose a ${kindLabel.toLowerCase()}`}
        </option>
        {entities.data?.map((entity) => (
          <option key={entity.id} value={entity.id}>
            {entity.name || entity.id}
          </option>
        ))}
      </select>

      {selectedId && (
        <div
          className="reference-states"
          role="radiogroup"
          aria-label="Reference state"
        >
          <label>
            <input
              type="radio"
              name={`${ids}-state`}
              checked={state === "pinned"}
              disabled={!headHash}
              onChange={() => chooseState("pinned")}
            />
            Pinned version
          </label>
          <label>
            <input
              type="radio"
              name={`${ids}-state`}
              checked={state === "latest"}
              disabled={!headHash}
              onChange={() => chooseState("latest")}
            />
            Track latest
          </label>
          <label>
            <input
              type="radio"
              name={`${ids}-state`}
              checked={state === "draft"}
              onChange={() => chooseState("draft")}
            />
            Current draft
          </label>
        </div>
      )}

      {value?.state.case === "pinned" && (
        <>
          <label htmlFor={`${ids}-version`}>Version</label>
          <select
            id={`${ids}-version`}
            value={value.state.value.versionHash}
            onChange={(event) => chooseState("pinned", event.target.value)}
          >
            {/* Keep a pinned hash selectable even before versions load. */}
            {!versions.data?.versions.some(
              (v) =>
                value.state.case === "pinned" &&
                v.hash === value.state.value.versionHash,
            ) && (
              <option value={value.state.value.versionHash}>
                {shortHash(value.state.value.versionHash)}
              </option>
            )}
            {versions.data?.versions.map((version) => (
              <option key={version.hash} value={version.hash}>
                {shortHash(version.hash)}
                {version.hash === versions.data.headHash ? " (head)" : ""}
              </option>
            ))}
          </select>
          <StalenessBadge reference={value} headHash={headHash} />
        </>
      )}
    </fieldset>
  );
}
