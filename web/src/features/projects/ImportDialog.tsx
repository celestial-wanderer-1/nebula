import * as Dialog from "@radix-ui/react-dialog";
import { useId, useState, type FormEvent } from "react";
import { useImportProject } from "../../api/projects";
import { IssueSeverity } from "../../gen/nebula/core/v1/project_pb";

/** Imports a project snapshot and lists the server's validation issues. */
export function ImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const importProject = useImportProject();
  const [file, setFile] = useState<File>();
  const result = importProject.data;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (file) importProject.mutate(file);
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          importProject.reset();
          setFile(undefined);
        }
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog">
          <Dialog.Title>Import project</Dialog.Title>
          <Dialog.Description>
            Imported projects are checked before they are added (D139).
          </Dialog.Description>
          {result ? (
            <div className="stack">
              <p role="status">
                {result.project
                  ? `Imported “${result.project.name}”.`
                  : "The import was rejected."}
              </p>
              {result.issues.length > 0 && (
                <ul className="issues" aria-label="Import issues">
                  {result.issues.map((issue, index) => (
                    <li
                      key={index}
                      className={
                        issue.severity === IssueSeverity.ERROR
                          ? "issue issue-error"
                          : "issue issue-warning"
                      }
                    >
                      <strong>
                        {issue.severity === IssueSeverity.ERROR
                          ? "Error"
                          : "Warning"}
                      </strong>
                      {issue.path && <code>{issue.path}</code>}
                      <span>{issue.message}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="dialog-actions">
                <Dialog.Close asChild>
                  <button type="button" className="primary">
                    Close
                  </button>
                </Dialog.Close>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="stack">
              <label htmlFor={id}>Project export</label>
              <input
                id={id}
                type="file"
                onChange={(event) => setFile(event.target.files?.[0])}
              />
              {importProject.error && (
                <p className="field-error" role="alert">
                  {importProject.error.message}
                </p>
              )}
              <div className="dialog-actions">
                <Dialog.Close asChild>
                  <button type="button">Cancel</button>
                </Dialog.Close>
                <button
                  type="submit"
                  className="primary"
                  disabled={!file || importProject.isPending}
                >
                  Import
                </button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
