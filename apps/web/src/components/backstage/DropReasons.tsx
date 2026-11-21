"use client";

import { useState } from "react";

/**
 * Why a line is dropped: one click for a common reason, or the reviewer's own words. Shown under
 * the line it drops, across the row.
 */
export default function DropReasons({
  reasons,
  disabled,
  onPick,
  onCancel,
}: {
  reasons: readonly string[];
  disabled: boolean;
  onPick: (reason: string) => void;
  onCancel: () => void;
}) {
  const [own, setOwn] = useState("");
  return (
    <div className="bs-reasons">
      <p>Why drop it? The reason shows on the Rejected tab and helps the next reviewer.</p>
      {reasons.map((reason) => (
        <button key={reason} type="button" className="bs-reason" disabled={disabled} onClick={() => onPick(reason)}>
          {reason}
        </button>
      ))}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (own.trim()) onPick(own.trim());
        }}
      >
        <label className="bs-search h-[30px]">
          <span className="sr-only">Another reason</span>
          <input value={own} maxLength={200} placeholder="Something else…" onChange={(event) => setOwn(event.target.value)} />
        </label>
        <button type="submit" className="bs-btn bs-btn-danger" disabled={disabled || !own.trim()}>
          Drop
        </button>
      </form>
      <button type="button" className="bs-btn bs-btn-text" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
