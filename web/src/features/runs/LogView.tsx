import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useId, useMemo, useState } from "react";
import { LogLevel, type LogLine } from "../../gen/nebula/core/v1/run_pb";

const LEVELS: readonly [LogLevel, string][] = [
  [LogLevel.DEBUG, "debug"],
  [LogLevel.INFO, "info"],
  [LogLevel.WARNING, "warning"],
  [LogLevel.ERROR, "error"],
];

const levelName = (level: LogLevel) =>
  LEVELS.find(([value]) => value === level)?.[1] ?? "info";

/**
 * Live structured logs (D44) with filters: minimum level, step, rank and
 * text. The buffer is bounded; dropped lines are counted, not hidden.
 */
export function LogView({
  logs,
  dropped,
  steps,
}: {
  logs: readonly LogLine[];
  dropped: number;
  steps: readonly { nodeId: string; label: string }[];
}) {
  const ids = useId();
  const [level, setLevel] = useState(LogLevel.INFO);
  const [step, setStep] = useState("");
  const [rank, setRank] = useState("");
  const [text, setText] = useState("");
  const shown = useMemo(
    () =>
      logs.filter(
        (line) =>
          line.level >= level &&
          (!step || line.nodeId === step) &&
          (rank === "" || line.rank === Number(rank)) &&
          (!text || line.message.toLowerCase().includes(text.toLowerCase())),
      ),
    [logs, level, step, rank, text],
  );
  return (
    <section className="log-view" aria-label="Logs">
      <h2>Logs</h2>
      <div className="log-filters">
        <div className="field">
          <label htmlFor={`${ids}-level`}>Level</label>
          <select
            id={`${ids}-level`}
            value={level}
            onChange={(event) =>
              setLevel(Number(event.target.value) as LogLevel)
            }
          >
            {LEVELS.map(([value, name]) => (
              <option key={value} value={value}>
                {name} and above
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${ids}-step`}>Step</label>
          <select
            id={`${ids}-step`}
            value={step}
            onChange={(event) => setStep(event.target.value)}
          >
            <option value="">All steps</option>
            {steps.map((s) => (
              <option key={s.nodeId} value={s.nodeId}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${ids}-rank`}>Rank</label>
          <input
            id={`${ids}-rank`}
            inputMode="numeric"
            value={rank}
            placeholder="All"
            onChange={(event) => setRank(event.target.value.replace(/\D/g, ""))}
          />
        </div>
        <div className="field">
          <label htmlFor={`${ids}-text`}>Contains</label>
          <input
            id={`${ids}-text`}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
      </div>
      {dropped > 0 && (
        <p className="muted small">
          {dropped} older lines were dropped from this view.
        </p>
      )}
      {shown.length > 0 && (
        <ol className="log-lines" aria-label="Log lines">
          {shown.map((line, index) => (
            <li key={index} data-level={levelName(line.level)}>
              <time className="muted">
                {line.time
                  ? timestampDate(line.time).toISOString().slice(11, 23)
                  : ""}
              </time>{" "}
              <span className="log-level">{levelName(line.level)}</span>{" "}
              <span className="muted">
                r{line.rank}
                {line.nodeId ? ` ${line.nodeId}` : ""}
              </span>{" "}
              {line.message}
            </li>
          ))}
        </ol>
      )}
      {shown.length === 0 && (
        <p className="muted small">
          {logs.length ? "No log lines match." : "No log lines yet."}
        </p>
      )}
    </section>
  );
}
