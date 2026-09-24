"use client";

import { Fragment, useState } from "react";
import { Drawer } from "@/components/kit";
import kit from "@/components/kit/kit.module.css";
import { ACTIVITY_COPY, LIQUIDATION_NOTES_HEADING, type NotePart } from "@/lib/activity-view";

/** The wire's note with its markers read: code as code, bold as bold, every word as it came. */
function NoteText({ parts }: { parts: readonly NotePart[] }) {
  return (
    <>
      {parts.map((part, index) =>
        part.kind === "code" ? (
          <code key={index}>{part.text}</code>
        ) : part.kind === "strong" ? (
          <strong key={index}>
            <NoteText parts={part.parts} />
          </strong>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * The header's drawer button and the drawer it opens. The doctrine is the view model's, paragraph by paragraph,
 * verbatim — sentences only, each keyed by its place — and then the service's own notes on the liquidations loaded,
 * each distinct note once, every word kept. The header states facts about the loaded rows; everything about method
 * lives here.
 */
export function ActivityDrawer({ doctrine, notes }: { doctrine: readonly string[]; notes: readonly (readonly NotePart[])[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`${kit.btn} ${kit.btnGhost}`} onClick={() => setOpen(true)} data-testid="activity-drawer">
        {ACTIVITY_COPY.drawer}
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title={ACTIVITY_COPY.drawer}>
        <div data-testid="activity-drawer-body">
          {doctrine.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
          {notes.length > 0 && (
            <section data-testid="activity-drawer-notes">
              <h3>{LIQUIDATION_NOTES_HEADING}</h3>
              {notes.map((note, index) => (
                <p key={index} data-testid="activity-liquidation-note">
                  <NoteText parts={note} />
                </p>
              ))}
            </section>
          )}
        </div>
      </Drawer>
    </>
  );
}
